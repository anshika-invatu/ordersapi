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
        context.log(req.body);
        CustomLogs(req.body, context);
        
        const collection = await getMongodbCollection('Orders');
        const countUpSession = await collection.findOne({ _id: req.body.countUpSessionID, docType: 'countUpSessions', partitionKey: req.body.countUpSessionID });

        if (!countUpSession) {
            utils.setContextResError(
                context,
                new errors.countUpSessionNotFoundError(
                    'Count Up Session does not exist with this countUpSessionID.',
                    404
                )
            );
            return Promise.resolve();
        }
        

        const salesChannel = await this.getSalesChannal(req);

        const paymentProviderAccount = await this.getPaymentProviderAccount(req.body.paymentProviderAccountID);

        const paymentResult = await this.createPayments(countUpSession, paymentProviderAccount, context);
        context.log(paymentResult);

        const checkoutSession = await this.createCheckoutSession(req, countUpSession, salesChannel, paymentProviderAccount, paymentResult);

        await collection.insertOne(checkoutSession);

        const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, '', context);
        context.log(retailTransaction);
        const updatedcountUpSession = await collection.updateOne({
            _id: countUpSession._id,
            partitionKey: countUpSession.partitionKey,
            docType: 'countUpSessions'
        }, {
            $set: {
                paymentProviderReference: countUpSession.paymentProviderReference,
                retailTransactionID: retailTransaction._id,
                paymentID: checkoutSession.paymentID
            }
        });
        context.log(updatedcountUpSession.matchedCount);
        context.res = {
            body: {
                description: 'Successfully pay count up session.'
            }
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.createPayments = async (countUpSession, paymentProviderAccount, context) => {
    let paymentResult;

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
            amount: countUpSession.totalAmountInclVat,
            currency: currency,
            payeePaymentReference: payeePaymentReference,
            message: countUpSession.productName
        };
        countUpSession.paymentProviderReference = payeePaymentReference;
        const isTesting = process.env.IS_TESTING;
        
        CustomLogs(`trying to send req to swish payment for cartID(${countUpSession._id})`, context);
        try {
            paymentResult = await Swish.swishPayment(reqBody, context, isTesting);
            let paymentResultCode;
            if (paymentResult && paymentResult.location)
                paymentResultCode = 'approved';
            else
                paymentResultCode = 'denied';
            await utils.createPaymentLogs(countUpSession, paymentResult, '', countUpSession.totalAmountInclVat, paymentResultCode);
        } catch (error) {
            context.log(error);
        }
    }
    if (paymentProviderAccount && paymentProviderAccount.pspType && paymentProviderAccount.pspType.toLowerCase() === 'stripe') {
        
        paymentResult = await utils.stripePaymentIntents(countUpSession);
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

exports.createCheckoutSession = async (req, countUpSession, salesChannel, paymentProviderAccount, paymentResult) => {
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
    checkoutSession.paymentProviderReference = countUpSession.paymentProviderReference,
    checkoutSession.totalAmountInclVat = countUpSession.totalAmountInclVat;
    checkoutSession.countUpSessionID = countUpSession._id;
    if (countUpSession.pspType && countUpSession.pspType.toLowerCase() === 'swish' && paymentResult.location) {
        checkoutSession.paymentProvider = 'Swish';
        checkoutSession.pspType = 'swish';
        let id = paymentResult.location.split('/');
        id = id[id.length - 1];
        checkoutSession.paymentID = id;
        checkoutSession.paymentToken = paymentResult.token;
    }
    if (countUpSession.pspType && countUpSession.pspType.toLowerCase() === 'stripe' && paymentResult) {
        checkoutSession.paymentProvider = 'Stripe';
        checkoutSession.pspType = 'stripe';
        checkoutSession.paymentID = paymentResult.id;
    }
    const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${countUpSession.productID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        }
    });
    checkoutSession.products = [{
        productID: countUpSession.productID,
        productName: countUpSession.productName,
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
    //checkoutSession.receiverEmail = req.body.location ? req.body.location.contactEmail : req.body.receiverEmail;
    //checkoutSession.receiverMobilePhone = req.body.location ? req.body.location.contactPhone : req.body.receiverMobilePhone;
    if (req.body.countUpSessionID)
        checkoutSession.countUpSessionID = req.body.countUpSessionID;
    checkoutSession._ts = new Date();
    checkoutSession.ttl = 60 * 60 * 24 * 3;
    checkoutSession.createdDate = new Date();
    checkoutSession.updatedDate = new Date();
    return checkoutSession;
};


