'use strict';

const utils = require('../utils');
const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const Swish = require('../utils/swish-payment');
const errors = require('../errors');
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/invers-retail-transaction');
const uuid = require('uuid');

//BASE-76.

module.exports = async (context, req) => {
    try {
        context.log('req.body ' + JSON.stringify(req.body));
        context.log('checkoutSessionID ' + req.params.checkoutSessionID);
        await utils.validateUUIDField(context, `${req.params.checkoutSessionID}`, 'The checkoutSessionID specified in the request body does not match the UUID v4 format.');
        if (!req.body)
            req.body = {};
        const collection = await getMongodbCollection('Orders');
        let checkoutSession = await collection.findOne({
            _id: req.params.checkoutSessionID,
            partitionKey: req.params.checkoutSessionID,
            $or: [{ 'docType': 'checkoutSessionCompleted' }, { 'docType': 'checkoutSession' }]
        });

        const retailTransaction = await collection.findOne({
            checkoutSessionID: req.params.checkoutSessionID,
            docType: 'retailTransaction'
        });
        if (retailTransaction && retailTransaction.checkoutSessionDoc && !checkoutSession)
            checkoutSession = retailTransaction.checkoutSessionDoc;
        if (!checkoutSession && retailTransaction) {
            checkoutSession = {
                pspType: retailTransaction.pspType
            };
        }
        if (!checkoutSession) {
            utils.setContextResError(
                context,
                new errors.CheckoutSessionNotFoundError(
                    'The checkout session id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        if (req.body.reasonForRefund || (req.body.sessionResultCode && req.body.sessionResultCode.toLowerCase() === 'failed')) {
            checkoutSession.sessionResultCode = 'failed';
        }
        if (checkoutSession.pspType === 'creditcard') {
            if (checkoutSession.sessionResultCode === 'completed') {
                const session = await collection.findOne({
                    _id: req.body.sessionID,
                    partitionKey: req.body.sessionID,
                    docType: 'session'
                });
                if (!session) {
                    utils.setContextResError(
                        context,
                        new errors.SessionNotFoundError(
                            'The session id specified in the URL doesn\'t exist.',
                            404
                        )
                    );
                    return Promise.resolve();
                }
                const result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/v1/hips-fullfill-order/${session.paymentProviderReference}?paymentProviderAccountID=${session.paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            } else if (checkoutSession.sessionResultCode === 'failed') {
                if (checkoutSession.paymentTransactionResponse && !checkoutSession.paymentTransactionResponse.paymentId) {
                    utils.setContextResError(
                        context,
                        new errors.PaymentNotRefundableError(
                            'The payment is not able to refund.',
                            404
                        )
                    );
                    return Promise.resolve();
                }
                const result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/v1/hips-refund-payment/${checkoutSession.paymentTransactionResponse.paymentId}?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
                    json: true,
                    body: { amount: req.body.refundAmount * 100 },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            }
        } else if (checkoutSession.pspType === 'planetpayment') {
            if (checkoutSession.sessionResultCode === 'completed') {
                const session = await collection.findOne({
                    _id: req.body.sessionID,
                    partitionKey: req.body.sessionID,
                    docType: 'session'
                });
                if (!session) {
                    utils.setContextResError(
                        context,
                        new errors.SessionNotFoundError(
                            'The session id specified in the URL doesn\'t exist.',
                            404
                        )
                    );
                    return Promise.resolve();
                }
                if (checkoutSession.paymentTransactionResponse)
                    context.log(checkoutSession.paymentTransactionResponse.sCATransRef);
                const reqBody = {
                    amount: req.body.refundAmount,
                    requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                    requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                    requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                    bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                    token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                    SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                    currency: checkoutSession.currency
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
                let result;
                try {
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                    context.log(result);
                } catch (error) {
                    let resultReasonText;
                    if (error.error && error.error.result && error.error.result.includes('<ResultReason>') && error.error.result.includes('</ResultReason>')) {
                        resultReasonText = error.error.result.split('<ResultReason>');
                        resultReasonText = resultReasonText[1].split('</ResultReason>')[0];
                    }
                    await collection.updateOne({ _id: checkoutSession._id }, { $set: { transactionResult: 'failed', resultReasonText: resultReasonText }});
                }
            } else if (checkoutSession.sessionResultCode === 'failed') {
               
                const reqBody = {
                    amount: retailTransaction.totalAmountInclVat,
                    requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                    requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                    requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                    token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                    bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                    SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                    currency: checkoutSession.currency
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
                try {
                    let result;
                    if (checkoutSession.paymentTransactionResponse && checkoutSession.paymentTransactionResponse.type === 'EftSettlementEmv') {
                        result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/planet-sale-reversal?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
                            json: true,
                            body: reqBody,
                            headers: {
                                'x-functions-key': process.env.PAYMENTS_API_KEY
                            }
                        });
                    } else if (checkoutSession.paymentTransactionResponse && checkoutSession.paymentTransactionResponse.type === 'EftAuthorizationEmv') {
                        result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/planet-completion-reversal?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
                            json: true,
                            body: reqBody,
                            headers: {
                                'x-functions-key': process.env.PAYMENTS_API_KEY
                            }
                        });
                    }
                    context.log(result);
                } catch (error) {
                    context.log(error);
                }
            }
        } else if (checkoutSession.pspType === 'swish') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${retailTransaction.paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                let payerAlias;
                if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings && paymentProviderAccountsDoc.settings.swish)
                    payerAlias = paymentProviderAccountsDoc.settings.swish.swishNumber;
                const isTesting = process.env.IS_TESTING;
                req.body.currency = checkoutSession.currency;
                if (!req.body.currency)
                    req.body.currency = 'SEK';
                if (!req.body.amount)
                    req.body.amount = retailTransaction.totalAmountInclVat;

                req.body.cancelBody = {
                    callbackUrl: process.env.CALLBACK_URL,
                    payerAlias: payerAlias.toString(),
                    amount: req.body.amount.toString(),
                    currency: req.body.currency,
                    message: req.body.reasonForRefund
                };
                if (checkoutSession.swishCallBackResult)
                    req.body.cancelBody.originalPaymentReference = checkoutSession.swishCallBackResult.paymentReference;
                else if (checkoutSession.paymentProviderReference)
                    req.body.cancelBody.originalPaymentReference = checkoutSession.paymentProviderReference;

                const instructionUUID = uuid.v4();
                req.instructionUUID = instructionUUID.replace(/-/ig, '').toUpperCase();
                //req.instructionUUID = checkoutSession.paymentProviderReference;
                let result = await Swish.swishPayment(req, context, isTesting, checkoutSession.paymentID);
                context.log(result);
                let paymentResult;
                if (result && result.location)
                    paymentResult = 'approved';
                else
                    paymentResult = 'denied';
                await utils.createPaymentLogs(checkoutSession, result, 'refund', req.body.amount, paymentResult);
                if (result && Array.isArray(result) && result.length > 0 && result[0].errorCode) {
                    result = {
                        reasonPhrase: 'paymentError',
                        error: result[0]
                    };
                    return context.res = {
                        body: result
                    };
                }
            }
        } else if (checkoutSession.pspType === 'bluecode') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/bluecode-refund`, {
                    json: true,
                    body: {
                        acquirer_tx_id: checkoutSession.payment.acquirer_tx_id,
                        amount: checkoutSession.payment.total_amount,
                        reason: 'Customer does not like item',
                        paymentProviderAccountID: checkoutSession.paymentProviderAccountID
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
                if (result && result.reasonPhrase) {
                    return context.res = {
                        body: result
                    };
                }
            }
        } else if (checkoutSession.pspType === 'mobilePay') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/mobilePay-refund`, {
                    json: true,
                    body: {
                        paymentID: checkoutSession.paymentID,
                        amount: checkoutSession.payment.total_amount,
                        reason: 'Customer does not like item',
                        paymentProviderAccountID: checkoutSession.paymentProviderAccountID
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
                if (result && result.reasonPhrase) {
                    return context.res = {
                        body: result
                    };
                }
            }
        } else if (checkoutSession.pspType === 'accessToken') {
            await request.post(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/refund-transaction/${checkoutSession.accountTransactionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.BILLING_SERVICE_API_KEY
                }
            });
        } else if (checkoutSession.pspType === 'stripe') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${retailTransaction.paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                let stripeAccount;
                if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings)
                    stripeAccount = paymentProviderAccountsDoc.settings.stripeAccount;
                const change = checkoutSession.changeID;

                context.log(change);

                const result = await utils.stripeRefund(change, stripeAccount, context);

                context.log(result);
            
                return context.res = {
                    body: result
                };
                
            }
        } else if (checkoutSession.pspType === 'vipps') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-refund?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                    json: true,
                    body: {
                        merchantSerialNumber: checkoutSession.merchantSerialNumber,
                        orderID: checkoutSession.orderID,
                        amount: req.body.refundAmount,
                        transactionText: req.body.reasonForRefund,
                        xRequestID: checkoutSession.paymentRequestID
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            }
        } else if (checkoutSession.pspType === 'blink') {
            if (checkoutSession && checkoutSession.sessionResultCode === 'completed') {
                return true;
            } else if (checkoutSession && checkoutSession.sessionResultCode === 'failed') {
                const auth = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/blink-auth-token?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/blink-refund?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                    json: true,
                    body: {
                        orgTxnId: checkoutSession.requestId,
                        transactionAmount: req.body.refundAmount,
                        remarks: req.body.reasonForRefund,
                        posSessionID: checkoutSession.posSessionID,
                        merchantID: checkoutSession.merchantID,
                        token: auth
                    },
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                context.log(result);
            }
        }

        if (checkoutSession.sessionResultCode === 'failed') {
            if (!req.body.refundAmount)
                req.body.refundAmount = retailTransaction.totalAmountInclVat;
            const newRetailTransaction = await retailTransactionUtils.createRetailTransActions(retailTransaction, req.body.refundAmount);
            if (newRetailTransaction.ops)
                CustomLogs(`negative retailTransaction doc created with id ${newRetailTransaction.ops[0]._id} for checkoutSessionID ${req.params.checkoutSessionID}`, context);
        }
     
        context.res = {
            body: {
                description: 'Successfully finalize checkout session.'
            }
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};