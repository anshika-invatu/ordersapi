'use strict';

const Promise = require('bluebird');
const validator = require('validator');
const errors = require('../errors');
const uuid = require('uuid');
const { MongoError } = require('mongodb');
const crypto = require('crypto');
const { productApiErrorCodes } = require('../errors/api-error-codes');
const Stripe = require('stripe');
var winston = require('winston');
require('winston-loggly-bulk');
const request = require('request-promise');
const Swish = require('./swish-payment');
const retailTransactionUtils = require('./invers-retail-transaction');
const { ServiceBusClient } = require('@azure/service-bus');



exports.logInfo = (message) => {
    var logMessage = Object.assign({}, message);
    logMessage.functionName = 'OrdersApi';
    logMessage.code = 200;

    winston.configure({
        transports: [
            new winston.transports.Loggly({
                token: process.env.LOGGLY_TOKEN,
                subdomain: 'vourity',
                tags: ['Winston-NodeJS'],
                json: true
            })
        ]
    });

    winston.info(logMessage);
};

exports.logEvents = (message) => {
    var error = Object.assign({}, message);
    error.functionName = 'OrdersApi';
    winston.configure({
        transports: [
            new winston.transports.Loggly({
                token: process.env.LOGGLY_TOKEN,
                subdomain: 'vourity',
                tags: ['Winston-NodeJS'],
                json: true
            })
        ]
    });

    winston.log('error', error);
};


exports.handleError = (context, error) => {
    context.log('Exception logs : ' + error);
    switch (error.constructor) {
        case errors.RefundExpired:
        case errors.DuplicateOrderError:
        case errors.EmptyRequestBodyError:
        case errors.InvalidUUIDError:
        case errors.OrderNotFoundError:
        case errors.FieldValidationError:
        case errors.MissingStripeAmountError:
        case errors.MissingStripeCurrencyError:
        case errors.MissingStripeDescriptionError:
        case errors.MissingStripeVatAmountError:
        case errors.MissingStripeUserSessionIdError:
        case errors.PaymentTransactionError:
        case errors.MissingStripeTokenError:
        case errors.MissingStripeReceiptEmailError:
        case errors.MissingStripeCartIdError:
        case errors.CartNotFoundError:
        case errors.RefundNotAllowed:
            this.setContextResError(context, error);
            break;
        case MongoError:
            this.handleMongoErrors(context, error);
            break;
        default:
            this.handleDefaultError(context, error);
            break;
    }
};

exports.validateUUIDField = (context, id, message = 'The order id specified in the URL does not match the UUID v4 format.') => {
    return new Promise((resolve, reject) => {
        if (validator.isUUID(id, 4)) {
            resolve();
        } else {
            reject(
                new errors.InvalidUUIDError(message, 400)
            );
        }
    });
};

/**
 *
 * @param {any} context Context object from Azure function
 * @param {BaseError} error Custom error object of type base error
 */
exports.setContextResError = (context, error) => {
    const body = {
        code: error.code,
        description: error.message,
        reasonPhrase: error.name
    };
    context.res = {
        status: error.code,
        body: body
    };
    this.logEvents(body);
};

exports.handleDefaultError = (context, error) => {
    const response = error.error;
    if (response && !response.reasonPhrase && response.description) {
        response.reasonPhrase = 'Error';
        response.code = error.statusCode;
    }
    if (response && response.reasonPhrase) {
        if (productApiErrorCodes.includes(response.reasonPhrase)) {
            const errorFormatted = new errors.ProductApiError(
                response.reasonPhrase,
                response.description,
                response.code
            );

            this.setContextResError(
                context,
                errorFormatted
            );
            this.logKnownErrors(context, errorFormatted);
        } else {
            const errorFormatted = new errors.PaymentApiError(
                error.error.reasonPhrase,
                error.error.description,
                error.error.code
            );
            this.setContextResError(
                context,
                errorFormatted
            );
        }
    } else if (error.type === 'StripeInvalidRequestError') {
        const errorFormatte = {
            name: error.type,
            message: error.message,
            code: error.statusCode
        };
        this.setContextResError(
            context,
            errorFormatte
        );
        this.logKnownErrors(context, errorFormatte);
    } else {
        handleOrderApiServerError(error, context);
    }
};

