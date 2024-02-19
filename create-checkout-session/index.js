'use strict';


const request = require('request-promise');
const utils = require('../utils');
const uuid = require('uuid');
const errors = require('../errors');
const Swish = require('../utils/swish-payment');
const retailTransactionUtils = require('../utils/retail-transaction-pos');
const { getMongodbCollection } = require('../db/mongodb');

//Please refer the story bac-385, base-131 for more details

module.exports = async (context, req) => {
    context.log(JSON.stringify(req.body));
    const line_items = [];
    try {
        let webShop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshops?webShopToken=${req.body.webShopToken}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        if (webShop && Array.isArray(webShop) && webShop.length)
            webShop = webShop[0];
        const paymentProviderAccount = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        const cartUrl = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${req.body.userSessionID}/cart`;
        const cart = await request.get(cartUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (!cart) {
            await Promise.reject(
                new errors.CartNotFoundError(
                    'Cart document for userSessionId specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        let paymentProviderAccountDoc;
        if (paymentProviderAccount && Array.isArray(paymentProviderAccount) && paymentProviderAccount.length) {
            paymentProviderAccountDoc = paymentProviderAccount[0];
        }
        let result; const response = {};
        const checkoutSession = {};
        const successfulUrl = `${process.env.BASE_URL}/${req.body.webShopToken}/payment-success`;
        const failedUrl = `${process.env.BASE_URL}/${req.body.webShopToken}/payment-failed`;
        const productsArray = {};
        productsArray.productDetails = [];
        productsArray.productID = [];
        let payeePaymentReference = uuid.v4();
        payeePaymentReference = payeePaymentReference.replace(/-/ig, '').toUpperCase();
        let currency;
        let isPlanetError = false;
        if (cart && cart.products && Array.isArray(cart.products)) {
            for (let i = 0; i < cart.products.length; i++) {
                if (productsArray.productID.includes(cart.products[i].productID)) {
                    const result = productsArray.productDetails.find(x => x.productID === cart.products[i].productID);
                    result.quantity = result.quantity + 1;
                } else {
                    cart.products[i].quantity = 1;
                    productsArray.productDetails.push(Object.assign({}, cart.products[i]));
                    productsArray.productID.push(cart.products[i].productID);
                }
            }
            const items = [];
            productsArray.productDetails.forEach(element => {
                currency = element.currency;
                element.salesPrice = Number(element.salesPrice.toFixed(2));
                element.vatAmount = Number(element.vatAmount.toFixed(2));
                items.push({
                    type: 'physical',
                    sku: 3123123,
                    name: element.productName,
                    quantity: element.quantity,
                    unit_price: Math.floor(element.salesPrice * 100),
                });
                line_items.push({
                    price_data: {
                        currency: element.currency,
                        unit_amount: Math.floor(Number(element.salesPrice) * 100),
                        product_data: {
                            name: element.productName,
                            description: 'Voucher'
                        }
                    },
                    quantity: element.quantity
                });
            });
            
            if (paymentProviderAccountDoc && paymentProviderAccountDoc.pspType) {
                if (paymentProviderAccountDoc.pspType.toLowerCase() === 'stripe') {
                    let apiKey;
                    if (paymentProviderAccountDoc.settings && paymentProviderAccountDoc.settings.apiKeySecret)
                        apiKey = paymentProviderAccountDoc.settings.apiKeySecret;
                    result = await utils.createStripeCheckoutSessions(context, line_items, successfulUrl, failedUrl, req.body.userSessionID, req.body.customerEmail, apiKey);
                    checkoutSession.paymentProvider = 'Stripe';
                } else if (paymentProviderAccountDoc.pspType.toLowerCase() === 'blink') {
                    
                    const auth = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/blink-auth-token?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                    const requestUUID = uuid.v4();
                    const requestIndentityId = uuid.v4();
                    const reqBody = {
                        merchantQRCode: req.body.merchantQRCode,
                        merchantStoreMobileNo: req.body.merchantStoreMobileNo,
                        customerMobileNo: req.body.customerMobileNo,
                        amount: req.body.amount,
                        requestUUID: requestUUID,
                        requestIndentityId: requestIndentityId,
                        token: auth
                    };
                    context.log(JSON.stringify(reqBody));
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/blink-payment?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                } else if (paymentProviderAccountDoc.pspType.toLowerCase() === 'swish') {
                    let payeeAlias;
                    if (paymentProviderAccountDoc.settings && paymentProviderAccountDoc.settings.swish)
                        payeeAlias = paymentProviderAccountDoc.settings.swish.swishNumber;
                    if (!currency) {
                        cart.currency = 'SEK';
                        currency = 'SEK';
                    }
                    const reqBody = {
                        payeeAlias: payeeAlias,
                        amount: cart.totalAmountInclVat,
                        currency: currency,
                        payeePaymentReference: payeePaymentReference,
                    };
                    if (req.body.mobilePhone) {
                        reqBody.mobilePhone = req.body.mobilePhone;
                    }
                    if (cart.products && cart.products.length && cart.products[0]) {
                        reqBody.message = cart.products[0].productName;
                    } else {
                        context.log(`cart does not have any product for cartID(${req.body.userSessionID})`);
                    }
                    if (reqBody) {
                        const logObj = {};
                        logObj.reqBody = reqBody;
                        logObj.cartID = req.body.userSessionID;
                        context.log(logObj);
                    }
                    const isTesting = process.env.IS_TESTING;
                    context.log(`trying to send req to swish payment for cartID(${req.body.userSessionID})`);
                    context.log(JSON.stringify(reqBody));
                    result = await Swish.swishPayment(reqBody, context, isTesting);
                    checkoutSession.paymentProvider = 'Swish';
                    if (result && Array.isArray(result)) {
                        response.error = result[0];
                    }
                    await utils.creatjePaymentLogs(checkoutSession, result);
                
                } else if (paymentProviderAccountDoc.pspType.toLowerCase() === 'bluecode') {
                    //Because bluecode support only EUR currency.
                    currency = 'EUR';
                    const reqBody = {
                        scheme: 'blue_code',
                        branch_ext_id: req.body.branch_id,
                        paymentProviderAccountID: req.body.paymentProviderAccountID,
                        merchant_tx_id: payeePaymentReference,
                        requested_amount: cart.totalAmountInclVat * 100,
                        currency: currency,
                        merchant_callback_url: process.env.BLUECODE_CALLBACK_URL,
                        return_url_success: successfulUrl,
                        return_url_failure: failedUrl,
                        return_url_cancel: failedUrl
                    };
                    if (reqBody) {
                        const logObj = {};
                        logObj.reqBody = reqBody;
                        logObj.cartID = req.body.userSessionID;
                        context.log(logObj);
                    }
                    context.log(`trying to send req to swish payment for cartID(${req.body.userSessionID})`);
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/bluecode-register`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });

                    if (result && result.payment && result.payment.checkin_code) {
                        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_BLUECODE, result);
                        response.qrCode = result.payment.checkin_code;
                    } else if (result.code) {
                        response.error = result.code;
                    } else {
                        response.error = 'there is some issue.';
                    }
                    checkoutSession.paymentProvider = 'Bluecode';
                } else if (paymentProviderAccountDoc.pspType.toLowerCase() === 'creditcard') {
                    const reqBody = {
                        merchant_order_id: req.body.userSessionID,
                        order_id: uuid.v4(),
                        purchase_currency: cart.currency,
                        cart: {
                            items: items
                        },
                        require_shipping: false,
                        express_shipping: true,
                        hooks: {
                            user_return_url_on_success: successfulUrl,
                            user_return_url_on_fail: failedUrl,
                            webhook_url: process.env.HIPS_CALLBACK_URL
                        }
                    };
                    context.log(JSON.stringify(reqBody));
                    result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/hips-order?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                        json: true,
                        body: reqBody,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        }
                    });
                    checkoutSession.paymentProvider = 'Hips';
                } else if (paymentProviderAccountDoc.pspType.toLowerCase() === 'planetpayment') {
                    if (checkoutSession.paymentTransactionResponse)
                        context.log(checkoutSession.paymentTransactionResponse.sCATransRef);
                    const reqBody = {
                        amount: cart.totalAmountInclVat,
                        requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                        requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                        requesterStationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterStationID : '',
                        bankAuthCode: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.bankAuthCode : '',
                        SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                        token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
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
                        result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${req.body.paymentProviderAccountID}`, {
                            json: true,
                            body: reqBody,
                            headers: {
                                'x-functions-key': process.env.PAYMENTS_API_KEY
                            }
                        });
                        checkoutSession.paymentProvider = 'Planet';
                    } catch (error) {
                        isPlanetError = true;
                        if (error.error && error.error.result && error.error.result.includes('<ResultReason>') && error.error.result.includes('</ResultReason>')) {
                            let resultReasonText = error.error.result.split('<ResultReason>');
                            resultReasonText = resultReasonText[1].split('</ResultReason>')[0];
                            checkoutSession.resultReasonText = resultReasonText;
                        }
                    }
                }
            }
        }
        if (cart.cartType === 'booking') {
            await request.patch(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/booking-status/${cart._id}`, {
                json: true,
                body: {
                    currency: currency
                },
                headers: {
                    'x-functions-key': process.env.CUSTOMER_API_KEY
                }
            });
        }
        if (result) {
            checkoutSession._id = uuid.v4();
            checkoutSession.docType = 'checkoutSession';
            checkoutSession.partitionKey = req.body.userSessionID;
            checkoutSession.userSessionID = req.body.userSessionID;
            checkoutSession.webShopToken = req.body.webShopToken;
            context.log('webShopID = ' + webShop._id);
            checkoutSession.webShopID = webShop._id;
            checkoutSession.passToken = req.body.passToken;
            checkoutSession.passID = req.body.passID;
            checkoutSession.voucherToken = req.body.voucherToken;
            checkoutSession.customerEmail = req.body.customerEmail;
            checkoutSession.receiverEmail = req.body.customerEmail;
            checkoutSession.pspType = paymentProviderAccountDoc.pspType;
            checkoutSession.receiverText = req.body.receiverText;
            checkoutSession.paymentStatus = 'pending';
            checkoutSession.currency = currency;
            checkoutSession.paymentProviderAccountID = req.body.paymentProviderAccountID;
            if (req.body.receiverMobilePhone)
                checkoutSession.receiverMobilePhone = req.body.receiverMobilePhone;
            if (req.body.mobilePhone)
                checkoutSession.receiverMobilePhone = req.body.mobilePhone;
            checkoutSession.products = productsArray.productDetails;
            checkoutSession.totalVatAmount = cart.totalVatAmount;
            if (cart.discountCode) {
                checkoutSession.totalAmountInclVatAfterDiscount = cart.totalAmountInclVatAfterDiscount;
                checkoutSession.totalVatAmountAfterDiscount = cart.totalVatAmountAfterDiscount;
            }
            checkoutSession.createdDate = new Date();
            checkoutSession.updatedDate = new Date();
            checkoutSession._ts = checkoutSession.createdDate;
            checkoutSession.ttl = 60 * 60 * 24 * 3;
            
            let pspRedirectURL;
            context.log(result);
            if (result.location) { //for swish payment
                pspRedirectURL = result.location;
                if (result.id)
                    checkoutSession.paymentProviderSessionID = result.id;
                else checkoutSession.paymentProviderSessionID = payeePaymentReference;
            }
            if (result.payment && result.payment.checkin_code) { //for bluecode payment
                pspRedirectURL = result.payment.checkin_code;
                checkoutSession.paymentProviderSessionID = result.payment.merchant_tx_id;
                checkoutSession.acquirer_tx_id = result.payment.acquirer_tx_id;
                checkoutSession.end_to_end_id = result.payment.end_to_end_id;
            }
            if (result.checkout_uri) { //for hips payment
                pspRedirectURL = result.checkout_uri;
                checkoutSession.paymentProviderSessionID = result.id;
            }
            if (!pspRedirectURL && result.id) { //for stripe payment
                pspRedirectURL = result.url;
                checkoutSession.paymentProviderSessionID = result.id;
            }
            if (result && result.requestId) { //for blink payment
                checkoutSession.requestId = result.requestId;
                pspRedirectURL = result.requestId;
            }
            if (isPlanetError === true) { //for plant payment
                context.log('planet payment has error');
                checkoutSession.transactionResult = 'failed';
            }
            const customer = await retailTransactionUtils.linkedCustomer(checkoutSession, currency, webShop.ownerMerchantID, context);
            checkoutSession.customerID = customer._id;
            const collection = await getMongodbCollection('Orders');
            await collection.insertOne(checkoutSession);
            if (paymentProviderAccountDoc.pspType.toLowerCase() === 'swish') {
                let paymentResult;
                if (result && result.location)
                    paymentResult = 'approved';
                else
                    paymentResult = 'denied';
                await utils.createPaymentLogs(checkoutSession, result, 'sale', '', paymentResult);
            }
            if (response && response.error) {
                context.res = {
                    body: response
                };
            } else {
                context.res = {
                    body: { pspRedirectURL: pspRedirectURL, checkoutSessionID: checkoutSession._id }
                };
            }
            return;
        }
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
        return;
    }
    return;
};