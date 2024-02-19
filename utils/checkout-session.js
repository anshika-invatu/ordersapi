'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const validator = require('validator');
const utils = require('../utils');
const errors = require('../errors');
const btoa = require('btoa');
const uuid = require('uuid');
const Swish = require('../utils/swish-payment');
const posSessionLink = require('../utils/pos-session-link');
const request = require('request-promise');
const { CustomLogs } = utils;
const QRCode = require('qrcode');
const Promise = require('bluebird');
const moment = require('moment');
const retailTransactionUtils = require('./retail-transaction-pos');

exports.createCheckoutSession = async (req, pointOfService, cart, context) => {
    let paymentProviderAccountID;
    for (const key in pointOfService.paymentProviderAccounts) {
        if (key === 'swish') {
            paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
        }
    }
    if (paymentProviderAccountID) {
        const logObj = {};
        logObj.massage = `paymentProviderAccountID is ${paymentProviderAccountID} in cart(${req.body.userSessionID})`;
        CustomLogs(logObj, context);
    }
    const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${paymentProviderAccountID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    });
    CustomLogs(`paymentProviderAccountsID is ${paymentProviderAccountsDoc._id} for cartID(${req.body.userSessionID})`, context);
    let payeeAlias;
    if (paymentProviderAccountsDoc && paymentProviderAccountsDoc.settings && paymentProviderAccountsDoc.settings.swish)
        payeeAlias = paymentProviderAccountsDoc.settings.swish.swishNumber;
    let currency = pointOfService.currency;
    if (!currency) {
        pointOfService.currency = 'SEK';
        currency = 'SEK';
    }
    let payeePaymentReference = uuid.v4();
    payeePaymentReference = payeePaymentReference.replace(/-/ig, '').toUpperCase();
    const reqBody = {
        payeeAlias: payeeAlias,
        amount: cart.totalAmountInclVat,
        currency: currency,
        payeePaymentReference: payeePaymentReference,
    };
    if (cart.products && cart.products.length && cart.products[0]) {
        reqBody.message = cart.products[0].productName;
    } else {
        CustomLogs(`cart does not have any product for cartID(${req.body.userSessionID})`, context);
    }
    if (reqBody) {
        const logObj = {};
        logObj.reqBody = reqBody;
        logObj.cartID = req.body.userSessionID;
        CustomLogs(logObj, context);
    }
    const isTesting = process.env.IS_TESTING;
    CustomLogs(`trying to send req to swish payment for cartID(${req.body.userSessionID})`, context);
    let paymentResult;
    try {
        paymentResult = await Swish.swishPayment(reqBody, context, isTesting);
    } catch (error) {
        if (req.body.posSessionID)
            posSessionLink.stopPosSession(req.body.posSessionID, context);
        throw error;
    }
    context.log(paymentResult);

    if (paymentResult && paymentResult.length && paymentResult[0] && paymentResult[0].errorCode) {
        return paymentResult;
    }

    if (paymentResult) {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        checkoutSession.paymentProviderAccountID = paymentProviderAccountID;
        if (req.body.pspType.toLowerCase() === 'swish' && paymentResult.location) {
            checkoutSession.paymentProvider = 'Swish';
            checkoutSession.pspType = 'swish';
            let id = paymentResult.location.split('/');
            id = id[id.length - 1];
            checkoutSession.paymentID = id;
            checkoutSession.paymentToken = paymentResult.token;
        }
        checkoutSession.paymentProviderReference = payeePaymentReference;
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.merchantID = pointOfService.merchantID;
        checkoutSession.requestData = reqBody;
        checkoutSession.responseData = paymentResult;
        checkoutSession.products = cart.products;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        let paymentResultLog;
        if (paymentResult && paymentResult.location)
            paymentResultLog = 'approved';
        else
            paymentResultLog = 'denied';
        await utils.createPaymentLogs(checkoutSession, paymentResult,'', '', paymentResultLog);
        const collection = await getMongodbCollection('Orders');
        const response = await collection.insertOne(checkoutSession);
        let result;
        if (response && response.ops && response.ops[0]) {
            result = {
                checkoutSessionID: response.ops[0]._id,
                paymentToken: paymentResult.token
            };

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return result;

        }
    }
};