exports.handleMongoErrors = (context, error) => {
    switch (error.code) {
        case 11000:
            this.setContextResError(
                context,
                new errors.DuplicateOrderError(
                    'You\'ve requested to create a new order but an order with the specified _id field already exists.',
                    409
                )
            );
            break;
        default:
            this.handleDefaultError(context, error);
            break;
    }
};

exports.hashToken = token => crypto.createHash('sha512')
    .update(`${token}`)
    .digest('hex');

exports.binanceHashToken = (token, key) => crypto.createHmac('sha512', key)
    .update(token)
    .digest('hex');


exports.formatDateFields = voucher => {
    if (voucher['salesDate']) {
        voucher['salesDate'] = new Date(voucher['salesDate']);
    }

    if (voucher.validPeriod) {
        if (voucher.validPeriod.validFromDate) {
            voucher.validPeriod.validFromDate = new Date(voucher.validPeriod.validFromDate);
        }

        if (voucher.validPeriod.validToDate) {
            voucher.validPeriod.validToDate = new Date(voucher.validPeriod.validToDate);
        }
    }

    return voucher;
};

exports.CustomLogs = (message,context) => {
    var logMessage = {};
    if (!context)
        context = { executionContext: {}};
    let methodName;
    if (context.executionContext)
        methodName = context.executionContext.functionName ? context.executionContext.functionName : null;
    logMessage.methodName = methodName;
    logMessage.logMessage = message;
    logMessage.functionName = 'OrdersApi';
    logMessage.env = process.env.ENV;
    logMessage.type = 'Custom';
   
    winston.configure({
        transports: [
            new winston.transports.Loggly({
                token: process.env.LOGGLY_TOKEN,
                subdomain: 'vourity',
                tags: ['Winston-NodeJS'],
                json: true
            })
        ]
    });

    winston.info(logMessage);
};

exports.logError = (context, error) => {
    const executionContext = context.executionContext;
    context.log({
        invocationId: executionContext.invocationId,
        functionName: executionContext.functionName,
        code: error.code,
        description: error.message,
        reasonPhrase: error.name,
        timestamp: new Date()
    });
};

exports.logKnownErrors = (context, error) => {
    if (process.env.LOG_KNOWN_ERRORS === 'true') {
        this.logError(context, error);
    }
};

const handleOrderApiServerError = (error, context) => {
    const errorFormatted = new errors.OrdersApiServerError(error.message || error, 500);
    this.logError(context, errorFormatted);
    this.setContextResError(context, new errors.OrdersApiServerError('Something went wrong. Please try again later.', 500));
};

exports.createStripeCustomer = (email) => {
    const stripeActivity = 'CreateStripeCustomer';
    const logMessage = {};
    const stripe = Stripe(process.env.STRIPE_API_KEY);

    return new Promise((resolve, reject) => {
        stripe.customers.create({
            email: email,
        }, (err, customer) => {

            if (err) {
                console.log(err);
                logMessage.reasonPhrase = err.type;
                logMessage.code = err.statusCode;
                logMessage.stripeActivity = stripeActivity;
                this.logEvents(logMessage); // logs error
                return reject(err);
            } else {
                logMessage.stripeActivity = stripeActivity;
                logMessage.message = 'Succesfully created stripe customer';
                logMessage.code = 200;
                this.logInfo(logMessage);
                return resolve(customer);
            }
        });
    });
};

exports.stripePaymentIntents = async (posSession, stripeAccount, context) => {

    
    let paymentIntent;
    if (stripeAccount) {
        try {
            const amount = Math.floor(Number(posSession.preAuthorizationAmount) * 100);
            const currency = posSession.currency.toLowerCase();
            const Stripe = require('stripe')(process.env.STRIPE_API_KEY);
            Stripe.stripeAccount = stripeAccount;
            
            paymentIntent = await request.post(process.env.STRIPE_URL + '/v1/payment_intents', {
                form: {
                    amount: amount,
                    currency: currency,
                    payment_method_types: ['card'],
                    payment_method_options: {
                        card: {
                            capture_method: 'manual'
                        }
                    }
                },
                json: true,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Bearer ' + process.env.STRIPE_API_KEY,
                    'Stripe-Account': stripeAccount
                }
            });
            if (context)
                context.log(paymentIntent);
        } catch (error) {
            context.log(error);
        }
    } else {
        const stripe = Stripe(process.env.STRIPE_API_KEY);
        paymentIntent = await stripe.paymentIntents.create({
            amount: Math.floor(Number(posSession.preAuthorizationAmount) * 100),
            currency: posSession.currency.toLowerCase(),
            payment_method_types: ['card'],
            payment_method_options: {
                card: {
                    capture_method: 'manual',
                },
            },
        });
    }
    return paymentIntent;
};

