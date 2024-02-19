'use strict';

const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/retail-transaction-pos');
const posSessionLink = require('../utils/pos-session-link');

//BASE-76. From POS device

module.exports = async (context, req) => {
    try {
        context.log(req.body);
        CustomLogs(req.body, context);
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to pay cart but the request body seems to be empty. Kindly pass request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        await utils.validateUUIDField(context, `${req.body.pointOfServiceID}`, 'The pointOfServiceID specified in the request body does not match the UUID v4 format.');

        if (!req.body || !req.body.pointOfServiceID || !req.body.pspType) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'kindly provide the pointOfServiceID, pspType.',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body.paymentStatus || (req.body.paymentStatus !== 'approved' && req.body.paymentStatus !== 'denied')) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'kindly provide the correct paymentStatus.',
                    400
                )
            );
            return Promise.resolve();
        }
        const cart = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${req.body.pointOfServiceID}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });

        if (!cart) {
            utils.setContextResError(
                context,
                new errors.CartNotFoundError(
                    'cart does not exist.',
                    404
                )
            );
            return Promise.resolve();
        }

        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });

        if (pointOfService.isEnabled !== true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    'pointOfService is disable.',
                    403
                )
            );
            return Promise.resolve();
        }
        if (pointOfService.isOpenForSale !== true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    pointOfService.notOpenForSaleText,
                    403
                )
            );
            return Promise.resolve();
        }
        if (pointOfService.isInMaintenanceMode === true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    pointOfService.maintenanceModeText,
                    403
                )
            );
            return Promise.resolve();
        }
        let paymentProviderAccountID;
        for (const key in pointOfService.paymentProviderAccounts) {
            if (key === 'creditcard') {
                paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
            }
            if (key === 'planetpayment') {
                paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
            }
        }
        const checkoutSession = await this.createCheckoutSession(req, pointOfService, cart, paymentProviderAccountID);
        checkoutSession.paymentTransactionResponse = req.body.paymentTransactionResponse;
        if (req.body.paymentTransactionResponse && req.body.paymentTransactionResponse.fingerPrint) {
            checkoutSession.fingerPrint = req.body.paymentTransactionResponse.fingerPrint;
        }
        if (req.body.requesterLocationId)
            checkoutSession.requesterLocationId = req.body.requesterLocationId;
        if (req.body.requesterTransRefNum)
            checkoutSession.requesterTransRefNum = req.body.requesterTransRefNum;
        if (req.body.requesterStationID)
            checkoutSession.requesterStationID = req.body.requesterStationID;
        if (req.body.sCATransRef)
            checkoutSession.SCATransRef = req.body.sCATransRef;
        if (req.body.token)
            checkoutSession.token = req.body.token;
        if (req.body.type)
            checkoutSession.transactionType = req.body.type;
        CustomLogs(`checkoutSession doc created with id ${checkoutSession._id} for pointOfServiceID ${req.body.pointOfServiceID}`, context);
        CustomLogs(`paymentStatus is ${req.body.paymentStatus} for pointOfServiceID ${req.body.pointOfServiceID}`, context);

        //utils.createPaymentLogs(checkoutSession, req.body.paymentTransactionResponse, 'sale', req.body.paymentTransactionResponse.amountTrans, req.body.paymentStatus, 'response');

        let paymentTransaction;
        if (req.body.paymentStatus === 'approved') {
            paymentTransaction = await this.createPaymentTransaction(req, checkoutSession, pointOfService, 'approved');
            CustomLogs(`paymentTransaction doc created with id ${paymentTransaction._id} for pointOfServiceID ${req.body.pointOfServiceID}`, context);

            let customerInfoMasked;
            if (req.body.paymentTransactionResponse && req.body.paymentTransactionResponse) {
                context.log('req.body.paymentTransactionResponse.cardPan = ' + req.body.paymentTransactionResponse.cardPan);
                customerInfoMasked = req.body.paymentTransactionResponse.cardPan;
            }
            if (req.body.posSessionID)
                checkoutSession.posSessionID = req.body.posSessionID;
            const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, customerInfoMasked, context, req.body);
            if (retailTransaction && retailTransaction.ops) {
                CustomLogs(`retailTransaction doc created with id ${retailTransaction.ops[0]._id} and customerInfoMasked ${customerInfoMasked}  for pointOfServiceID ${req.body.pointOfServiceID}`, context);
                if (req.body.posSessionID)
                    await posSessionLink.linkedPosSession(checkoutSession, req.body.posSessionID, retailTransaction.ops[0], 'paid', context);
            }
           
            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.pointOfServiceID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            CustomLogs(`cart is updated with id ${req.body.pointOfServiceID} for pointOfServiceID ${req.body.pointOfServiceID}`, context);

            if (pointOfService.actions) {
                for (let i = 0; i < pointOfService.actions.length; i++) {
                    const element = pointOfService.actions[i];
                    const iotReqBody = {};
                    iotReqBody.payload = element.actionParameters;
                    iotReqBody.pointOfService = pointOfService;
                    iotReqBody.deviceAzureID = pointOfService.deviceAzureID;
                    iotReqBody.methodName = element.actionCode;
                    CustomLogs(`action performed ${element.actionCode} for pointOfServiceID ${req.body.pointOfServiceID}`, context);
                    await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/perform-iot-action`, {
                        json: true,
                        body: iotReqBody,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                }
            }
        } else if (req.body.paymentStatus === 'denied') {
            paymentTransaction = await this.createPaymentTransaction(req, checkoutSession, pointOfService, 'denied');
            CustomLogs(`paymentTransaction doc created with id ${paymentTransaction._id} for pointOfServiceID ${req.body.pointOfServiceID}`, context);
        }
        let result;
        const collection = await getMongodbCollection('Orders');

        const response = await collection.insertOne(checkoutSession);
        CustomLogs(`checkoutSession doc created for pointOfServiceID ${req.body.pointOfServiceID}`, context);

        if (response && response.ops && response.ops[0]) {
            result = {
                checkoutSessionID: response.ops[0]._id
            };
        }
        let vatAmount = 0, amount = 0; const products = [];
        if (checkoutSession.products && Array.isArray(checkoutSession.products)) {
            for (let i = 0; i < checkoutSession.products.length; i++) {
                const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${checkoutSession.products[i].productID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PRODUCT_API_KEY
                    }
                });
                if (product.productTypeCode &&
                    (product.productTypeCode.toLowerCase() === 'giftcard'
                        || product.productTypeCode.toLowerCase() === 'ticket'
                        || product.productTypeCode.toLowerCase() === ' membership'
                        || product.productTypeCode.toLowerCase() === 'coupon'
                        || product.productTypeCode.toLowerCase() === ' pass')) {
                    product.vatAmount = Number(Number(product.vatAmount).toFixed(2));
                    product.salesPrice = Number(Number(product.salesPrice).toFixed(2));
                    vatAmount += product.vatAmount;
                    amount += product.salesPrice;
                    products.push(checkoutSession.products[i]);
                }
            }
        }
        if (paymentTransaction && pointOfService.cartSettings && pointOfService.cartSettings.issueVouchers === true) {
            const orderID = uuid.v4();
            const pendingOrder = {
                _id: orderID,
                docType: 'order',
                orderDate: new Date(),
                orderStatus: 'Pending',
                transactionID: paymentTransaction._id,
                transactionStatus: paymentTransaction.transactionStatus,
                amountPaid: Number(Number(amount).toFixed(2)),
                vatAmount: Number(Number(vatAmount).toFixed(2)),
                currency: pointOfService.currency,
                pointOfServiceID: pointOfService._id,
                pointOfServiceName: pointOfService.pointOfServiceName,
                products: products,
                customerEmail: checkoutSession.customerEmail,
                receiverEmail: checkoutSession.receiverEmail,
                receiverMobilePhone: checkoutSession.receiverMobilePhone,
                createdDate: new Date(),
                updatedDate: new Date(),
                partitionKey: orderID,
                sellerMerchantID: pointOfService.merchantID
            };
            if (pointOfService && pointOfService.webShops && pointOfService.webShops.length && pointOfService.webShops.length > 0) {
                pendingOrder.webShopID = pointOfService.webShops[0].webShopID;
                pendingOrder.webShopName = pointOfService.webShops[0].webShopName;
            }
            if (checkoutSession && checkoutSession.passID) {
                pendingOrder.passID = checkoutSession.passID;
            }
            if (checkoutSession)
                pendingOrder.customerID = checkoutSession.customerID;
            if (pendingOrder.receiverMobilePhone && !pendingOrder.receiverMobilePhone.includes('+'))
                pendingOrder.receiverMobilePhone = '+' + pendingOrder.receiverMobilePhone;
            context.log('Creating Order Doc');
            const order = await collection.insertOne(pendingOrder);

            if (order && order.ops) {
                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);
            }
        }

        utils.createPaymentLogs(checkoutSession, req.body.paymentTransactionResponse, 'sale', req.body.paymentTransactionResponse.amountTrans, req.body.paymentStatus, 'response');

        if (cart.cartType === 'booking') {
            await request.patch(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/booking-status/${cart._id}`, {
                json: true,
                body: {
                    currency: pointOfService.currency
                },
                headers: {
                    'x-functions-key': process.env.CUSTOMER_API_KEY
                }
            });
        }
        if (req.body.paymentTransactionResponse && req.body.paymentTransactionResponse.merchant_order_id)
            result.sessionID = req.body.paymentTransactionResponse.merchant_order_id;
        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.createCheckoutSession = async (req, pointOfService, cart, paymentProviderAccountID) => {
    const checkoutSession = {};
    checkoutSession._id = req.body.checkoutSessionID ? req.body.checkoutSessionID : uuid.v4();
    checkoutSession.partitionKey = checkoutSession._id;
    checkoutSession.docType = 'checkoutSessionCompleted';
    checkoutSession.sessionResultCode = 'completed';
    checkoutSession.userSessionID = req.body.pointOfServiceID;
    if (req.body.pspType && req.body.pspType === 'planetpayment') {
        checkoutSession.paymentProvider = 'planetpayment';
        checkoutSession.pspType = 'planetpayment';
    } else {
        checkoutSession.paymentProvider = 'creditcard';
        checkoutSession.pspType = 'creditcard';
    }
    checkoutSession.paymentProviderReference = uuid.v4(),
    checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
    checkoutSession.currency = pointOfService.currency;
    checkoutSession.paymentProviderAccountID = paymentProviderAccountID;
    checkoutSession.pointOfServiceID = pointOfService._id;
    checkoutSession.receiverEmail = req.body.location ? req.body.location.contactEmail : req.body.receiverEmail;
    checkoutSession.receiverMobilePhone = req.body.location ? req.body.location.contactPhone : req.body.receiverMobilePhone;
    checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
    checkoutSession.merchantID = pointOfService.merchantID;
    checkoutSession.products = cart.products;
    if (req.body.sessionID)
        checkoutSession.sessionID = req.body.sessionID;
    checkoutSession._ts = new Date();
    checkoutSession.ttl = 60 * 60 * 24 * 3;
    checkoutSession.createdDate = new Date();
    checkoutSession.updatedDate = new Date();
    return checkoutSession;
};

exports.createPaymentTransaction = async (req, checkoutSession, pointOfService, transactionStatus) => {
    // Create Payment Transaction document
    const body = {
        _id: uuid.v4(),
        transactionDate: new Date(),
        transactionStatus: transactionStatus,
        amountPaid: checkoutSession.totalAmountInclVat,
        amountRefunded: 0,
        currency: pointOfService.currency,
        pointOfServiceID: pointOfService._id,
        pointOfServiceName: pointOfService.pointOfServiceName,
        paymentProviderReference: checkoutSession.paymentProviderReference,
        sellerMerchantID: pointOfService.merchantID,
        products: checkoutSession.products
    };
    if (req.body.pspType && req.body.pspType === 'planetpayment') {
        body.paymentProvider = 'planetpayment';
        body.paymentType = 'planetpayment';
    } else {
        body.paymentProvider = 'creditcard';
        body.paymentType = 'creditcard';
    }
    const url = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions`;

    const options = {
        json: true,
        body,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    };

    return request.post(url, options);
};