exports.blueCodeCreateCheckoutSession = async (req, pointOfService, cart, context) => {
    let paymentProviderAccountID;
    for (const key in pointOfService.paymentProviderAccounts) {
        if (key === 'bluecode') {
            paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
        }
    }
    if (paymentProviderAccountID) {
        const logObj = {};
        logObj.massage = `paymentProviderAccountID is ${paymentProviderAccountID} in cart(${req.body.userSessionID})`;
        CustomLogs(logObj, context);
    }

    //Because bluecode support only EUR currency.

    pointOfService.currency = 'EUR';
    const currency = 'EUR';

    let payeePaymentReference = uuid.v4();
    payeePaymentReference = payeePaymentReference.replace(/-/ig, '').toUpperCase();
    let paymentResult; const response = {};
    let scannedData;
    if (req.body.scannedData)
        scannedData = req.body.scannedData.toString('ascii');
    if (req.body.operationMode === 'merchantScanBarcode') {
        const reqBody = {
            branch_ext_id: req.body.branch_id,
            paymentProviderAccountID: paymentProviderAccountID,
            merchant_tx_id: payeePaymentReference,
            scheme: 'BLUE_CODE',
            bluecode: scannedData,
            barcode: req.body.barcode,
            requested_amount: cart.totalAmountInclVat * 100,
            currency: currency,
            slip_note: 'Thanks for shopping with us!'
        };

        if (reqBody) {
            const logObj = {};
            logObj.reqBody = reqBody;
            logObj.cartID = req.body.userSessionID;
            CustomLogs(logObj, context);
        }
        CustomLogs(`trying to send req to swish payment for cartID(${req.body.userSessionID})`, context);
        try {
            paymentResult = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/bluecode-payment`, {
                json: true,
                body: reqBody,
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
        } catch (error) {
            if (req.body.posSessionID)
                posSessionLink.stopPosSession(req.body.posSessionID, context);
            throw error;
        }
        if (paymentResult && paymentResult.payment && paymentResult.payment.state && paymentResult.payment.state.toUpperCase() === 'APPROVED') {
            response.status = paymentResult.payment.state;
            await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_BLUECODE, paymentResult);
        } else if (paymentResult.payment && paymentResult.payment.code) {
            response.error = paymentResult.payment.code;
        } else {
            response.error = 'NOT APPROVED.';
        }
    } else if (req.body.operationMode === 'customerScanQR') {
        const reqBody = {
            scheme: 'blue_code',
            branch_ext_id: req.body.branch_id,
            paymentProviderAccountID: paymentProviderAccountID,
            merchant_tx_id: payeePaymentReference,
            bluecode: scannedData,
            requested_amount: cart.totalAmountInclVat * 100,
            currency: currency,
            merchant_callback_url: process.env.BLUECODE_CALLBACK_URL,
            return_url_success: process.env.BLUECODE_CALLBACK_URL,
            return_url_failure: process.env.BLUECODE_CALLBACK_URL,
            return_url_cancel: process.env.BLUECODE_CALLBACK_URL
        };

        if (reqBody) {
            const logObj = {};
            logObj.reqBody = reqBody;
            logObj.cartID = req.body.userSessionID;
            CustomLogs(logObj, context);
        }
        CustomLogs(`trying to send req to swish payment for cartID(${req.body.userSessionID})`, context);
        try {
            paymentResult = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/bluecode-register`, {
                json: true,
                body: reqBody,
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
        } catch (error) {
            if (req.body.posSessionID)
                posSessionLink.stopPosSession(req.body.posSessionID, context);
            throw error;
        }
        if (paymentResult && paymentResult.payment && paymentResult.payment.checkin_code) {
            await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_BLUECODE, paymentResult);
            response.qrCode = paymentResult.payment.checkin_code;
        } else if (paymentResult.code) {
            response.error = paymentResult.code;
        } else {
            response.error = 'there is some issue.';
        }
    }
    context.log(paymentResult);

    if ((paymentResult && paymentResult.reasonPhrase) || response.error) {
        return paymentResult;
    }

    if (paymentResult) {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        if (req.body.pspType.toLowerCase() === 'bluecode' && paymentResult.result && paymentResult.result === 'OK') {
            checkoutSession.paymentProvider = 'bluecode';
            checkoutSession.pspType = 'bluecode';
            checkoutSession.payment = paymentResult.payment;
            if (paymentResult.payment) {
                checkoutSession.acquirer_tx_id = paymentResult.payment.acquirer_tx_id;
                checkoutSession.end_to_end_id = paymentResult.payment.end_to_end_id;
            }
        }
        checkoutSession.paymentProviderReference = payeePaymentReference;
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.paymentProviderAccountID = paymentProviderAccountID;
        checkoutSession.currency = pointOfService.currency;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.products = cart.products;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        const insertedCheckoutSession = await collection.insertOne(checkoutSession);
        if (insertedCheckoutSession && insertedCheckoutSession.ops && insertedCheckoutSession.ops[0]) {
            response.checkoutSessionID = insertedCheckoutSession.ops[0]._id;

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return response;

        }
    }
};

