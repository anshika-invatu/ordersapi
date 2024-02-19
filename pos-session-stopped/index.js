'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const Swish = require('../utils/swish-payment');
const request = require('request-promise');
const checkoutUtiles = require('../utils/checkout-session');
const relatedFile = require('./pos-session-related');
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
        if (!req.body.pointOfServiceID || !req.body.salesChannelTypeCode || !req.body.salesChannelID || !req.body.sessionType) {
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

        if (req.body.posSessionsID) {
            posSession = await collection.findOne({
                _id: req.body.posSessionsID,
                partitionKey: req.body.posSessionsID,
                docType: 'posSessions'
            });
            context.log('Check 1');
        }

        if (!req.body.posSessionsID && req.body.posSessionReferenceID) {
            posSession = await collection.findOne({
                posSessionReferenceID: req.body.posSessionReferenceID,
                pointOfServiceID: req.body.pointOfServiceID,
                docType: 'posSessions'
            });
            context.log('Check 2');
        }

        if (!posSession) {
            await relatedFile.deletedPosSession(collection, req, context);
            context.log('pos session doc does not exist.');
            throw 'pos session doc does not exist.';
        }

        if (posSession.priceCalculation === 'cdr') {
            context.log('priceCalculation is cdr');
            return Promise.resolve();
        }
        
        context.log('posSession = ' + JSON.stringify(posSession));
        req.body.usageStopDate = new Date();

        var { usageTotalVolume, usageTotalTimeMinutes, sameUnitusageTotalVolume, usageRecords, usageParkingTimeMinutes } = await relatedFile.usageRecords(posSession, req, context);
       
        const values = { usageTotalVolume, usageTotalTimeMinutes, sameUnitusageTotalVolume, usageRecords, usageParkingTimeMinutes };
        context.log('values = ' + JSON.stringify(values));
        
        const updatedValues  = await relatedFile.evalueateValues(req, posSession, values, context);
        let usageChargingTimeMinutes = 0;
        
        usageTotalVolume = Number(updatedValues.usageTotalVolume);
        usageTotalTimeMinutes = Number(updatedValues.usageTotalTimeMinutes);
        usageParkingTimeMinutes = Number(usageParkingTimeMinutes);
        usageChargingTimeMinutes = Number(usageTotalTimeMinutes - usageParkingTimeMinutes);

        var { totalAmountInclVat, totalVatAmount } = updatedValues;

        let quantity = usageTotalVolume;
        if (posSession.unitCode === 'minutes')
            quantity = usageTotalTimeMinutes;
        const { pointOfService, quickShop } = await relatedFile.getPointOfService(req, posSession, context);
        const preAuthorizationAmount = pointOfService ? pointOfService.preAuthorizationAmount : (quickShop ? quickShop.preAuthorizationAmount : '');

        let pricePerUnit;
        let feeSessionFixed = 0;
        let feeSessionStart = 0;
        let feeSessionEnergy = 0;
        let feeSessionParkingTime = 0;
        let feeSessionChargingTime = 0;
        let feeStart = 0;
        let feeEnergyPerKwh = 0;
        let feeParkingPerMinute = 0;
        let feeChargingPerMinute = 0;
        let sessionEvChargingBasicFees = {};
        let posSessionStopReason = '';

        //Make sure we get all price data as numbers
        if (posSession.evChargingBasicFees) {
            sessionEvChargingBasicFees = posSession.evChargingBasicFees;
        }
        if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeStart) {
            feeStart = Number(sessionEvChargingBasicFees.feeStart);
        }
        if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeEnergyPerKwh) {
            feeEnergyPerKwh = Number(sessionEvChargingBasicFees.feeEnergyPerKwh);
        }
        if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeParkingPerMinute) {
            feeParkingPerMinute = Number(sessionEvChargingBasicFees.feeParkingPerMinute);
        }
        if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeChargingPerMinute) {
            feeChargingPerMinute = Number(sessionEvChargingBasicFees.feeChargingPerMinute);
        }
        context.log('sessionEvChargingBasicFees = ' + JSON.stringify(sessionEvChargingBasicFees));

        //Check what price type it is so we know how to calculate the cost
        if (posSession.priceType === 'fixedPrice') {
            totalAmountInclVat = Number((posSession.salesPrice).toFixed(2));
            feeSessionFixed = Number((posSession.salesPrice).toFixed(2));
        } else if (posSession.priceType === 'pricePerUnit') {
            pricePerUnit = Number((posSession.salesPrice).toFixed(2));
            totalAmountInclVat = Number((posSession.salesPrice * quantity).toFixed(2));
        } else if (posSession.priceType === 'freeOfCharge') {
            totalAmountInclVat = 0;
        } else if (posSession.priceType === 'evChargingBasic') {
            context.log('priceType = evChargingBasic');
            totalAmountInclVat = 0;
            if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeStart) {
                totalAmountInclVat = Number((feeStart).toFixed(2));
                feeSessionStart = Number((feeStart).toFixed(2));
            }
            if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeEnergyPerKwh) {
                totalAmountInclVat = Number((totalAmountInclVat).toFixed(2)) + Number((feeEnergyPerKwh * usageTotalVolume).toFixed(2));
                feeSessionEnergy = Number((feeEnergyPerKwh * usageTotalVolume).toFixed(2));
            }
            if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeParkingPerMinute) {
                totalAmountInclVat = Number((totalAmountInclVat).toFixed(2)) + Number((feeParkingPerMinute * usageParkingTimeMinutes).toFixed(2));
                feeSessionParkingTime = Number((feeParkingPerMinute * usageParkingTimeMinutes).toFixed(2));
            }
            if (sessionEvChargingBasicFees && sessionEvChargingBasicFees.feeChargingPerMinute) {
                totalAmountInclVat = Number((totalAmountInclVat).toFixed(2)) + Number((feeChargingPerMinute * usageChargingTimeMinutes).toFixed(2));
                feeSessionChargingTime = Number((feeChargingPerMinute * usageChargingTimeMinutes).toFixed(2));
            }
        }
        context.log('totalAmountInclVat = ' + totalAmountInclVat);

        //Is this posSession paid by a customer with special prices?
        let agreementValues;
        if (posSession.customerID) {
            try {
                agreementValues = await relatedFile.getPriceFromCustomerAgreement(collection, posSession, totalAmountInclVat, context, pricePerUnit);
                context.log('agreementValues = ' + JSON.stringify(agreementValues));
            } catch (error) {
                context.log(error);
            }
            if (posSession.priceType === 'pricePerUnit' && agreementValues && agreementValues.updatedPrice) {
                totalAmountInclVat = Number((agreementValues.updatedPrice * quantity).toFixed(2));
                context.log('Agreement prices set = ' + JSON.stringify(agreementValues.updatedPrice));
            }
        }
        //if ((!agreementValues || !agreementValues.updatedPrice) && posSession.priceType !== 'fixedPrice') {
        //    totalAmountInclVat = Number((posSession.salesPrice * quantity).toFixed(2));
        //}

        context.log('preAuthorizationAmount = ' + preAuthorizationAmount + ' and totalAmountInclVat = ' + totalAmountInclVat);
        let amount;
        if (preAuthorizationAmount)
            amount = Number(preAuthorizationAmount) - totalAmountInclVat;
        if (amount < 0)
            amount = preAuthorizationAmount;
        amount = amount ? Number(Number(amount).toFixed(2)) : amount;
        context.log(amount);
        
        let refundable = true, isSessionError = false;
        if (preAuthorizationAmount && Number(preAuthorizationAmount) < totalAmountInclVat) {
            context.log('preAuthorizationAmount is smaller then amount');
            if (posSession.pspType !== 'planetpayment' && posSession.pspType !== 'accessToken') {
                refundable = false;
                isSessionError = true;
                totalAmountInclVat = Number(preAuthorizationAmount);
            }

        }
        if (req.body.statusCodeReason) {
            posSessionStopReason = req.body.statusCodeReason;
        }
        const updatedPosSession = await collection.updateOne({ _id: posSession._id, docType: 'posSessions', partitionKey: posSession._id },
            {
                $set: Object.assign({}, {
                    usageTotalVolume,
                    usageTotalTimeMinutes: Number(usageTotalTimeMinutes.toFixed(1)),
                    totalAmountInclVat,
                    totalVatAmount,
                    usageRecords,
                    usageParkingTimeMinutes,
                    usageChargingTimeMinutes,
                    feeSessionFixed,
                    feeSessionStart,
                    feeSessionEnergy,
                    feeSessionParkingTime,
                    feeSessionChargingTime,
                    posSessionStopReason,
                    ttl: 60 * 60 * 24 * 400,
                    updatedDate: new Date()
                })
            });
        if (updatedPosSession.matchedCount)
            console.log('pos session is updated');
        posSession = await collection.findOne({ _id: posSession._id, partitionKey: posSession.partitionKey });
        context.log('updated posSession = ' + JSON.stringify(posSession));
        
        await relatedFile.autoRefunded(pointOfService, collection, posSession, totalAmountInclVat, posSessionOld, context);
        
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

        let resultReasonText, isPlanetError = false;
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
                    body: { amount: totalAmountInclVat * 100 },
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
            let reqBody;
            try {
                reqBody = {
                    amount: totalAmountInclVat,
                    requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                    requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                    requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                    SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                    token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                    bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                    currency: checkoutSession.currency,
                    timeZone: pointOfService.timeZone,
                    posSessionID: posSession._id
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
                if (totalAmountInclVat === 0) {
                    context.log('amount is 0');
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/planet-preauth-reversal?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                } else
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                context.log(result);
            } catch (error) {
                context.log(error);
                if (posSession.soFarPreAuthAmount) {
                    context.log('soFarPreAuthAmount = ' + posSession.soFarPreAuthAmount);
                    totalAmountInclVat = posSession.soFarPreAuthAmount;
                } else {
                    totalAmountInclVat = Number(preAuthorizationAmount);
                }
                reqBody.amount = totalAmountInclVat;
                try {
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                    context.log(result);
                } catch (error) {
                    context.log(error);
                    isPlanetError = true;
                    if (error.error && error.error.result && error.error.result.includes('<ResultReason>') && error.error.result.includes('</ResultReason>')) {
                        resultReasonText = error.error.result.split('<ResultReason>');
                        resultReasonText = resultReasonText[1].split('</ResultReason>')[0];
                    }
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
               
            if (agreementValues) {
                if (!posSession.vatPercent) posSession.vatPercent = product.vatPercent;
                context.log(posSession.vatPercent);
            
                if (agreementValues.updatedPrice && posSession.vatPercent)
                    totalVatAmount = Number((agreementValues.updatedPrice - (agreementValues.updatedPrice / ((posSession.vatPercent / 100) + 1))).toFixed(2));
                await collection.updateOne({ _id: posSession._id, partitionKey: posSession._id },
                    { $set: {
                        customerAgreementID: agreementValues.customerAgreement._id,
                        agreementPrices: agreementValues.agreementPrices,
                        salesPriceBeforeDiscount: totalAmountInclVat,
                        salesPriceAfterDiscount: agreementValues.updatedPrice,
                        totalAmountInclVat: agreementValues.updatedPrice,
                        totalVatAmount: totalVatAmount
                    }});
                if (agreementValues.updatedPrice) totalAmountInclVat = agreementValues.updatedPrice;
            }
            
            context.log('Paid with accessToken totalAmountInclVat: ' + totalAmountInclVat);
            if (!retailTransaction) {
                context.log('Did not find any retailTransaction, creating one now');
                req.body.pspType = 'accesstoken';
                req.body.posSessionID = posSession._id;
                req.body.userSessionID = posSession.pointOfServiceID;
                result = await checkoutUtiles.createCheckoutSessionByAccessToken(req, pointOfService, product, totalAmountInclVat, quantity, context);
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
            result = await utils.stripePaymentCapture(posSession.paymentID, totalAmountInclVat, stripeAccount, context);
        } else if (refundable === true && posSession.pspType === 'vipps') {
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-capture?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                json: true,
                body: {
                    merchantSerialNumber: checkoutSession.merchantSerialNumber,
                    orderID: checkoutSession.orderID,
                    amount: totalAmountInclVat,
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
        context.log('final totalAmountInclVat = ' + totalAmountInclVat);
        if (retailTransaction)
            newRetailTransaction = await relatedFile.updatedRetailTransActions(collection, retailTransaction, totalAmountInclVat, posSession, quantity, context, isPlanetError, resultReasonText);
        context.log(newRetailTransaction);
        const updatedBody = {
            paymentStatusCode: 'paid',
            currency: pointOfService ? pointOfService.currency : checkoutSession.currency,
            totalAmountInclVat: totalAmountInclVat
        };
        if (resultReasonText) {
            updatedBody.paymentStatusCode = 'failed';
        }
        const statusUpdated = await collection.updateOne({ _id: posSession._id, docType: 'posSessions', partitionKey: posSession._id },
            { $set: updatedBody });
        if (statusUpdated.matchedCount)
            context.log('pos session status is updated');
        await relatedFile.deleteSession(collection, posSession);
        if (posSession.pspType === 'accessToken') {
            await relatedFile.updateAccountingTrans(totalAmountInclVat, totalVatAmount, usageTotalVolume, usageTotalTimeMinutes, usageParkingTimeMinutes, newRetailTransaction, retailTransaction, context);
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
        if (resultReasonText) {
            context.res = {
                body: {
                    description: result
                }
            };
        } else
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

