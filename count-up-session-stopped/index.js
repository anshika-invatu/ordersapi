'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const Swish = require('../utils/swish-payment');
const request = require('request-promise');
const checkoutUtiles = require('../utils/checkout-session');
const errors = require('../errors');

module.exports = async (context, req) => {
    let collection, countUpSession, countUpSessionOld, totalAmountInclVat = 0;
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to count up session stopped but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body.pointOfServiceID || !req.body.salesChannelTypeCode  || !req.body.salesChannelID || !req.body.sessionType) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'Please pass these params(pointOfServiceID, salesChannelTypeCode, salesChannelID and sessionType).',
                    400
                )
            );
            return Promise.resolve();
        }
        context.log('req body = ' + JSON.stringify(req.body));
        collection = await getMongodbCollection('Orders');
        if (req.body.countUpSessionsID) {
            countUpSession = await collection.findOne({
                _id: req.body.countUpSessionsID,
                partitionKey: req.body.countUpSessionsID,
                docType: 'countUpSessions'
            });
            context.log('Check 1');
            context.log('countUpSession 1 = ' + JSON.stringify(countUpSession));
        }
        if (!req.body.countUpSessionsID && req.body.countUpSessionReferenceID) {
            countUpSession = await collection.findOne({
                countUpSessionReferenceID: req.body.countUpSessionReferenceID,
                pointOfServiceID: req.body.pointOfServiceID,
                docType: 'countUpSessions'
            });
            context.log('Check 2');
            context.log('countUpSession 2 = ' + JSON.stringify(countUpSession));
        }
        if (!countUpSession) {
            countUpSessionOld = await collection.findOne({
                countUpSessionReferenceID: req.body.countUpSessionReferenceID,
                pointOfServiceID: req.body.pointOfServiceID,
                docType: 'countUpSessionsOld'
            });
            context.log('Check 3');
            context.log('countUpSessionOld 3 = ' + JSON.stringify(countUpSessionOld));
            try {
                await utils.createRefund(countUpSessionOld, collection, context);
           
                const updatedcountUpSession = await collection.updateOne({
                    _id: countUpSessionOld._id,
                    partitionKey: countUpSessionOld.partitionKey,
                    docType: 'countUpSessionsOld'
                }, {
                    $set: {
                        paymentStatusCode: 'refunded'
                    }
                });
                context.log(updatedcountUpSession.matchedCount);

                const updatedRetailTransaction = await collection.updateOne({
                    _id: countUpSessionOld.retailTransactionID,
                    partitionKey: countUpSessionOld.retailTransactionID,
                    $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
                }, {
                    $set: {
                        retailTransactionStatusCode: 'refunded'
                    }
                });
                context.log(updatedRetailTransaction.matchedCount);
            } catch (error) {
                context.log(error);
            }
        }

        if (!countUpSession) {
            context.log('pos session doc does not exist.');
            throw 'pos session doc does not exist.';
        }
        context.log('countUpSession = ' + JSON.stringify(countUpSession));
        let usageTotalVolume = 0, usageTotalTimeMinutes = 0, sameUnitusageTotalVolume = 0;
        req.body.usageStopDate = new Date();
        const usageRecords = [];
        if (countUpSession.usageRecords)
            countUpSession.usageRecords.forEach(usageRecord => {
                let usageTotalTimeMinute;
                if (!usageRecord.usageStopValue && req.body.usageStopValue)
                    usageRecord.usageStopValue = req.body.usageStopValue;
                if (!usageRecord.usageStopDate && req.body.usageStopDate)
                    usageRecord.usageStopDate = new Date(req.body.usageStopDate);
                if (usageRecord.usageStopValue !== undefined && usageRecord.usageStartValue !== undefined) {
                    usageTotalVolume = usageTotalVolume + (usageRecord.usageStopValue - usageRecord.usageStartValue);
                    usageRecord.usageTotalVolume = usageTotalVolume;
                }
                if (usageRecord.usageStopDate && usageRecord.usageStartDate) {
                    usageTotalTimeMinute = new Date(usageRecord.usageStopDate) - new Date(usageRecord.usageStartDate);
                    context.log('usageTotalTimeMinute = ' + usageTotalTimeMinute);
                    usageTotalTimeMinutes = usageTotalTimeMinutes + (usageTotalTimeMinute / (60 * 1000));
                    context.log('usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
                }
                if (usageRecord.usageTotalVolume > 0 && req.body.unitCode && req.body.unitCode.toLowerCase() === 'wh')
                    usageRecord.usageTotalVolume = usageRecord.usageTotalVolume / 1000;
                
                if (countUpSession.priceType === 'pricePerUnit' && usageRecord.usageTotalVolume !== undefined)
                    sameUnitusageTotalVolume = sameUnitusageTotalVolume + usageRecord.usageTotalVolume;
                
                usageRecord.usageTotalTimeMinutes = Number((usageTotalTimeMinute / (60 * 1000)).toFixed(1));
                
                usageRecord.usageTotalVolume = (usageRecord.usageStopValue - usageRecord.usageStartValue);
                
                usageRecord.usageTotalVolume = Number(usageRecord.usageTotalVolume.toFixed(1));
                usageRecord.unitCode = req.body.unitCode;
                if (isNaN(usageRecord.usageTotalVolume))
                    usageRecord.usageTotalVolume = 0;
                usageRecords.push(usageRecord);
            });
        if (req.body.unitCode && req.body.unitCode && req.body.unitCode.toLowerCase() === 'wh')
            usageTotalVolume = usageTotalVolume / 1000;
        let quantity = usageTotalVolume;
        if (countUpSession.unitCode === 'minutes')
            quantity = usageTotalTimeMinutes;
        context.log('usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
        if (usageTotalVolume < 0)
            usageTotalVolume = 0;
        if (usageTotalTimeMinutes < 0 || usageTotalTimeMinutes > 99999)
            usageTotalTimeMinutes = 0;
        if (countUpSession.priceType === 'fixedPrice')
            totalAmountInclVat = countUpSession.salesPrice;
        if (countUpSession.priceType === 'pricePerUnit')
            totalAmountInclVat = sameUnitusageTotalVolume * countUpSession.pricePerUnit;
        if (countUpSession.priceType === 'pricePerUnit' && countUpSession.unitCode === 'minutes')
            totalAmountInclVat = usageTotalTimeMinutes * countUpSession.pricePerUnit;
        if (countUpSession.priceType === 'priceGroup')
            totalAmountInclVat = countUpSession.salesPrice;
        if (countUpSession.priceType === 'freeOfCharge')
            totalAmountInclVat = 0;
        if (countUpSession.priceType === 'priceGroup' && countUpSession.priceGroupID) {
            const priceGroup = await request.post(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/price-by-price-group`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.MERCHANT_API_KEY
                },
                body: {
                    merchantID: countUpSession.merchantID,
                    priceGroupID: countUpSession.priceGroupID,
                    productID: countUpSession.productID,
                    startDate: countUpSession.sessionStartDate
                }
            });
            totalAmountInclVat = priceGroup.salesPrice;
        }
        let totalVatAmount;
        if (totalAmountInclVat && countUpSession.vatPercent)
            totalVatAmount = Number((totalAmountInclVat - (totalAmountInclVat / ((countUpSession.vatPercent / 100) + 1))).toFixed(2));
        if (isNaN(usageTotalVolume))
            usageTotalVolume = 0;
        if (isNaN(usageTotalTimeMinutes))
            usageTotalTimeMinutes = 0;
        if (isNaN(totalAmountInclVat))
            totalAmountInclVat = 0;
        if (isNaN(totalVatAmount))
            totalVatAmount = 0;
        const updatedcountUpSession = await collection.updateOne({ _id: countUpSession._id, docType: 'countUpSessions', partitionKey: countUpSession._id },
            { $set: Object.assign({},{
                usageTotalVolume,
                usageTotalTimeMinutes: Number(usageTotalTimeMinutes.toFixed(1)),
                totalAmountInclVat,
                totalVatAmount,
                usageRecords,
                ttl: 60 * 60 * 24 * 400,
                updatedDate: new Date() })
            });
        if (updatedcountUpSession.matchedCount)
            console.log('pos session is updated');
        let pointOfService;
        countUpSession = await collection.findOne({ _id: countUpSession._id, partitionKey: countUpSession.partitionKey });
        context.log('updated countUpSession = ' + JSON.stringify(countUpSession));
        try {
            if (countUpSession.salesChannel)
                pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${countUpSession.salesChannel.salesChannelID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
        } catch (error) {
            context.log(error);
        }
        if (pointOfService && pointOfService.autoRefundRules && pointOfService.autoRefundRules.unitCode
            && pointOfService.autoRefundRules.unitCode.toLowerCase() === 'kwh'
            && pointOfService.autoRefundRules.usageLimit >= totalAmountInclVat) {
            try {
                const refund = await utils.createRefund(countUpSessionOld, collection, context, 'autoRefundedLowUsage');
                if (refund) {
                    const isUpdated = await collection.updateOne({ _id: countUpSession._id, partitionKey: countUpSession._id },
                        { $set: {
                            status: 'refunded',
                            sessionStateCode: 'autoRefundedLowUsage'
                        }});
                    context.log(isUpdated.matchedCount);
                }
            } catch (error) {
                context.log(error);
            }
        }
        if (!pointOfService)
            try {
                pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.salesChannelID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
            } catch (error) {
                context.log(error);
            }
        if (pointOfService)
            context.log('pointOfService.preAuthorizationAmount = ' + pointOfService.preAuthorizationAmount + 'and totalAmountInclVat = ' + totalAmountInclVat);
        let amount;
        if (pointOfService && pointOfService.preAuthorizationAmount)
            amount = Number(pointOfService.preAuthorizationAmount) - totalAmountInclVat;
        if (amount < 0)
            amount = pointOfService.preAuthorizationAmount;
        amount = amount ? Number(Number(amount).toFixed(2)) : amount;
        context.log(amount);
        let checkoutSession, result;
        let retailTransaction = await collection.findOne({
            _id: countUpSession.retailTransactionID,
            docType: 'retailTransactionPending'
        });
       
        if (retailTransaction)
            checkoutSession = await collection.findOne({
                _id: retailTransaction.checkoutSessionID,
                $or: [{ 'docType': 'checkoutSessionCompleted' }, { 'docType': 'checkoutSession' }]
            });
        context.log(checkoutSession);
        if (isNaN(amount))
            amount = 0;
        if (countUpSession.retailTransactionID) {
            if (retailTransaction && retailTransaction.totalAmountInclVat < amount) {
                throw utils.setContextResError(
                    context,
                    new errors.FieldValidationError(
                        'Refunded amount is grather than paid amount.',
                        403
                    )
                );
            }
        }
        let refundable = true;
        if (pointOfService && Number(pointOfService.preAuthorizationAmount) < totalAmountInclVat) {
            context.log('preAuthorizationAmount is smaller then amount');
            if (countUpSession.pspType === 'creditcard') {
                refundable = true;
                totalAmountInclVat = pointOfService.preAuthorizationAmount;
            }
        }
        
        if (refundable === true && countUpSession.pspType === 'swish') {
            context.log('running swish');
            try {
                let paymentProviderAccountID;
                if (checkoutSession)
                    paymentProviderAccountID = checkoutSession.paymentProviderAccountID;
                if (!paymentProviderAccountID)
                    paymentProviderAccountID = countUpSession.paymentProviderAccountID;
                const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                let payerAlias;
                if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings && paymentProviderAccountsDoc.settings.swish)
                    payerAlias = paymentProviderAccountsDoc.settings.swish.swishNumber;
                const isTesting = process.env.IS_TESTING;
                if (!pointOfService.currency)
                    pointOfService.currency = 'SEK';
                context.log(payerAlias);
                context.log(amount);
                req.body.cancelBody = {
                    callbackUrl: process.env.CALLBACK_URL,
                    payerAlias: payerAlias.toString(),
                    amount: amount.toString(),
                    currency: pointOfService.currency,
                    message: 'Återbetalning för avslutad elbilsladdning'
                };
                if (checkoutSession)
                    req.body.cancelBody.originalPaymentReference = checkoutSession.swishCallBackResult ? checkoutSession.swishCallBackResult.paymentReference : checkoutSession.paymentProviderReference;
                if (!req.body.cancelBody.originalPaymentReference && countUpSession.swishCallBackResult)
                    req.body.cancelBody.originalPaymentReference = countUpSession.swishCallBackResult.paymentReference;
                req.instructionUUID = checkoutSession.paymentProviderReference;
                result = await Swish.swishPayment(req, context, isTesting, checkoutSession.paymentID);
                context.log(result);
                let paymentResult;
                if (result && result.location)
                    paymentResult = 'approved';
                else
                    paymentResult = 'denied';
                await utils.createPaymentLogs(countUpSession, result, amount, paymentResult);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && countUpSession.pspType === 'bluecode') {
            context.log('running bluecode');
            try {
                result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/bluecode-refund`, {
                    json: true,
                    body: {
                        acquirer_tx_id: checkoutSession.payment.acquirer_tx_id,
                        amount: amount,
                        reason: 'Customer does not like item',
                        paymentProviderAccountID: countUpSession.paymentProviderAccountID
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                console.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && countUpSession.pspType === 'binance') {
            context.log('running binance');
            try {
                result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/binance-refund`, {
                    json: true,
                    body: {
                        refundRequestId: uuid.v4(),
                        prepayId: checkoutSession.binancePaymentData ? (checkoutSession.binancePaymentData.data ? checkoutSession.binancePaymentData.data.prepayId : '') : '',
                        refundAmount: amount,
                        refundReason: 'refund remaining amount'
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                console.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && countUpSession.pspType === 'creditcard') {
            context.log('running creditcard');
            try {
                result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/v1/hips-capture-payment/${checkoutSession.paymentTransactionResponse.paymentId}?paymentProviderAccountID=${countUpSession.paymentProviderAccountID}`, {
                    json: true,
                    body: { amount: totalAmountInclVat * 100 },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && countUpSession.pspType === 'planetpayment') {
            context.log('running planetpayment');
            try {
                const reqBody = {
                    amount: totalAmountInclVat,
                    requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                    requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                    requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                    bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                    SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                    token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                    currency: checkoutSession.currency,
                    timeZone: pointOfService.timeZone
                };
                context.log(JSON.stringify(reqBody));
                result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                    json: true,
                    body: reqBody,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && countUpSession.customerAccountID && countUpSession.pspType === 'accessToken') {
            context.log('running accessToken');
            const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${countUpSession.productID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            if (countUpSession.priceType === 'fixedPrice')
                totalAmountInclVat = Number((product.salesPrice).toFixed(2));
            else
                totalAmountInclVat = Number((product.salesPrice * quantity).toFixed(2));
            req.body.pspType = 'accesstoken';
            req.body.countUpSessionID = countUpSession._id;
            req.body.userSessionID = pointOfService._id;
            result = await checkoutUtiles.createCheckoutSessionByAccessToken(req, pointOfService, product, totalAmountInclVat, quantity, context);
            context.log(result);
            retailTransaction = await collection.findOne({
                checkoutSessionID: result.checkoutSessionID,
                docType: 'retailTransactionPending'
            });
        } else if (refundable === true && countUpSession.pspType === 'stripe') {
            result = await utils.stripePaymentCapture(countUpSession.paymentID, amount);
        } else if (refundable === true && countUpSession.pspType === 'vipps') {
            const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-refund?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                json: true,
                body: {
                    merchantSerialNumber: checkoutSession.merchantSerialNumber,
                    orderID: checkoutSession.orderID,
                    amount: amount,
                    transactionText: 'session completed',
                    xRequestID: checkoutSession.paymentRequestID
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            context.log(result);
        }
        let newRetailTransaction;
        if (retailTransaction)
            newRetailTransaction = await this.updatedRetailTransActions(collection, retailTransaction, totalAmountInclVat, countUpSession, quantity, context);
        context.log(newRetailTransaction);
        const updatedBody = { paymentStatusCode: 'paid',
            currency: pointOfService ? pointOfService.currency : checkoutSession.currency,
            totalAmountInclVat: totalAmountInclVat
        };
       
        const statusUpdated = await collection.updateOne({ _id: countUpSession._id, docType: 'countUpSessions', partitionKey: countUpSession._id },
            { $set: updatedBody });
        if (statusUpdated.matchedCount)
            context.log('pos session status is updated');
        await this.deleteSession(collection, countUpSession);
        if (countUpSession.pspType === 'accessToken') {
            await request.patch(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/account-transaction/${checkoutSession.accountTransactionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    usageTotalVolume: usageTotalVolume,
                    usageTotalUnit: 'kWh',
                    usageTotalTimeMinutes: usageTotalTimeMinutes,
                }
            });
        }
        context.res = {
            body: {
                description: 'Successfully stopped count up session event.'
            }
        };
        
    } catch (error) {
        context.log(error);
        if (collection, countUpSession)
            await this.deleteSession(collection, countUpSession);
        context.res = {
            body: {
                description: 'Theres is an error when count up session event stopped.'
            }
        };
    }
};


exports.deleteSession = async (collection, countUpSession) => {
    const updatedcountUpSessionDoc = await collection.findOne({ _id: countUpSession._id, partitionKey: countUpSession.partitionKey, docType: 'countUpSessions' });
    const log = Object.assign({}, updatedcountUpSessionDoc, { countUpSessionID: updatedcountUpSessionDoc._id, _id: uuid.v4(), docType: 'countUpSessionLog', updatedDate: new Date() });
    await collection.insertOne(log);
    await collection.updateOne({ _id: updatedcountUpSessionDoc._id, partitionKey: updatedcountUpSessionDoc.partitionKey, docType: 'countUpSessions' },
        { $set: { countUpSessionID: updatedcountUpSessionDoc._id, docType: 'countUpSessionsOld', updatedDate: new Date() }});
};


exports.updatedRetailTransActions = async (collection, oldRetailTransaction, amount, countUpSession, quantity, context) => {
    context.log('running updating function');
    let vatPercents = 0, vatAmount = 0, count = 0;
    amount = amount ? Number(amount.toFixed(2)) : amount;
    quantity = quantity ? Number(quantity.toFixed(2)) : quantity;
    countUpSession.pricePerUnit = countUpSession.pricePerUnit ? Number(countUpSession.pricePerUnit.toFixed(2)) : countUpSession.pricePerUnit;
    if (oldRetailTransaction.lineItems && Array.isArray(oldRetailTransaction.lineItems)) {
        oldRetailTransaction.lineItems.forEach(element => {
            if (element.lineItemTypeCode === 'sales') {
                vatPercents = vatPercents + element.vatPercent;
                count ++;
            }
        });
        const vatPercent = vatPercents ? vatPercents / count : 0;
        vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
        oldRetailTransaction.lineItems.forEach(element => {
            if (element.lineItemTypeCode === 'sales') {
                element.quantity = quantity;
                element.pricePerUnit = countUpSession.pricePerUnit;
                element.amount = amount;
                element.credit = amount;
                element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
                element.amountExclVat = Number((amount - element.vatAmount).toFixed(2));
            }
            if (element.lineItemTypeCode === 'payment') {
                element.amount = amount;
                element.debit = amount;
            }
            if (element.lineItemTypeCode === 'vat') {
                element.amount = amount;
                element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
                element.amountExclVat = Number((amount - element.vatAmount).toFixed(2));
                element.credit = Number((amount - element.vatAmount).toFixed(2));
            }
        });
        oldRetailTransaction.vatSummary.forEach(element => {
            element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
        });
    }
    
    context.log('updating retailTransactionPending');
    const updatedResult = await collection.updateOne({
        _id: oldRetailTransaction._id,
        partitionKey: oldRetailTransaction._id
    }, {
        $set: {
            docType: 'retailTransaction',
            totalAmountInclVat: amount,
            totalVatAmount: vatAmount,
            lineItems: oldRetailTransaction.lineItems,
            vatSummary: oldRetailTransaction.vatSummary,
            updatedDate: new Date()
        }
    });
    if (updatedResult && updatedResult.matchedCount)
        context.log('retail transaction doc updated');
    context.log(updatedResult.matchedCount);
    const newRetailTransaction = await collection.findOne({ _id: oldRetailTransaction._id, partitionKey: oldRetailTransaction._id });
    context.log(newRetailTransaction);
    if (newRetailTransaction)
        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_RETAIL_TRANSACTIONS, newRetailTransaction);
};