exports.accessTokenCreateCheckoutSession = async (req, pointOfService, cart, context) => {
    let currency = pointOfService.currency;
    if (!currency) {
        pointOfService.currency = 'SEK';
        currency = 'SEK';
    }
    let accessTokenID;
    if (req.body.accessToken && validator.isUUID(req.body.accessToken, 4))
        accessTokenID = req.body.accessToken;
    if (req.body.accessToken && !validator.isUUID(req.body.accessToken, 4) && req.body.accessToken.includes('/beta/')) {
        let accessTokenArr = req.body.accessToken.split('/beta/');
        if (accessTokenArr[1])
            accessTokenArr = accessTokenArr[1].split('%');
        accessTokenID = accessTokenArr[0];
    }
    if (!accessTokenID && req.body.accessToken)
        accessTokenID = req.body.accessToken;
    const accessToken = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/access-token-by-accessToken/${accessTokenID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.DEVICE_API_KEY
        }
    });

    if (accessToken.isEnabled !== true) {
        utils.setContextResError(
            context,
            new errors.AccessTokenAuthenticationError(
                'The AccessToken is not enabled',
                403
            )
        );
        return Promise.resolve();
    }
    if (accessToken.isLocked !== false) {
        utils.setContextResError(
            context,
            new errors.AccessTokenAuthenticationError(
                'The AccessToken is locked',
                403
            )
        );
        return Promise.resolve();
    }
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const d = new Date();
    const dayName = days[d.getDay()];
    const isError = await this.validateDateTime(accessToken, req, dayName, context);
    if (isError) {
        return Promise.resolve();
    }

    if (req.body.accessTokenPincode) {
        const accessTokenPincode = utils.hashToken(req.body.accessTokenPincode);
        if (accessToken.accessTokenPincode !== accessTokenPincode) {
            utils.setContextResError(
                context,
                new errors.AccessTokenAuthenticationError(
                    'The accessTokenPincode not matched with this accessToken\'s accessTokenPincode.',
                    403
                )
            );
            return Promise.resolve();
        }
    }
    if (!accessToken.accessRights) {
        utils.setContextResError(
            context,
            new errors.AccessTokenAuthenticationError(
                'The accessToken does not have accessRights section.',
                403
            )
        );
        return Promise.resolve();
    }

    const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${pointOfService.merchantID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.MERCHANT_API_KEY
        }
    });
    let itemText;
    if (cart && cart.products && cart.products[0])
        itemText = cart.products[0].productName;
    const reqBody = {
        accountID: accessToken.customerAccountID,
        amount: cart.totalAmountInclVat,
        currency: currency,
        accessTokenID: accessToken._id,
        accessTokenName: accessToken.accessTokenName,
        customerID: accessToken.customerID,
        itemText: itemText,
        isCleared: false,
        statusCode: 'paid',
        statusDate: new Date(),
        merchantID: pointOfService.merchantID,
        merchantName: merchant.merchantName,
        vatAmount: cart.totalVatAmount,
        transactionTypeCode: 'purchase',
        description: 'from pos',
        salesChannelName: pointOfService.pointOfServiceName,
        salesChannelTypeCode: 'pos',
        pointOfServiceID: pointOfService._id,
        pointOfServiceName: pointOfService.pointOfServiceName,

    };
    if (pointOfService.accessControl) {
        reqBody.siteID = pointOfService.accessControl.siteID;
        reqBody.siteName = pointOfService.accessControl.siteName;
        reqBody.zoneID = pointOfService.accessControl.zoneID;
        reqBody.zoneName = pointOfService.accessControl.zoneName;
    }
    if (reqBody) {
        const logObj = {};
        logObj.reqBody = reqBody;
        logObj.cartID = req.body.userSessionID;
        CustomLogs(logObj, context);
    }
    let result;
    try {
        result = await request.post(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/register-transaction`, {
            body: reqBody,
            json: true,
            headers: {
                'x-functions-key': process.env.BILLING_SERVICE_API_KEY
            }
        });
        context.log(result);
    } catch (error) {
        if (req.body.posSessionID)
            posSessionLink.stopPosSession(req.body.posSessionID, context);
        throw error;
    }

    if (result && result.result === 'approved') {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        if (req.body.pspType.toLowerCase() === 'accesstoken') {
            checkoutSession.paymentProvider = 'AccessToken';
            checkoutSession.pspType = 'accessToken';
        }
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.merchantID = pointOfService.merchantID;
        checkoutSession.merchantName = pointOfService.merchantName;
        checkoutSession.products = cart.products;
        checkoutSession.customerID = accessToken.customerID;
        checkoutSession.customerName = accessToken.accessTokenName;
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        if (result.accountTransactionID) {
            checkoutSession.accountTransactionID = result.accountTransactionID;
            if (req.body.posSessionID) {
                await request.patch(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/account-transaction/${result.accountTransactionID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.BILLING_SERVICE_API_KEY
                    },
                    body: {
                        posSessionID: req.body.posSessionID,
                    }
                });
            }
        }
        const response = await collection.insertOne(checkoutSession);
        let res;
        if (response && response.ops && response.ops[0]) {
            const retailTransaction = await retailTransactionUtils.createRetailTransActions(response.ops[0], accessToken.accessTokenName);
            if (retailTransaction && retailTransaction.ops[0]) {
                context.log('retailTransaction doc saved' + retailTransaction.ops[0]._id);
                posSessionLink.linkedPosSession(checkoutSession, req.body.posSessionID, retailTransaction.ops[0], 'paid', context);
            }
            res = {
                checkoutSessionID: response.ops[0]._id,
                result: 'APPROVED'
            };

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return res;
        }
    }
};

exports.validateDateTime = (doc, req, dayName, context) => {
    let isError = false;
    if (doc.validPeriod.validFromDate && doc.validPeriod.validToDate) {
        const hasExpired = !moment
            .utc()
            .isBetween(doc.validPeriod.validFromDate, doc.validPeriod.validToDate);

        if (hasExpired) {
            isError = true;
            utils.setContextResError(
                context,
                new errors.AccessTokenAuthenticationError(
                    'The AccessToken has expired.',
                    403
                )
            );
            return Promise.resolve(isError);
        }
    }
   
    const isSameTimeAndDay = [];
    for (const key in doc.pincodeRules) {
        if (key.toLocaleLowerCase() === dayName.toLocaleLowerCase()) {
            const pincodeRule = doc.pincodeRules[key];
            if (pincodeRule && Array.isArray(pincodeRule)) {
                pincodeRule.forEach(element => {
                    const validFrom = moment.utc(element.fromTime, 'HH:mm:ss');
                    const validTo = moment.utc(element.toTime, 'HH:mm:ss');
                    const isSameTime = moment
                        .utc()
                        .isBetween(validFrom, validTo);
                    isSameTimeAndDay.push(isSameTime);
                });
            }
        }
    }
    if (isSameTimeAndDay.includes(true) && !req.body.accessTokenPincode) {
        isError = true;
        utils.setContextResError(
            context,
            new errors.PincodeRequiredError(
                'Pincode is required for this access token',
                403
            )
        );
        return Promise.resolve(isError);
    }
};

exports.createCheckoutSessionByAccessToken = async (req, pointOfService, product, totalAmountInclVat, quantity, context) => {
    let currency = pointOfService.currency;
    if (!currency) {
        pointOfService.currency = 'SEK';
        currency = 'SEK';
    }

    const cartproduct = this.createCartProduct(product);
    cartproduct.quantity = quantity;
    const totalVatAmount = Number((totalAmountInclVat - (totalAmountInclVat / ((product.vatPercent / 100) + 1))).toFixed(2));
    const accessToken = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/access-token-by-accessToken/${req.body.accessToken}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.DEVICE_API_KEY
        }
    });
    const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${pointOfService.merchantID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.MERCHANT_API_KEY
        }
    });
    let itemText;
    if (cartproduct)
        itemText = cartproduct.productName;
    const reqBody = {
        accountID: accessToken.customerAccountID,
        amount: totalAmountInclVat,
        currency: currency,
        accessTokenID: accessToken._id,
        accessTokenName: accessToken.accessTokenName,
        customerID: accessToken.customerID,
        itemText: itemText,
        isCleared: false,
        statusCode: 'paid',
        statusDate: new Date(),
        merchantID: pointOfService.merchantID,
        merchantName: merchant.merchantName,
        vatAmount: totalVatAmount,
        transactionTypeCode: 'purchase',
        description: 'from pos',
        salesChannelName: pointOfService.pointOfServiceName,
        salesChannelTypeCode: 'pos',
        pointOfServiceID: pointOfService._id,
        pointOfServiceName: pointOfService.pointOfServiceName,

    };
    if (pointOfService.accessControl) {
        reqBody.siteID = pointOfService.accessControl.siteID;
        reqBody.siteName = pointOfService.accessControl.siteName;
        reqBody.zoneID = pointOfService.accessControl.zoneID;
        reqBody.zoneName = pointOfService.accessControl.zoneName;
    }
    if (reqBody) {
        const logObj = {};
        logObj.reqBody = reqBody;
        logObj.cartID = req.body.userSessionID;
        CustomLogs(logObj, context);
    }
    const result = await request.post(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/register-transaction`, {
        body: reqBody,
        json: true,
        headers: {
            'x-functions-key': process.env.BILLING_SERVICE_API_KEY
        }
    });
    context.log(result);

    if (result && result.result === 'approved') {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        if (req.body.pspType.toLowerCase() === 'accesstoken') {
            checkoutSession.paymentProvider = 'AccessToken';
            checkoutSession.pspType = 'accessToken';
        }
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = totalAmountInclVat;
        checkoutSession.totalVatAmount = totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.merchantID = pointOfService.merchantID;
        checkoutSession.merchantName = pointOfService.merchantName;
        checkoutSession.products = [cartproduct];
        checkoutSession.customerID = accessToken.customerID;
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        if (result.accountTransactionID)
            checkoutSession.accountTransactionID = result.accountTransactionID;
        const response = await collection.insertOne(checkoutSession);
        let res;
        if (response && response.ops && response.ops[0]) {
            const retailTransaction = await retailTransactionUtils.createRetailTransActions(response.ops[0], accessToken.accessTokenName);
            if (retailTransaction && retailTransaction.ops[0]) {
                context.log('retailTransaction doc saved' + retailTransaction.ops[0]._id);
                posSessionLink.linkedPosSession(checkoutSession, req.body.posSessionID, retailTransaction.ops[0], 'paid', context);
            }
            res = {
                checkoutSessionID: response.ops[0]._id,
                result: 'APPROVED'
            };
            return res;
        }
    }
};

