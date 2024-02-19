'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const logger = require('../utils/logger.js');
const Promise = require('bluebird');
const errors = require('../errors');
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const request = require('request-promise');
const uuid = require('uuid');
const Swish = require('../utils/swish-payment');

const PAYMENT_PROVIDER_SWISH = 'swish';
const PAYMENT_PROVIDER_STRIPE = 'stripe';
//This api create create order and paymentTransaction doc with cart doc
//Please refer the story bac-29, 212,251,270, 419, 441 for more details
function getPaymentProvider (req) {
    try {
        return req.body.paymentProvider.toLowerCase();
    } catch (ignored) {
        return PAYMENT_PROVIDER_STRIPE;
    }
}

function createPaymentTransaction ({ req, cartDoc, webShop, transactionDate, amountRefunded, paymentProviderReference, paymentType, extra }) {
    // Create Payment Transaction document
    logger.logInfo('createPaymentTransaction, transactionDate=' + transactionDate);
    const body = {
        _id: uuid.v4(),
        transactionDate: transactionDate,
        transactionStatus: 'Captured',
        orderID: req.body._id,
        amountPaid: Number(req.body.amount),
        amountRefunded: amountRefunded,
        vatAmount: Number(req.body.vatAmount),
        currency: req.body.currency,
        webShopID: cartDoc.webShopID,
        webShopName: cartDoc.webShopName,
        paymentProvider: getPaymentProvider(req), // FIXME? this used to be ucfirst, e.g. Stripe instead of stripe. does it matter?
        paymentProviderReference: paymentProviderReference,
        sellerMerchantID: webShop.ownerMerchantID, //add sellerMerchantID in the paymentTransaction in bac-163.
        paymentType: paymentType,
        extra,
        products: cartDoc.products
    };

    if (!body.amountRefunded) {
        body.amountRefunded = body.amountPaid;
    }


    const url = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions`;

    const options = {
        json: true,
        body,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    };

    logger.logInfo('Creating paymentTransaction');

    return request.post(url, options);
}

function callPaymentProvider (context, webShopDoc) {
    const req = context.req;
    const paymentProvider = getPaymentProvider(req);
    logger.logInfo('Creating ' + paymentProvider + ' Charge');
    if (paymentProvider === PAYMENT_PROVIDER_SWISH) {

        let currency = req.body.currency;
        if (!currency) {
            req.body.currency = 'SEK';
            currency = 'SEK';
        }
        const reqBody = {
            payeeAlias: req.body.swishPhone,
            amount: req.body.amount,
            currency: currency,
            message: req.body.description,
            paymentProviderReference: new Date().getTime(), // passing uuid gave error, maybe too long or must be a number?
        };
        
        const isTesting = process.env.IS_TESTING;
    
        return Swish.swishPayment(reqBody, context, isTesting)
            .then(async swishResult => {
                const params = {
                    merchantID: webShopDoc.ownerMerchantID,
                    pspType: 'swish'
                };
                let paymentResult;
                if (swishResult && swishResult.location)
                    paymentResult = 'approved';
                else
                    paymentResult = 'denied';
                await utils.createPaymentLogs(params, swishResult, '', req.body.amount, paymentResult);
                context.log('createorder: payment done! swishdata: ' + JSON.stringify(swishResult));
                logger.logInfo('createorder: payment done! swishdata: ' + JSON.stringify(swishResult));
                return {
                    transactionDate: new Date(),
                    amountRefunded: 0,
                    payeePaymentReference: swishResult.payeePaymentReference,
                    paymentType: 'Swish', // this is displayed in confirm email?
                    extra: swishResult
                };
            });
    } else if (paymentProvider === PAYMENT_PROVIDER_STRIPE) {
        // Create Stripe charge
        return stripe.charges.create({
            amount: Number(req.body.amount) * 100,
            currency: req.body.currency,
            description: req.body.description,
            source: req.body.stripeToken,
            receipt_email: req.body.email
        })
            .then(stripeCharges => {
                return {
                    transactionDate: new Date(stripeCharges.created * 1000),
                    amountRefunded: stripeCharges.amount_refunded,
                    paymentProviderReference: stripeCharges.id,
                    paymentType: `${stripeCharges.source.funding}${stripeCharges.source.object}`,
                    extra: stripeCharges
                };
            });
    } else {
        throw new Error('unknown paymentprovider');
    }
}

function validateFields (context, req) {
    if (!req.body) {
        utils.setContextResError(
            context,
            new errors.EmptyRequestBodyError(
                'You\'ve requested to create a new order but the request body seems to be empty. Kindly pass the order to be created using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (!req.body.amount) {
        utils.setContextResError(
            context,
            new errors.MissingStripeAmountError(
                'You\'ve requested to create a new order but the request body is missing amount field. Kindly pass the order amount to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (!req.body.vatAmount) {
        utils.setContextResError(
            context,
            new errors.MissingStripeVatAmountError(
                'You\'ve requested to create a new order but the request body is missing vatAmount field. Kindly pass the order vatAmount to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (!req.body.currency) {
        utils.setContextResError(
            context,
            new errors.MissingStripeCurrencyError(
                'You\'ve requested to create a new order but the request body is missing currency field. Kindly pass the order currency to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (!req.body.description) {
        utils.setContextResError(
            context,
            new errors.MissingStripeDescriptionError(
                'You\'ve requested to create a new order but the request body is missing description field. Kindly pass the order description to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    const paymentProvider = getPaymentProvider(req);
    if (paymentProvider === PAYMENT_PROVIDER_STRIPE && !req.body.stripeToken) {
        utils.setContextResError(
            context,
            new errors.MissingStripeTokenError(
                'You\'ve requested to create a new order but the request body is missing stripeToken field. Kindly pass the order stripeToken to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (paymentProvider === PAYMENT_PROVIDER_SWISH && !req.body.swishPhone) {
        utils.setContextResError(
            context,
            new errors.MissingSwishPhoneError(
                'You\'ve requested to create a new order but the request body is missing swishPhone field. Kindly pass the order swishPhone to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (paymentProvider === PAYMENT_PROVIDER_STRIPE && !req.body.email) {
        utils.setContextResError(
            context,
            new errors.MissingStripeReceiptEmailError(
                'You\'ve requested to create a new order but the request body is missing email field. Kindly pass the order email to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    if (!req.body.userSessionId) {
        utils.setContextResError(
            context,
            new errors.MissingStripeUserSessionIdError(
                'You\'ve requested to create a new order but the request body is missing userSessionId field. Kindly pass the order userSessionId to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
}

module.exports = (context, req) => {
    context.log(JSON.stringify(req.body));
    logger.logInfo('validating fields');
    const ret = validateFields(context, req);
    if (ret) {
        return ret;
    }
    logger.logInfo('validating fields OK');

    let pendingOrder, cartDoc, paymentTransactionDoc, paymentProviderResult;
    let isWebShopAvailable = false, webShopDoc;
    const cartUrl = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${req.body.userSessionId}/cart`;

    return utils
        .validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.')
        .then(() => {
            context.log('Validations: Complete');
            context.log('Retrieving user\'s cart document');
            // Get Cart Document
            return request.get(cartUrl, {
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                },
                json: true
            });
        })
        .then(cart => {
            context.log(cart);
            if (!cart) {
                return Promise.reject(
                    new errors.CartNotFoundError(
                        'Cart document for userSessionId specified in the URL doesn\'t exist.',
                        404
                    )
                );
            }

            cartDoc = cart;
            for (let i = 0; (Array.isArray(cartDoc.products) && i < cartDoc.products.length); i++) {
                cartDoc.products[i].vatAmount = Number(Number(cartDoc.products[i].vatAmount).toFixed(2)); // to fixed function return a string
            }

            logger.logInfo('calling paymentprovider');
            context.log('calling paymentprovider');
            return callPaymentProvider(context, webShopDoc);
        })
        .then(res => {
            context.log(res);
            paymentProviderResult = res;
            logger.logInfo('getting collection');
            return getMongodbCollection('Merchants');
        })
        .then(collection => {
            return collection.findOne({
                _id: cartDoc.webShopID,
                docType: 'webshop'
            });
        })
        .then((webShop) => {
            if (webShop && webShop.ownerMerchantID) {
                webShopDoc = webShop;
                isWebShopAvailable = true;
                logger.logInfo('creating payment transaction');
                return createPaymentTransaction(Object.assign({
                    req: req,
                    cartDoc: cartDoc,
                    webShop: webShop
                }, paymentProviderResult));
            } else {
                utils.setContextResError(
                    context,
                    new errors.WebShopNotFoundError(
                        'The webshop doesn\'t exist with this webShopID.',
                        404
                    )
                );
            }
        })
        .then(paymentTransaction => {
            if (paymentTransaction) {
                paymentTransactionDoc = paymentTransaction;
                context.log('Created paymentTransaction');
                return getMongodbCollection('Orders');
            }
        })
        .then(collection => {
            if (collection) {
                // Create Order doc
                pendingOrder = {
                    _id: req.body._id,
                    docType: 'order',
                    orderDate: new Date(),
                    orderStatus: 'Pending',
                    transactionID: paymentTransactionDoc._id,
                    transactionStatus: paymentTransactionDoc.transactionStatus,
                    amountPaid: Number(Number(req.body.amount).toFixed(2)),
                    vatAmount: Number(Number(req.body.vatAmount).toFixed(2)),
                    currency: req.body.currency,
                    webShopID: cartDoc.webShopID,
                    webShopName: cartDoc.webShopName,
                    customerEmail: req.body.email,
                    receiverEmail: req.body.email,
                    receiverMobilePhone: req.body.mobilePhone,
                    products: cartDoc.products,
                    createdDate: new Date(),
                    updatedDate: new Date(),
                    partitionKey: req.body._id,//bac-181 related to partitionKey
                    sellerMerchantID: webShopDoc.ownerMerchantID
                };
                if (req.body.passID) {
                    pendingOrder.passID = req.body.passID;
                }
                if (webShopDoc.issueVouchers !== undefined) {
                    pendingOrder.issueVouchers = webShopDoc.issueVouchers;
                }
                if (webShopDoc.doActions === true && webShopDoc.actions && Array.isArray(webShopDoc.actions)) {
                    webShopDoc.actions.forEach(element => {
                        const doActionDoc = {};
                        doActionDoc._id = uuid.v4();
                        doActionDoc.docType = 'doAction';
                        doActionDoc.partitionKey = doActionDoc._id;
                        doActionDoc.actionCode = element.actionCode;
                        doActionDoc.actionName = element.actionName;
                        doActionDoc.pointOfServiceID = element.pointOfServiceID;
                        doActionDoc.pointofServiceName = element.pointofServiceName;
                        doActionDoc.currency = req.body.currency;
                        doActionDoc.amountPaid = Number(Number(req.body.amount).toFixed(2));
                        doActionDoc.actionParameters = {
                            orderID: pendingOrder._id
                        };
                        doActionDoc.createdDate = new Date();
                        doActionDoc.updatedDate = new Date();
                        utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ACTION_DO, doActionDoc);
                    });
                }
                if (pendingOrder.receiverMobilePhone && !pendingOrder.receiverMobilePhone.includes('+'))
                    pendingOrder.receiverMobilePhone = '+' + pendingOrder.receiverMobilePhone;
                context.log('Creating pendingOrder');

                return collection.insertOne(pendingOrder);
            }
        })
        .then(response => {
            if (response) {
                context.log('Send pendingOrder to Azure Bus for further processing.');
                try {
                    return utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, response.ops[0]);// change azure bus queue to topic(bac-185)
                } catch (err) {
                    context.log(err);
                }
            }
        })
        .then(() => {
            if (isWebShopAvailable) {
                // Clear cart document
                context.log('Deleting cart document.');
                return request.delete(cartUrl, {
                    headers: {
                        'x-functions-key': process.env.PRODUCT_API_KEY
                    },
                    json: true
                });
            }
        })
        .then(() => {
            if (isWebShopAvailable) {
                context.res = {
                    body: {
                        description: 'Successfully send the order to azure bus topic for processing.',
                        orderID: paymentTransactionDoc.orderID
                    }
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
