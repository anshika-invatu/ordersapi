
'use strict';



const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const Swish = require('./swish-payment');



exports.linkedPosSession = async (checkoutSession, posSessionID, retailTransaction, paymentStatusCode, context) => {
    const collection = await getMongodbCollection('Orders');
    const query = {
        _id: posSessionID,
        partitionKey: posSessionID,
        docType: 'posSessions'
    };
    const posSession = collection.findOne(query);
    if (!posSession) {
        context.log('posSession doc does not exist');
        //BASE-668
        const paymentProviderAccountsDoc = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${checkoutSession.paymentProviderAccountID}`, {
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
        
        const currency = checkoutSession.currency ? checkoutSession.currency : 'SEK';
        
        reqBody.body.cancelBody = {
            callbackUrl: process.env.CALLBACK_URL,
            payerAlias: payerAlias.toString(),
            amount: retailTransaction.totalAmountInclVat ? retailTransaction.totalAmountInclVat.toString() : '',
            currency: currency,
            message: ''
        };
        const paymentID = checkoutSession.paymentID;
        if (checkoutSession && checkoutSession.swishCallBackResult) {
            reqBody.body.cancelBody.originalPaymentReference = checkoutSession.swishCallBackResult.paymentReference;
            reqBody.instructionUUID = checkoutSession.swishCallBackResult.payeePaymentReference;
        }
        context.log(JSON.stringify(reqBody));
        context.log(paymentID);
        const result = await Swish.swishPayment(reqBody, context, isTesting, paymentID);
        context.log(result);
        return Promise.resolve();
    }
    const updatedBody = {
        customerID: retailTransaction.customerID,
        paymentStatusCode: paymentStatusCode,
        pspType: retailTransaction.pspType,
        paymentProviderAccountID: retailTransaction.paymentProviderAccountID,
        paymentProviderAccountName: retailTransaction.paymentProviderAccountName,
        pspLogoImageURL: retailTransaction.pspLogoImageURL,
        retailTransactionID: retailTransaction._id,
        totalAmountInclVat: retailTransaction.totalAmountInclVat,
        totalVatAmount: retailTransaction.totalVatAmount,
        vatPercent: retailTransaction.vatPercent,
        vatClass: retailTransaction.vatPercent,
    };
    if (retailTransaction.customerInfoMasked) {
        //Get last 4 digits
        //const customerinfo = retailTransaction.customerInfoMasked.match(/(.{4}$)/);
        const customerinfo = retailTransaction.customerInfoMasked;
        //Get first 6 digits (credit card prefix BIN)
        const creditcardBIN = retailTransaction.customerInfoMasked.match(/(\d+)/);
        //updatedBody.customerInfo = customerinfo ? (Array.isArray(customerinfo) ? customerinfo[0] : '') : '';
        updatedBody.customerInfo = customerinfo;
        updatedBody.creditcardBIN = creditcardBIN ? (Array.isArray(creditcardBIN) ? creditcardBIN[0] : '') : '';
    }
    const res = await collection.updateOne(query,{
        $set: updatedBody });
    context.log(res.matchedCount);
};

exports.stopPosSession = async (posSessionID, context) => {
    try {
        const result = await request.post(`${process.env.ORDERS_API_URL}/api/${process.env.ORDERS_API_VERSION}/stop-pos-session`, {
            body: {
                posSessionID: posSessionID
            },
            json: true,
            headers: {
                'x-functions-key': process.env.ORDERS_API_KEY
            }
        });
        context.log(result);
    } catch (error) {
        context.log(error);
    }
};