exports.binanceCreateCheckoutSession = async (req, pointOfService, cart, context) => {
    let currency = pointOfService.currency;
    if (!currency) {
        pointOfService.currency = 'BUSD';
        currency = 'BUSD';
    }
    const timestamp = + new Date();
    let nonce = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        nonce += characters.charAt(Math.floor(Math.random() * 32));
    }
    const merchantTradeNo = uuid.v4().split('-')
        .join('');
    const binanceMerchantID = Math.floor((Math.random() * 10000000000) + 1);
    const body = {
        'merchantId': binanceMerchantID,
        'merchantTradeNo': merchantTradeNo,
        'totalFee': cart.totalAmountInclVat,
        'productDetail': cart.products[0] ? cart.products[0].productDescription : 'default',
        'currency': currency,
        'tradeType': 'APP',
        'productType': cart.products[0] ? cart.products[0].productTypeCode : 'default',
        'productName': cart.products[0] ? cart.products[0].productName : 'default',
    };
    const payload = timestamp + '\n' + nonce + '\n' + JSON.stringify(body) + '\n';
    const secretKey = process.env.BINANCE_SECRET_KEY;
    let signature = utils.binanceHashToken(payload, secretKey);
    signature = signature.toUpperCase();
    context.log(signature);

    let result;
    try {
        result = await request.post(`${process.env.BINANCE_URL}/binancepay/openapi/order`, {
            body: body,
            json: true,
            headers: {
                'content-type': 'application/json',
                'BinancePay-Timestamp': timestamp,
                'BinancePay-Nonce': nonce,
                'BinancePay-Certificate-SN': process.env.BINANCE_PUBLIC_KEY,
                'BinancePay-Signature': signature
            }
        });
        context.log(result);
    } catch (error) {
        context.log(error);
    }
    if (result && result.status === 'FAIL') {
        return result;
    }
    if (result && result.status === 'SUCCESS') {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        if (req.body.pspType.toLowerCase() === 'binance') {
            checkoutSession.paymentProvider = 'Binance';
            checkoutSession.pspType = 'binance';
        }
        checkoutSession.merchantTradeNo = merchantTradeNo;
        checkoutSession.binanceMerchantID = binanceMerchantID;
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.merchantID = pointOfService.merchantID;
        checkoutSession.merchantName = pointOfService.merchantName;
        checkoutSession.products = cart.products;
        //checkoutSession.customerID = accessToken.customerID;
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        checkoutSession.binancePaymentData = result;
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        if (result.accountTransactionID)
            checkoutSession.accountTransactionID = result.accountTransactionID;
        const response = await collection.insertOne(checkoutSession);
        let res;
        if (response && response.ops && response.ops[0]) {
            const retailTransaction = await retailTransactionUtils.createRetailTransActions(response.ops[0]);
            if (retailTransaction && retailTransaction.ops[0]) {
                context.log('retailTransaction doc saved' + retailTransaction.ops[0]._id);
                posSessionLink.linkedPosSession(checkoutSession, req.body.posSessionID, retailTransaction.ops[0], 'paid', context);
            }
            res = {
                checkoutSessionID: response.ops[0]._id,
                qrCode: result.data ? result.data.qrcodeLink : '',
                qrContent: result.data ? result.data.qrContent : ''
            };

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return res;
        }
    }
};

