'use strict';

const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const { CustomLogs } = utils;
const Swish = require('../utils/swish-payment');
const retailTransactionUtils = require('../utils/retail-transaction-webshop');


//BASE-470.

module.exports = async (context, req) => {
    try {
        context.log('Req body = ' + JSON.stringify(req.body));
        CustomLogs(req.body, context);
        
        const collection = await getMongodbCollection('Orders');
        const posSession = await collection.findOne({ _id: req.body.posSessionID, docType: 'posSessions', partitionKey: req.body.posSessionID });

        if (!posSession) {
            utils.setContextResError(
                context,
                new errors.POSSessionNotFoundError(
                    'Pos Session does not exist with this posSessionID.',
                    404
                )
            );
            return Promise.resolve();
        }

        context.log('Pos session = ' + JSON.stringify(posSession));
        const salesChannel = await this.getSalesChannal(req);
        context.log('Sales channel = ' + JSON.stringify(salesChannel));
        const paymentProviderAccount = await this.getPaymentProviderAccount(req.body.paymentProviderAccountID);

        const paymentResult = await this.createPayments(posSession, paymentProviderAccount, context, req.body.payMobilePhone);
        context.log('Payment result = ' + JSON.stringify(paymentResult));

        const checkoutSession = await this.createCheckoutSession(req, posSession, salesChannel, paymentProviderAccount, paymentResult);

        await collection.insertOne(checkoutSession);
        let customerInfoMasked;
        customerInfoMasked = '';
        if (req.body.payMobilePhone) {
            const lastFour = req.body.payMobilePhone.substr(req.body.payMobilePhone.length - 4);
            customerInfoMasked = '******' + lastFour;
        }
        context.log('Customer info masked = ' + customerInfoMasked);
        const updateObj = {
            paymentProviderReference: posSession.paymentProviderReference,
            paymentID: checkoutSession.paymentID,
            pspType: paymentProviderAccount.pspType,
            paymentStatusCode: 'pending',
            paymentProviderAccountID: paymentProviderAccount._id,
            paymentProviderAccountName: paymentProviderAccount.paymentProviderAccountName
        };
        if (paymentProviderAccount && paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() !== 'swish') {
            const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, customerInfoMasked, context, { 'shop': 'quickshop' });
            context.log('Retail transaction = ' + JSON.stringify(retailTransaction));
            updateObj.retailTransactionID = retailTransaction._id;
        }
        updateObj.customerInfo = customerInfoMasked;
        const updatedPosSession = await collection.updateOne({
            _id: posSession._id,
            partitionKey: posSession.partitionKey,
            docType: 'posSessions'
        }, {
            $set: updateObj
        });
        const response = {
            description: 'Successfully pay pos session.'
        };
        if (paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'stripe') {
            response.pspRedirectUrl = process.env.STRIPE_URL + '' + paymentResult.charges ? paymentResult.charges.url : '';
            response.pspClientSecret = paymentResult.client_secret ? paymentResult.client_secret : '';
            response.pspStatus = paymentResult.status ? paymentResult.status : '';
            response.stripeAccountID = paymentProviderAccount.settings ? paymentProviderAccount.settings.stripeAccount : '';
        } else if (paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'swish') {
            response.pspRedirectURL = paymentResult.location;
            response.pspToken = paymentResult.token;
            response.paymentStatusCode = 'accepted';
        }
        context.log(updatedPosSession.matchedCount);
        context.log('Response = ' + JSON.stringify(response));
        context.res = {
            body: response
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.createPayments = async (posSession, paymentProviderAccount, context, payerAlias) => {
    let paymentResult;
    context.log(payerAlias);
    if (paymentProviderAccount && paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'swish') {
        let payeeAlias;
        if (paymentProviderAccount.settings && paymentProviderAccount.settings.swish)
            payeeAlias = paymentProviderAccount.settings.swish.swishNumber;
        let currency = paymentProviderAccount.currency;
        if (!currency) {
            paymentProviderAccount.currency = 'SEK';
            currency = 'SEK';
        }
        let payeePaymentReference = uuid.v4();
        payeePaymentReference = payeePaymentReference.replace(/-/ig, '').toUpperCase();
        const reqBody = {
            payeeAlias: payeeAlias,
            amount: posSession.preAuthorizationAmount,
            currency: currency,
            payeePaymentReference: payeePaymentReference,
            message: posSession.productName,
            mobilePhone: payerAlias
        };
        posSession.paymentProviderReference = payeePaymentReference;
        const isTesting = process.env.IS_TESTING;
        context.log(reqBody);
        CustomLogs(`trying to send req to swish payment for cartID(${posSession._id})`, context);
        try {
            paymentResult = await Swish.swishPayment(reqBody, context, isTesting);
            let paymentResultCode;
            if (paymentResult && paymentResult.location)
                paymentResultCode = 'approved';
            else
                paymentResultCode = 'denied';
            await utils.createPaymentLogs(posSession, paymentResult, '', posSession.preAuthorizationAmount, paymentResultCode);
        } catch (error) {
            context.log(error);
        }
    }
    if (paymentProviderAccount && paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'stripe') {
        const stripeAccount = paymentProviderAccount.settings ? paymentProviderAccount.settings.stripeAccount : '';
        paymentResult = await utils.stripePaymentIntents(posSession, stripeAccount, context);
    }
    return paymentResult;
};


exports.getPaymentProviderAccount = async (paymentProviderAccountID) => {
    const paymentProviderAccount = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${paymentProviderAccountID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    });
    return paymentProviderAccount;
};

exports.getSalesChannal = async (req) => {
    let salesChannel;
    if (req.body.salesChannelType && req.body.salesChannelType === 'webshop') {
        salesChannel = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshops/${req.body.salesChannelID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
    }
    if (req.body.salesChannelType && req.body.salesChannelType === 'quickshop') {
        salesChannel = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/quickshop/${req.body.salesChannelID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
    }
    return salesChannel;
};

exports.createCheckoutSession = async (req, posSession, salesChannel, paymentProviderAccount, paymentResult) => {
    const checkoutSession = {};
    checkoutSession._id = uuid.v4();
    checkoutSession.partitionKey = checkoutSession._id;
    checkoutSession.docType = 'checkoutSession';
    checkoutSession.sessionResultCode = 'checkoutSession';
    checkoutSession.paymentProvider = paymentProviderAccount.pspName;
    checkoutSession.pspType = paymentProviderAccount.pspType;
    checkoutSession.currency = paymentProviderAccount.currency;
    checkoutSession.paymentProviderAccountID = paymentProviderAccount._id;
    checkoutSession.userSessionID = salesChannel._id;
    checkoutSession.paymentProviderReference = posSession.paymentProviderReference,
    checkoutSession.totalAmountInclVat = posSession.preAuthorizationAmount;
    checkoutSession.posSessionID = posSession._id;
    checkoutSession.pointOfServiceID = posSession.pointOfServiceID;
    if (paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'swish' && paymentResult.location) {
        checkoutSession.paymentProvider = 'Swish';
        checkoutSession.pspType = 'swish';
        let id = paymentResult.location.split('/');
        id = id[id.length - 1];
        checkoutSession.paymentID = id;
        checkoutSession.paymentToken = paymentResult.token;
    }
    if (paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'stripe' && paymentResult) {
        checkoutSession.paymentProvider = 'Stripe';
        checkoutSession.pspType = 'stripe';
        checkoutSession.paymentID = paymentResult.id;
    }
    const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${posSession.productID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        }
    });
    checkoutSession.products = [{
        productID: posSession.productID,
        productName: posSession.productName,
        productDescription: product.productDescription,
        issuer: product.issuer,
        quantity: 1,
        pricePerUnit: product.salesPrice,
        unitCode: product.unitCode,
        amount: product.salesPrice
    }];
    if (req.body.salesChannelType === 'webshop')
        checkoutSession.webShopID = salesChannel._id;
    if (req.body.salesChannelType === 'quickshop')
        checkoutSession.quickShopID  = salesChannel._id;
    if (req.body.customerEmail)
        checkoutSession.receiverEmail = req.body.customerEmail;
    if (req.body.payMobilePhone)
        checkoutSession.receiverMobilePhone = req.body.payMobilePhone;

    if (req.body.posSessionID)
        checkoutSession.posSessionID = req.body.posSessionID;
    checkoutSession._ts = new Date();
    checkoutSession.ttl = 60 * 60 * 24 * 3;
    checkoutSession.createdDate = new Date();
    checkoutSession.updatedDate = new Date();
    return checkoutSession;
};


