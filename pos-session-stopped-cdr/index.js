'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const Swish = require('../utils/swish-payment');
const request = require('request-promise');
const checkoutUtiles = require('../utils/checkout-session');
const relatedFile = require('../pos-session-stopped/pos-session-related');
const errors = require('../errors');

module.exports = async (context, req) => {
    let collection, posSession, posSessionOld;
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to pos session stopped but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body.posSessionID || !req.body.merchantID || !req.body.totalAmountInclVat) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'Please pass these params(posSessionID, merchantID, totalAmountInclVat).',
                    400
                )
            );
            return Promise.resolve();
        }
        context.log('req body = ' + JSON.stringify(req.body));
        collection = await getMongodbCollection('Orders');

        if (req.body.posSessionID) {
            posSession = await collection.findOne({
                _id: req.body.posSessionID,
                partitionKey: req.body.posSessionID,
                docType: 'posSessions'
            });
            context.log('Check 1');
        }

        if (!posSession) {
            await relatedFile.deletedPosSession(collection, req, context);
            context.log('pos session doc does not exist.');
            throw 'pos session doc does not exist.';
        }

        if (posSession.priceCalculation !== 'cdr') {
            context.log('priceCalculation is not cdr. Ending processing now.');
            return Promise.resolve();
        }
        context.log('posSession = ' + JSON.stringify(posSession));
        req.body.usageStopDate = new Date();

        const updatedPosSession = await collection.updateOne({ _id: posSession._id, docType: 'posSessions', partitionKey: posSession._id },
            {
                $set: Object.assign({}, {
                    usageTotalVolume: req.body.usageTotalVolume,
                    usageTotalTimeMinutes: Number(req.body.usageTotalTimeMinutes.toFixed(1)),
                    totalAmountInclVat: req.body.totalAmountInclVat,
                    totalVatAmount: req.body.totalVatAmount,
                    ttl: 60 * 60 * 24 * 400,
                    updatedDate: new Date()
                })
            });
        if (updatedPosSession.matchedCount)
            console.log('pos session is updated');

        posSession = await collection.findOne({ _id: posSession._id, partitionKey: posSession.partitionKey });
        context.log('updated posSession = ' + JSON.stringify(posSession));
       
        const { pointOfService, quickShop } = await relatedFile.getPointOfService(req, posSession, context);

        await relatedFile.autoRefunded(pointOfService, collection, posSession, req.body.totalAmountInclVat, posSessionOld, context);
        
        const preAuthorizationAmount = pointOfService ? pointOfService.preAuthorizationAmount : (quickShop ? quickShop.preAuthorizationAmount : '');

        context.log('preAuthorizationAmount = ' + preAuthorizationAmount + 'and totalAmountInclVat = ' + req.body.totalAmountInclVat);
        let amount;
        if (preAuthorizationAmount)
            amount = Number(preAuthorizationAmount) - req.body.totalAmountInclVat;
        if (amount < 0)
            amount = preAuthorizationAmount;
        amount = amount ? Number(Number(amount).toFixed(2)) : amount;
        context.log(amount);
        let checkoutSession, result;
        let retailTransaction = await collection.findOne({
            _id: posSession.retailTransactionID,
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

        let refundable = true, isSessionError = false;
        if (preAuthorizationAmount && Number(preAuthorizationAmount) < req.body.totalAmountInclVat) {
            context.log('preAuthorizationAmount is smaller then amount');
            refundable = true;
            isSessionError = true;
            req.body.totalAmountInclVat = Number(preAuthorizationAmount);

        }
        
        let resultReasonText, isPlanetError;
        if (refundable === true && posSession.pspType === 'swish' && isSessionError === false) {
            context.log('running swish');
            try {
                let paymentProviderAccountID;
                if (checkoutSession)
                    paymentProviderAccountID = checkoutSession.paymentProviderAccountID;
                if (!paymentProviderAccountID)
                    paymentProviderAccountID = posSession.paymentProviderAccountID;
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
                let currency = pointOfService ? pointOfService.currency : (quickShop ? quickShop.currency : 'SEK');
                if (!currency)
                    currency = 'SEK';
                context.log(payerAlias);
                context.log(amount);
                req.body.cancelBody = {
                    callbackUrl: process.env.CALLBACK_URL,
                    payerAlias: payerAlias.toString(),
                    amount: amount.toString(),
                    currency: currency,
                    message: 'Återbetalning för avslutad elbilsladdning'
                };
                if (checkoutSession)
                    req.body.cancelBody.originalPaymentReference = checkoutSession.swishCallBackResult ? checkoutSession.swishCallBackResult.paymentReference : undefined;
                if (!req.body.cancelBody.originalPaymentReference && posSession.swishCallBackResult)
                    req.body.cancelBody.originalPaymentReference = posSession.swishCallBackResult.paymentReference;
                req.instructionUUID = checkoutSession.paymentProviderReference;
                result = await Swish.swishPayment(req, context, isTesting, checkoutSession.paymentID);
                context.log(result);
                let paymentResult;
                if (result && result.location)
                    paymentResult = 'approved';
                else
                    paymentResult = 'denied';
                await utils.createPaymentLogs(checkoutSession, result, 'refund', amount, paymentResult);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && posSession.pspType === 'bluecode') {
            context.log('running bluecode');
            try {
                result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/bluecode-refund`, {
                    json: true,
                    body: {
                        acquirer_tx_id: checkoutSession.payment.acquirer_tx_id,
                        amount: amount,
                        reason: 'Customer does not like item',
                        paymentProviderAccountID: posSession.paymentProviderAccountID
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                console.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && posSession.pspType === 'binance') {
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
        } else if (refundable === true && checkoutSession && posSession.pspType === 'creditcard') {
            context.log('running creditcard');
            try {
                result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/v1/hips-capture-payment/${checkoutSession.paymentTransactionResponse.paymentId}?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                    json: true,
                    body: { amount: req.body.totalAmountInclVat * 100 },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            } catch (error) {
                context.log(error);
            }
        } else if (refundable === true && checkoutSession && posSession.pspType === 'planetpayment') {
            context.log('running planetpayment');
            if (checkoutSession.paymentTransactionResponse)
                context.log(checkoutSession.paymentTransactionResponse.sCATransRef);
            try {
                const reqBody = {
                    amount: req.body.totalAmountInclVat,
                    requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                    requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                    requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                    SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                    token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                    bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                    currency: checkoutSession.currency,
                    timeZone: pointOfService.timeZone
                };
                if (checkoutSession.pointOfServiceID) {
                    try {
                        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${checkoutSession.pointOfServiceID}`, {
                            json: true,
                            headers: {
                                'x-functions-key': process.env.DEVICE_API_KEY
                            }
                        });
                        reqBody.timeZone = pointOfService.timeZone;
                    } catch (error) {
                        console.log(error);
                    }
                }
                context.log(JSON.stringify(reqBody));
                result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                    json: true,
                    body: reqBody,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
                if (result.statusCode === 400) {
                    resultReasonText = result.resultReasonText;
                }
            } catch (error) {
                context.log(error);
                isPlanetError = true;
                if (error.error && error.error.result && error.error.result.includes('<ResultReason>') && error.error.result.includes('</ResultReason>')) {
                    let resultReasonText = error.error.result.split('<ResultReason>');
                    resultReasonText = resultReasonText[1].split('</ResultReason>')[0];
                    checkoutSession.resultReasonText = resultReasonText;
                }
            }
        } else if (refundable === true && posSession.customerAccountID && posSession.pspType === 'accessToken') {
            context.log('running accessToken');
            const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${posSession.productID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            const agreementValues = await relatedFile.getPriceFromCustomerAgreement(collection, posSession, req.body.totalAmountInclVat, context);
            context.log('agreementValues = ' + JSON.stringify(agreementValues));
            if (agreementValues) {
                if (!posSession.vatPercent) posSession.vatPercent = product.vatPercent;
                context.log(posSession.vatPercent);
            
                await collection.updateOne({ _id: posSession._id, partitionKey: posSession._id },
                    { $set: {
                        customerAgreementID: agreementValues.customerAgreement._id,
                        agreementPrices: agreementValues.agreementPrices,
                        salesPriceBeforeDiscount: req.body.totalAmountInclVat,
                        salesPriceAfterDiscount: agreementValues.updatedPrice,
                        totalAmountInclVat: req.body.totalAmountInclVat,
                        totalVatAmount: req.body.totalVatAmount
                    }});
                if (agreementValues.updatedPrice) req.body.totalAmountInclVat = agreementValues.updatedPrice;
            }
            
            context.log('Paid with accessToken req.body.totalAmountInclVat: ' + req.body.totalAmountInclVat);
            if (!retailTransaction) {
                context.log('Did not find any retailTransaction, creating one now');
                req.body.pspType = 'accesstoken';
                req.body.posSessionID = posSession._id;
                req.body.userSessionID = posSession.pointOfServiceID;
                result = await checkoutUtiles.createCheckoutSessionByAccessToken(req, pointOfService, product, req.body.totalAmountInclVat, 1, context);
                context.log(result);
                retailTransaction = await collection.findOne({
                    checkoutSessionID: result.checkoutSessionID,
                    docType: 'retailTransactionPending'
                });
            }

        } else if (refundable === true && posSession.pspType === 'stripe') {
            const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${retailTransaction.paymentProviderAccountID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            let stripeAccount;
            if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings)
                stripeAccount = paymentProviderAccountsDoc.settings.stripeAccount;
            result = await utils.stripePaymentCapture(posSession.paymentID, req.body.totalAmountInclVat, stripeAccount, context);
        } else if (refundable === true && posSession.pspType === 'vipps') {
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-capture?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                json: true,
                body: {
                    merchantSerialNumber: checkoutSession.merchantSerialNumber,
                    orderID: checkoutSession.orderID,
                    amount: req.body.totalAmountInclVat,
                    transactionText: 'session completed',
                    paymentRequestID: checkoutSession.paymentRequestID
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            
            context.log(result);
        }
        let newRetailTransaction;
        if (retailTransaction)
            newRetailTransaction = await relatedFile.updatedRetailTransActions(collection, retailTransaction, req.body.totalAmountInclVat, posSession, 1, context, isPlanetError, resultReasonText);
        context.log(newRetailTransaction);
        const updatedBody = {
            paymentStatusCode: 'paid',
            currency: pointOfService ? pointOfService.currency : checkoutSession.currency,
            totalAmountInclVat: req.body.totalAmountInclVat
        };

        const statusUpdated = await collection.updateOne({ _id: posSession._id, docType: 'posSessions', partitionKey: posSession._id },
            { $set: updatedBody });
        if (statusUpdated.matchedCount)
            context.log('pos session status is updated');
        await relatedFile.deleteSession(collection, posSession);
        if (posSession.pspType === 'accessToken') {
            await relatedFile.updateAccountingTrans(req.body.totalAmountInclVat, req.body.totalVatAmount, req.body.usageTotalVolume, req.body.usageTotalTimeMinutes, '', newRetailTransaction, retailTransaction, context);
        }
        const energyEvents = {};
        energyEvents._id = uuid.v4();
        energyEvents.docType = 'energyEvents';
        energyEvents.partitionKey = energyEvents._id;
        energyEvents.eventCode = 'posSessionStopped';
        energyEvents.eventText = 'POS Session Stopped';
        energyEvents.pointOfServiceID = posSession.pointOfServiceID;
        energyEvents.pointOfServiceName = posSession.pointOfServiceName;
        energyEvents.merchantID = pointOfService ? pointOfService.merchantID : quickShop ? quickShop.merchantID : '';
        energyEvents.posSessionID = posSession._id;
        energyEvents.createdDate = new Date();
        const sendMsg = await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ENERGY_EVENTS, energyEvents);
        context.log(sendMsg);
        const pendingTransaction = await collection.find({
            posSessionID: posSession._id,
            docType: 'retailTransactionPending'
        }).toArray();
        for (let i = 0; i < pendingTransaction.length; i++) {
            const element = pendingTransaction[i];
            const refundResult = await utils.createRefund(posSession, collection, context, 'autoRefund', element);
            context.log(refundResult);
        }
        context.res = {
            body: {
                description: 'Successfully stopped pos session event.'
            }
        };

    } catch (error) {
        context.log(error);
        if (collection, posSession)
            await relatedFile.deleteSession(collection, posSession);
        context.res = {
            body: {
                description: 'Theres is an error when pos session event stopped.'
            }
        };
    }
};