exports.vippsCreateCheckoutSession = async (req, pointOfService, cart, context) => {

    let result, qrResult, merchantSerialNumber; const requestID = uuid.v4();
    let paymentProviderAccountID;
    try {
        for (const key in pointOfService.paymentProviderAccounts) {
            if (key && key.toLowerCase() === 'vipps') {
                paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
            }
        }
        result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-payment?paymentProviderAccountID=${paymentProviderAccountID}`, {
            json: true,
            body: {
                merchantSerialNumber: merchantSerialNumber,
                orderID: uuid.v4(),
                amount: cart.totalAmountInclVat * 100,
                requestID: requestID,
                transactionText: cart.products ? (cart.products[0] ? cart.products[0].productName : 'One pair of Vipps socks') : 'One pair of Vipps socks',
            },
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        CustomLogs(`result for payment for vipps(${result})`, context);
        if (typeof result === 'object')
            CustomLogs(`get result(${JSON.stringify(result)}) for vipps`, context);
        context.log(result);

        qrResult = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-qr?paymentProviderAccountID=${paymentProviderAccountID}`, {
            json: true,
            body: {
                url: result.url
            },
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        
        context.log(qrResult);
        CustomLogs(`qrResult for payment for vipps(${qrResult})`, context);
        if (typeof qrResult === 'object')
            CustomLogs(`get qr result(${JSON.stringify(qrResult)}) for vipps`, context);
        
    } catch (error) {
        CustomLogs(`error for payment for vipps(${error})`, context);
        return result = error.error;
    }
    if (result && result.url) {
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        if (req.body.pspType.toLowerCase() === 'vipps') {
            checkoutSession.paymentProvider = 'Vipps';
            checkoutSession.pspType = 'vipps';
        }
        checkoutSession.orderID = result.orderId;
        checkoutSession.url = result.url;
        checkoutSession.paymentRequestID = requestID;
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.paymentProviderAccountID = paymentProviderAccountID;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.merchantID = pointOfService.merchantID;
        checkoutSession.merchantName = pointOfService.merchantName;
        checkoutSession.products = cart.products;
        checkoutSession.merchantSerialNumber = merchantSerialNumber;
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }
        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        const response = await collection.insertOne(checkoutSession);
        let res;
        if (response && response.ops && response.ops[0]) {
            res = {
                checkoutSessionID: response.ops[0]._id,
                url: result.url,
                qrContent: qrResult.url,
                orderId: result.orderId
            };

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return res;
        }
    }
};