exports.stripeRefund = async (change, stripeAccount, context) => {
    let response;
    if (stripeAccount) {
        try {
            const Stripe = require('stripe')(process.env.STRIPE_API_KEY);
            Stripe.stripeAccount = stripeAccount;
            
            response = await request.post(process.env.STRIPE_URL + '/v1/refunds', {
                form: {
                    charge: change
                },
                json: true,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Bearer ' + process.env.STRIPE_API_KEY,
                    'Stripe-Account': stripeAccount
                }
            });
            if (context)
                context.log(response);
        } catch (err) {
            if (context)
                context.log(err);
        }
    } else {
        const stripe = Stripe(process.env.STRIPE_API_KEY);
        response = await stripe.refunds.create({
            charge: change,
        });
    }
    return response;
};

exports.stripePaymentCapture = async (paymentID, amount, stripeAccount, context) => {
    let paymentCapture;
    if (stripeAccount) {
        try {
            const Stripe = require('stripe')(process.env.STRIPE_API_KEY);
            Stripe.stripeAccount = stripeAccount;
            
            paymentCapture = await request.post(`${process.env.STRIPE_URL}/v1/payment_intents/${paymentID}/capture`, {
                form: {
                    amount_to_capture: Math.floor(Number(amount) * 100)
                },
                json: true,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Bearer ' + process.env.STRIPE_API_KEY,
                    'Stripe-Account': stripeAccount
                }
            });
            if (context)
                context.log(paymentCapture);
        } catch (err) {
            if (context)
                context.log(err);
        }
    } else {
        const stripe = Stripe(process.env.STRIPE_API_KEY);
        paymentCapture = await stripe.paymentIntents.capture(paymentID, {
            amount_to_capture: Math.floor(Number(amount) * 100),
        });
    }
    return paymentCapture;
};

exports.updateStripeSourceToken = (customerId,stripeSourceToken) => {
    const stripeActivity = 'UpdateStripeSourceToken';
    const logMessage = {};
    const stripe = Stripe(process.env.STRIPE_API_KEY);

    return new Promise((resolve,reject) => {
        stripe.customers.update(customerId,{
            source: stripeSourceToken,
        }, (err) => {

            if (err) {
                console.log(err);
                logMessage.reasonPhrase = err.type;
                logMessage.code = err.statusCode;
                logMessage.stripeActivity = stripeActivity;
                this.logEvents(logMessage); // logs error
                return reject(err);
            } else {
                logMessage.stripeActivity = stripeActivity;
                logMessage.message = 'Succesfully update stripe token';
                logMessage.code = 200;
                this.logInfo(logMessage);
                return resolve(true);
            }
        });
    });
};

exports.createStripeCheckoutSessions = (async (context, line_items, successfulUrl, failedUrl, userSessionID, email, apiKey) => {
    return new Promise((resolve, reject) => {
        const stripe = Stripe(apiKey);
        return stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: line_items,
            success_url: successfulUrl,
            cancel_url: failedUrl,
            client_reference_id: userSessionID,
            customer_email: email
        }, (err, session) => {
            if (err) {
                context.log(err);
                return reject(err);
            } else {
                return resolve(session);
            }
        });
    });
});


exports.getStripeCharge = (async (context, orderSession) => {
    return new Promise((resolve, reject) => {
        const stripe = Stripe(process.env.STRIPE_API_KEY);
        return stripe.charges.list({
            payment_intent: orderSession.payment_intent,
            //customer: orderSession.customer,
            limit: 1
        }, (err, charges) => {
            if (err) {
                context.log(err);
                return reject(err);
            } else {
                context.log(charges.data.length);
                return resolve(charges.data.find(x=>x)); // return first element from array
            }
        });
    });
});

