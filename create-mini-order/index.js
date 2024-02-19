'use strict';

const {
    getMongodbCollection
} = require('../db/mongodb');
const utils = require('../utils');
const logger = require('../utils/logger.js');
const Promise = require('bluebird');
const errors = require('../errors');
const request = require('request-promise');
const uuid = require('uuid');

const PAYMENT_PROVIDER_SWISH = 'swish';
const PAYMENT_PROVIDER_STRIPE = 'stripe';

//Please refer bac-212,234,270  for this endpoint related details

function getPaymentProvider (req) {
    try {
        return req.body.paymentProvider.toLowerCase();
    } catch (ignored) {
        return PAYMENT_PROVIDER_STRIPE;
    }
}

function createPaymentTransaction ({
    req,
    webShop,
    product,
    extra,
    orderID
}) {
    // Create Payment Transaction document
    // vatAmount related changes are in bac-188
    logger.logInfo('createPaymentTransaction, transactionDate=' + req.body.createdDate);
    const body = {
        _id: uuid.v4(),
        transactionDate: req.body.createdDate,
        transactionStatus: 'Captured',
        orderID: orderID,
        amountPaid: Number(req.body.amountPaid),
        amountRefunded: 0,
        vatAmount: Number(product.vatAmount),
        currency: req.body.currency,
        webShopID: webShop._id,
        webShopName: webShop.webShopName,
        paymentSource: req.body.paymentSource,
        paymentProvider: getPaymentProvider(req), // FIXME? this used to be ucfirst, e.g. Stripe instead of stripe. does it matter?
        paymentProviderReference: req.body.paymentProviderReference,
        sellerMerchantID: webShop.ownerMerchantID,
        paymentType: 'swish',
        extra,
        products: [product]
    };

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

    if (!req.body.amountPaid) {
        utils.setContextResError(
            context,
            new errors.MissingStripeAmountError(
                'You\'ve requested to create a new order but the request body is missing amount field. Kindly pass the order amount to be charged using request body in application/json format',
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

    const paymentProvider = getPaymentProvider(req);

    if (paymentProvider === PAYMENT_PROVIDER_SWISH && !req.body.receiverMobilePhone) {
        utils.setContextResError(
            context,
            new errors.MissingSwishPhoneError(
                'You\'ve requested to create a new order but the request body is missing swishPhone field. Kindly pass the order swishPhone to be charged using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
}

module.exports = (context, req) => {
    logger.logInfo('validating fields');
    const ret = validateFields(context, req);
    if (ret) {
        return ret;
    }
    logger.logInfo('validating fields OK');

    let pendingOrder, product, paymentTransactionDoc;
    let isWebShopAvailable = false,
        webShopDoc;
    const productUrl = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${req.body.productID}`;
    const orderID = req.body._id ? req.body._id : uuid.v4();

    context.log('Validations: Complete');
    context.log('Retrieving product document');
    // Get Product Document
    return request.get(productUrl, {
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        },
        json: true
    })
        .then(productResult => {
            if (!productResult) {
                return Promise.reject(
                    new errors.ProductApiError(
                        'Product doesn\'t exist.',
                        404
                    )
                );
            }

            product = productResult;
            logger.logInfo('calling paymentprovider');
            return getMongodbCollection('Merchants');
        })
        .then(collection => {
            return collection.findOne({
                _id: req.body.webshopID,
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
                    product: product,
                    webShop: webShop,
                    orderID: orderID
                }, {}));
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
                product.productID = product._id;
                delete product._id;
                product.quantity = 1;
                product.salesPeriodStart = product.validPeriod.salesPeriodStart;
                product.salesPeriodEnd = product.validPeriod.salesPeriodEnd;
                product.vatAmount = Number(Number(product.vatAmount).toFixed(2));
                // Create Order doc
                pendingOrder = {
                    _id: orderID,
                    docType: 'order',
                    orderDate: new Date(),
                    orderStatus: 'Pending',
                    transactionID: paymentTransactionDoc._id,
                    transactionStatus: paymentTransactionDoc.transactionStatus,
                    amountPaid: Number(Number(req.body.amountPaid).toFixed(2)),
                    vatAmount: Number(product.vatAmount),
                    currency: req.body.currency,
                    webShopID: webShopDoc._id,
                    webShopName: webShopDoc.webShopTitle,
                    receiverMobilePhone: req.body.receiverMobilePhone,
                    products: [product],
                    createdDate: new Date(),
                    updatedDate: new Date(),
                    partitionKey: orderID,
                    sellerMerchantID: webShopDoc.ownerMerchantID,
                };
                if (req.body.issueVouchers === false) {
                    pendingOrder.issueVouchers = req.body.issueVouchers;
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
                        doActionDoc.amountPaid = Number(Number(req.body.amountPaid).toFixed(2));
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
                    console.log(err);
                }
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
        .catch(error => {
            return utils.handleError(context, error);
        });
};