exports.mobilePayCreateCheckoutSession = async (req, pointOfService, cart, context) => {
    const paymentProviderPOSID = pointOfService.paymentProviderAccounts ? (pointOfService.paymentProviderAccounts.mobilepay ? pointOfService.paymentProviderAccounts.mobilepay.paymentProviderPOSID : '') : '';
    const reqBody = {
        idempotencyKey: uuid.v4(),
        amount: cart.totalAmountInclVat * 100,
        paymentPointId: uuid.v4(),
        currencyCode: pointOfService.currency,
        redirectUri: process.env.MOBILE_PAY_REDIRECT_URI,
        plannedCaptureDelay: 'None',
        posId: paymentProviderPOSID,
        orderId: uuid.v4()
    };
    let paymentProviderAccountID;
    for (const key in pointOfService.paymentProviderAccounts) {
        if (key && key.toLowerCase() === 'mobilepay') {
            paymentProviderAccountID = pointOfService.paymentProviderAccounts[key].paymentProviderAccountID;
        }
    }
    const paymentProviderAccounts = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${paymentProviderAccountID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    });
    let integratorClientId, clientSecret;
    if (paymentProviderAccounts && paymentProviderAccounts.settings) {
        if (paymentProviderAccounts.settings.integratorClientId)
            integratorClientId = paymentProviderAccounts.settings.integratorClientId;
        if (paymentProviderAccounts.settings.clientSecret)
            clientSecret = paymentProviderAccounts.settings.clientSecret;
    }
    if (cart.products && cart.products.length && cart.products[0]) {
        reqBody.description = cart.products[0].productName;
    } else {
        CustomLogs(`cart does not have any product for cartID(${req.body.userSessionID})`, context);
    }
    if (reqBody) {
        const logObj = {};
        logObj.reqBody = reqBody;
        logObj.cartID = req.body.userSessionID;
        CustomLogs(logObj, context);
    }
    let qrCode;
    CustomLogs(`trying to send req to mobilePay payment for cartID(${req.body.userSessionID})`, context);
    let paymentResult, merchant;
    try {
        const auth = 'Basic ' + btoa(`${integratorClientId}:${clientSecret}`);
        context.log(auth);
        merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${pointOfService.merchantID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        const authentication = await request.post(`${process.env.MOBILE_PAY_URL}/integrator-authentication/connect/token`, {
            form: {
                grant_type: 'client_credentials',
                merchant_vat: merchant.vatNumber
            },
            json: true,
            headers: {
                'authorization': auth,
                'content-type': 'application/x-www-form-urlencoded',
                'x-ibm-client-id': integratorClientId

            }
        });
        context.log(authentication);

        paymentResult = await request.post(`${process.env.MOBILE_PAY_URL}/pos/v10/payments`, {
            body: reqBody,
            json: true,
            headers: {
                'accept': 'application/json',
                'authorization': 'Bearer ' + authentication.access_token,
                'content-type': 'application/*+json',
                'x-ibm-client-id': integratorClientId,
                'x-mobilepay-client-system-version': '2.1.1',
                'X-MobilePay-Merchant-VAT-Number': merchant.vatNumber,
                'x-mobilepay-idempotency-key': uuid.v4(),

            }
        });
        context.log(paymentResult);
        const beaconIds = await request.get(`${process.env.MOBILE_PAY_URL}/pos/v10/pointofsales/${paymentProviderPOSID}`, {
            json: true,
            headers: {
                'accept': 'application/json',
                'authorization': 'Bearer ' + authentication.access_token,
                'x-ibm-client-id': integratorClientId,
                'x-mobilepay-client-system-version': '2.1.1',
                'X-MobilePay-Merchant-VAT-Number': merchant.vatNumber,
            }
        });
        context.log(beaconIds);
        const qrString = `mobilepaypos://pos?id=${beaconIds.beaconId}&source=qr`;
        qrCode = await this.getQr(qrString);

    } catch (error) {
        context.log(error);
        throw error;
    }
    context.log(paymentResult);

    if (paymentResult && paymentResult.length && paymentResult[0] && paymentResult[0].errorCode) {
        return paymentResult;
    }
    
    if (paymentResult) {
        const paymentMsg = {
            paymentID: paymentResult.paymentId,
            merchantID: merchant._id,
            paymentProviderAccountID: paymentProviderAccountID
        };
        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_MOBILE_PAY, paymentMsg);
        const checkoutSession = {};
        checkoutSession._id = uuid.v4();
        checkoutSession.partitionKey = checkoutSession._id;
        checkoutSession.docType = 'checkoutSession';
        checkoutSession.userSessionID = req.body.userSessionID;
        checkoutSession.paymentProvider = 'MobilePay';
        checkoutSession.pspType = 'mobilePay';
        checkoutSession.paymentProviderAccountID = paymentProviderAccountID;
        checkoutSession.paymentID = paymentResult.paymentId;
        if (req.body.customerEmail)
            checkoutSession.customerEmail = req.body.customerEmail;
        if (req.body.receiverEmail)
            checkoutSession.receiverEmail = req.body.receiverEmail;
        if (req.body.receiverText)
            checkoutSession.receiverText = req.body.receiverText;
        if (req.body.receiverMobilePhone)
            checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
        checkoutSession.totalAmountInclVat = cart.totalAmountInclVat;
        checkoutSession.totalVatAmount = cart.totalVatAmount;
        checkoutSession.currency = pointOfService.currency;
        if (req.body.sessionID)
            checkoutSession.sessionID = req.body.sessionID;
        checkoutSession.pointOfServiceID = pointOfService._id;
        checkoutSession.pointOfServiceName = pointOfService.pointOfServiceName;
        checkoutSession.products = cart.products;
        if (cart.discountCode) {
            checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
            checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
        }
        if (req.body.posSessionID)
            checkoutSession.posSessionID = req.body.posSessionID;
        checkoutSession._ts = new Date();
        checkoutSession.ttl = 60 * 60 * 24 * 3;
        if (req.body.discountCode) {
            checkoutSession.discounts = [{
                discountCode: req.body.discountCode
            }];
        }

        checkoutSession.createdDate = new Date();
        checkoutSession.updatedDate = new Date();
        CustomLogs(`chcekoutSessionDocID is ${checkoutSession._id} for cartID(${req.body.userSessionID})`, context);
        const collection = await getMongodbCollection('Orders');
        const response = await collection.insertOne(checkoutSession);
        let result;
        if (response && response.ops && response.ops[0]) {
            result = {
                checkoutSessionID: response.ops[0]._id,
                paymentToken: paymentResult.paymentId,
                qrCodeImageBlob: qrCode
            };

            await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/clear-cart/${req.body.userSessionID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
            return result;

        }
    }
};