exports.sendMessageToAzureBus = async (topic, message, context) => {
    if (topic && message) {
        const serviceBusClient = new ServiceBusClient(process.env.AZURE_BUS_CONNECTION_STRING);

        const sender = serviceBusClient.createSender(topic);

        const messages = { body: message, messageId: uuid.v4() };

        try {
            await sender.sendMessages(messages);
            if (context)
                context.log('Message sent');
            return true;
        } catch (error) {
            if (context)
                context.log(error);
            return false;
        }
    }
};

exports.createRefund = async (posSession, collection, context, autoRefundedLowUsage, transcations)=> {
    try {
        let result, retailTransaction;
        if (transcations)
            retailTransaction = transcations;
        if (!retailTransaction)
            retailTransaction = await collection.findOne({
                _id: posSession.retailTransactionID,
                retailTransactionStatusCode: 'pending',
                $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
            });
        if (!retailTransaction) {
            context.log('retail transaction status code is not pending');
            return Promise.resolve();
        }
        if (retailTransaction)
            this.CustomLogs(`get retailTransaction(${retailTransaction._id}) posSession doc with id ${posSession}`, context);
        let checkoutSession;
        if (retailTransaction)
            checkoutSession = await collection.findOne({
                _id: retailTransaction.checkoutSessionID,
                $or: [{ 'docType': 'checkoutSessionCompleted' }, { 'docType': 'checkoutSession' }]
            });
        context.log(checkoutSession);
        if (checkoutSession)
            this.CustomLogs(`get checkoutSession(${checkoutSession._id}) posSession doc with id ${posSession}`, context);
        if (posSession.pspType === 'creditcard') {
            this.CustomLogs(`running creditcard refund posSession doc with id ${posSession._id}`, context);
            if (checkoutSession && checkoutSession.paymentTransactionResponse && !checkoutSession.paymentTransactionResponse.paymentId) {
                this.setContextResError(
                    context,
                    new errors.PaymentNotRefundableError(
                        'The payment is not able to refund.',
                        404
                    )
                );
                return Promise.resolve();
            }
            result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/v1/hips-refund-payment/${checkoutSession.paymentTransactionResponse.paymentId}?paymentProviderAccountID=${posSession.paymentProviderAccountID}`, {
                json: true,
                body: { amount: posSession.totalAmountInclVat * 100 },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            this.CustomLogs(`result ${result} of creditcard posSession doc with id ${posSession._id}`, context);
        } else if (posSession.pspType === 'planetpayment') {
            const reqBody = {
                amount: checkoutSession.totalAmountInclVat,
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
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/planet-preauth-reversal?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
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
        } else if (posSession.pspType === 'swish') {
            context.log('Doing Swish refund');
            this.CustomLogs(`running swish refund posSession doc with id ${posSession._id}`, context);
            const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${posSession.paymentProviderAccountID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            let payerAlias;
            if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings && paymentProviderAccountsDoc.settings.swish)
                payerAlias = paymentProviderAccountsDoc.settings.swish.swishNumber;
            const isTesting = process.env.IS_TESTING;
            const reqBody = {};
            reqBody.body = {};
            
            const currency = checkoutSession.currency ? checkoutSession.currency : posSession.currency;
            
            reqBody.body.cancelBody = {
                callbackUrl: process.env.CALLBACK_URL,
                payerAlias: payerAlias.toString(),
                amount: retailTransaction.totalAmountInclVat ? retailTransaction.totalAmountInclVat.toString() : posSession.totalAmountInclVat.toString(),
                currency: currency,
                message: ''
            };
            const paymentID = checkoutSession.paymentID ? checkoutSession.paymentID : posSession.paymentID;
            // if (posSession.swishCallBackResult)
            //     reqBody.body.cancelBody.originalPaymentReference = posSession.swishCallBackResult.paymentReference;
            if (checkoutSession && checkoutSession.paymentProviderReference) {
                reqBody.body.cancelBody.originalPaymentReference = checkoutSession.paymentProviderReference;
                reqBody.instructionUUID = checkoutSession.paymentProviderReference;
            }
            if (checkoutSession && checkoutSession.swishCallBackResult) {
                reqBody.body.cancelBody.originalPaymentReference = checkoutSession.swishCallBackResult.paymentReference;
                reqBody.instructionUUID = checkoutSession.swishCallBackResult.payeePaymentReference;
            }
            context.log('Swish refund reqbody: ' + JSON.stringify(reqBody));
            context.log('paymentID' + paymentID);
            result = await Swish.swishPayment(reqBody, context, isTesting, paymentID);
            context.log('Swish refund result: ' + result.toString());
            this.CustomLogs(`result ${result.toString()} of swish posSession doc with id ${posSession._id}`, context);
            if (result && Array.isArray(result) && result.length > 0 && result[0].errorCode) {
                this.CustomLogs(`error code ${result[0].errorCode} of swish refund posSession doc with id ${posSession._id}`, context);
                result = {
                    reasonPhrase: 'paymentError',
                    error: result[0]
                };
                return context.res = {
                    body: result
                };
            }

        } else if (posSession.pspType === 'bluecode') {
            this.CustomLogs(`running bluecode refund posSession doc with id ${posSession._id}`, context);
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/bluecode-refund`, {
                json: true,
                body: {
                    acquirer_tx_id: checkoutSession.payment.acquirer_tx_id,
                    amount: checkoutSession.payment.total_amount,
                    reason: 'Customer does not like item',
                    paymentProviderAccountID: posSession.paymentProviderAccountID
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            context.log(result);
            this.CustomLogs(`result ${result.toString()} of bluecode posSession doc with id ${posSession._id}`, context);
            if (result && result.reasonPhrase) {
                return context.res = {
                    body: result
                };
            }

        } else if (posSession.pspType === 'mobilePay') {
            this.CustomLogs(`running mobilepay refund posSession doc with id ${posSession._id}`, context);
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/mobilePay-refund`, {
                json: true,
                body: {
                    paymentID: checkoutSession.paymentID,
                    amount: checkoutSession.payment.total_amount,
                    reason: 'Customer does not like item',
                    paymentProviderAccountID: posSession.paymentProviderAccountID
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            this.CustomLogs(`result ${result.toString()} of mobilePay posSession doc with id ${posSession._id}`, context);
            context.log(result);
            if (result && result.reasonPhrase) {
                return context.res = {
                    body: result
                };
            }
        } else if (posSession.pspType === 'stripe') {
            if (checkoutSession && checkoutSession.paymentID) {
                const paymentProviderAccount = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${checkoutSession.paymentProviderAccountID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
                const stripeAccount = paymentProviderAccount.settings ? paymentProviderAccount.settings.stripeAccount : '';
                const Stripe = require('stripe')(process.env.STRIPE_API_KEY);
                Stripe.stripeAccount = stripeAccount;
                try {
                    result = await request.post(`${process.env.STRIPE_URL}/v1/payment_intents/${checkoutSession.paymentID}/cancel` , {
                        json: true,
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Authorization': 'Bearer ' + process.env.STRIPE_API_KEY,
                            'Stripe-Account': stripeAccount
                        }
                    });
                    //result = await Stripe.paymentIntents.cancel(checkoutSession.paymentID);
                    context.log(result);
                    this.CustomLogs(`get result(${result}) for stripe with posSession doc with id ${posSession._id}`, context);
                    if (typeof result === 'object')
                        this.CustomLogs(`get result(${JSON.stringify(result)}) for stripe with posSession doc with id ${posSession._id}`, context);
                    return result;
                } catch (error) {
                    context.log(error);
                }
            } else if (checkoutSession && checkoutSession.changeID) {
                const stripe = Stripe(process.env.STRIPE_API_KEY);
                result = await stripe.refunds.create({
                    charge: checkoutSession.changeID,
                });
                context.log(result);
                this.CustomLogs(`get result(${result}) for stripe with posSession doc with id ${posSession._id}`, context);
                if (typeof result === 'object')
                    this.CustomLogs(`get result(${JSON.stringify(result)}) for stripe with posSession doc with id ${posSession._id}`, context);
            }
        } else if (posSession.pspType === 'vipps') {
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-refund?paymentProviderAccountID=${retailTransaction.paymentProviderAccountID}`, {
                json: true,
                body: {
                    merchantSerialNumber: checkoutSession.merchantSerialNumber,
                    orderID: checkoutSession.orderID,
                    amount: checkoutSession.totalAmountInclVat,
                    transactionText: 'error'
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            context.log(result);
            this.CustomLogs(`get result(${result}) for vipps with posSession doc with id ${posSession._id}`, context);
            if (typeof result === 'object')
                this.CustomLogs(`get result(${JSON.stringify(result)}) for vipps with posSession doc with id ${posSession._id}`, context);
            context.log(result);
            return result;
        } else if (posSession.pspType === 'vipps') {
            await request.post(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/refund-transaction/${checkoutSession.accountTransactionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.BILLING_SERVICE_API_KEY
                }
            });
        }
        
        if (!autoRefundedLowUsage) {
            try {
                const reqBody = {};
                reqBody.body = {};
                reqBody.body.refundAmount = posSession.totalAmountInclVat;
                const retailTransactionDoc = await collection.findOne({ _id: posSession.retailTransactionID, docType: 'retailTransaction', partitionKey: posSession.retailTransactionID });
                if (retailTransactionDoc)
                    retailTransaction = retailTransactionDoc;
                this.CustomLogs(`existing retailT creditcard posSession doc with id ${posSession._id}`, context);
                const newRetailTransaction = await retailTransactionUtils.createRetailTransActions(retailTransaction, posSession.totalAmountInclVat);
                if (newRetailTransaction.ops)
                    this.CustomLogs(`negative retailTransaction doc created with id ${newRetailTransaction.ops[0]._id} for posSessionID ${posSession._id}`, context);
            } catch (err) {
                context.log(err);
            }
        }
        return result;
    } catch (error) {
        this.CustomLogs(`get error(${error} with posSession doc with id ${posSession._id}`, context);
        context.log(error);
    }
};

exports.sendMessageToAzureBusQueue = async (queueName, message, context) => {
    if (queueName && message) {
        const serviceBusClient = new ServiceBusClient(process.env.AZURE_BUS_CONNECTION_STRING);

        const sender = serviceBusClient.createSender(queueName);

        const messages = { body: message, messageId: uuid.v4(), sessionId: uuid.v4() };

        try {
            await sender.sendMessages(messages);
            if (context)
                context.log('Message sent');
            return true;
        } catch (error) {
            if (context)
                context.log(error);
            return false;
        }
    }
};

exports.date = (dt1, dt2) => {
    return Math.floor(
        (Date.UTC(dt2.getFullYear(),
            dt2.getMonth(),
            dt2.getDate())
            - Date.UTC(dt1.getFullYear(),
                dt1.getMonth(), dt1.getDate())) / (1000 * 60 * 60 * 24));
};


exports.createPaymentLogs = async (checkoutSession, paymentResult, paymentOperationCode = 'sale', amount, paymentResultCode, paymentActionCode = 'request') => {
    const paymentLog = {};
    paymentLog.merchantID = checkoutSession.merchantID,
    paymentLog.retailTransactionID = checkoutSession.retailTransactionID;
    paymentLog.posSessionID = checkoutSession.posSessionID;
    paymentLog.orderID = checkoutSession.orderID;
    paymentLog.checkoutSessionID = checkoutSession._id;
    paymentLog.pspType = checkoutSession.pspType;
    paymentLog.paymentActionCode = paymentActionCode;
    paymentLog.paymentOperationCode = paymentOperationCode;
    paymentLog.paymentResult = paymentResultCode;
    paymentLog.paymentAmount = amount ? amount : checkoutSession.totalAmountInclVat;
    paymentLog.requestURL = `api/v2/paymentrequests/${checkoutSession.paymentProviderReference}`;
    paymentLog.currency = checkoutSession.currency;
    paymentLog.requestData = checkoutSession.requestData ? checkoutSession.requestData : '';
    paymentLog.responseData = checkoutSession.responseData ? checkoutSession.responseData : '';
    paymentLog.payload = paymentResult;
    await request.post(`${process.env.PAYMENT_API_URL}/api/${process.env.PAYMENT_API_VERSION}/payment-log`, {
        body: paymentLog,
        json: true,
        headers: {
            'x-functions-key': process.env.PAYMENT_API_KEY
        }
    });
};