exports.getQr = async (urlString) => {
    return new Promise((resolve, reject) => {
        QRCode.toDataURL(urlString, (err, url) => {
            if (err)
                reject(err);
            console.log(url);
            return resolve(url);
        });
    });
};

exports.createCartProduct = (product) => {
    const cartProduct = {
        productID: product._id,
        productEAN: product.productEAN,
        productGCN: product.productGCN,
        productName: product.productName,
        productDescription: product.productDescription,
        productTypeID: product.productTypeID,
        productTypeCode: product.productTypeCode,
        productTypeName: product.productTypeName,
        productTypeIconURL: product.productTypeIconURL,
        productCategoryID: product.productCategories ? product.productCategories[0].productCategoryID : '',
        productCategoryName: product.productCategories ? product.productCategories[0].productCategoryName : '',
        productCategoryIconURL: product.productCategories ? product.productCategories[0].productCategoryIconURL : '',
        conditions: product.conditions,
        imageURL: product.imageURL,
        voucherType: product.voucherType,
        isEnabledForSale: product.isEnabledForSale,
        issuer: product.issuer,
        salesPrice: product.salesPrice,
        amount: product.salesPrice,
        vatPercent: product.vatPercent,
        vatAmount: product.vatAmount,
        currency: product.currency,
        salesPeriodStart: product.validPeriod ? product.validPeriod.salesPeriodStart : '',
        salesPeriodEnd: product.validPeriod ? product.validPeriod.salesPeriodEnd : ''
    };
    return cartProduct;
};