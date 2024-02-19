'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const uuid = require('uuid');
const utils = require('../utils');
const Promise = require('bluebird');
const { CustomLogs } = utils;
const Swish = require('../utils/swish-payment');
const retailTransactionUtils = require('../utils/retail-transaction-webshop');

//From merchant portal(quickshop)

module.exports = async (context, mySbMsg) => {
    const orderID = uuid.v4();
    const PAYMENT_PROVIDER_SWISH = 'swish';
    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);
    try {
        if (!mySbMsg.status || mySbMsg.status.toUpperCase() !== 'PAID') {
            context.log('incoming massage status is not PAID');
            const logObj = {};
            logObj.massage = `incoming massage status is not PAID for ${mySbMsg.payeePaymentReference}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }
        const collection = await getMongodbCollection('Orders');
        let checkoutSession;
        if (mySbMsg.payeePaymentReference) {
            checkoutSession = await collection.findOne({
                paymentProviderReference: mySbMsg.payeePaymentReference,
                docType: 'checkoutSession'
            });
        }
        if (!checkoutSession) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentProviderReference = mySbMsg.payeePaymentReference;
            checkoutSessionNotFound.message = 'checkoutSession doc not found.';
            CustomLogs(checkoutSessionNotFound, context);
            context.log('checkoutSession not found');
            return Promise.resolve();
        }
        context.log('checkoutSession doc = ' + JSON.stringify(checkoutSession));
        const res = await collection.updateOne({
            _id: checkoutSession._id,
            partitionKey: checkoutSession.partitionKey
        },{
            $set: {
                paymentStatus: mySbMsg.status
            }
        });
        context.log(res.matchedCount);

        const quickshop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/quickshop/${checkoutSession.quickShopID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });

        context.log(quickshop);

        const paymentTransaction = await createPaymentTransaction(mySbMsg, checkoutSession, quickshop, mySbMsg);
        context.log(paymentTransaction);

        if (paymentTransaction) {
            const pendingOrder = {
                _id: orderID,
                docType: 'order',
                orderDate: new Date(),
                orderStatus: 'Pending',
                transactionID: paymentTransaction._id,
                transactionStatus: paymentTransaction.transactionStatus,
                amountPaid: Number(Number(mySbMsg.amount).toFixed(2)),
                currency: mySbMsg.currency,
                quickShopID: quickshop._id,
                quickShopName: quickshop.quickShopName,
                products: checkoutSession.products,
                createdDate: new Date(),
                updatedDate: new Date(),
                partitionKey: orderID,
                sellerMerchantID: quickshop.merchantID
            };

            if (checkoutSession && checkoutSession.passID) {
                pendingOrder.passID = checkoutSession.passID;
            }
            if (checkoutSession)
                pendingOrder.customerID = checkoutSession.customerID;
            pendingOrder.receiverMobilePhone = checkoutSession.receiverMobilePhone;
            pendingOrder.receiverEmail = checkoutSession.receiverEmail;
            if (pendingOrder.receiverMobilePhone && !pendingOrder.receiverMobilePhone.includes('+'))
                pendingOrder.receiverMobilePhone = '+' + pendingOrder.receiverMobilePhone;
            context.log('Creating Order Doc');

            const order = await collection.insertOne(pendingOrder);

            if (order && order.ops) {
                const orderDoc = {};
                orderDoc.paymentProviderReference = mySbMsg.payeePaymentReference;
                orderDoc.order = order.ops[0];
                CustomLogs(orderDoc, context);

                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);
                context.log('quickShopID = ' + checkoutSession.quickShopID);
                let customerInfoMasked;
                if (checkoutSession.receiverMobilePhone) {
                    const lastFour = checkoutSession.receiverMobilePhone.substr(checkoutSession.receiverMobilePhone.length - 4);
                    customerInfoMasked = '******' + lastFour;
                }
                const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, customerInfoMasked, context);
                if (checkoutSession.posSessionID) {
                    const posSession = await collection.findOne({ _id: checkoutSession.posSessionID, docType: 'posSessions', partitionKey: checkoutSession.posSessionID });
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
                        if (checkoutSession && checkoutSession.paymentProviderReference) {
                            reqBody.body.cancelBody.originalPaymentReference = checkoutSession.paymentProviderReference;
                            reqBody.instructionUUID = checkoutSession.paymentProviderReference;
                        }
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
                }
                context.log('retailTransaction = ' + JSON.stringify(retailTransaction));
                const updatedCheckoutSession = await collection.updateOne({
                    paymentProviderReference: mySbMsg.payeePaymentReference,
                    docType: 'checkoutSession',
                    partitionKey: checkoutSession.partitionKey
                }, {
                    $set: {
                        _ts: new Date(),
                        ttl: 60 * 60 * 24 * 3,
                        retailTransactionID: retailTransaction._id,
                        docType: 'checkoutSessionCompleted',
                        updatedDate: new Date()
                    }
                });
                if (updatedCheckoutSession && updatedCheckoutSession.matchedCount) {
                    context.log('update checkout session sucsessfully');
                    const updatedPosSession = await collection.updateOne({
                        _id: checkoutSession.posSessionID,
                        partitionKey: checkoutSession.posSessionID
                    }, {
                        $set: {
                            retailTransactionID: retailTransaction._id,
                            updatedDate: new Date()
                        }
                    });
                    if (updatedPosSession && updatedPosSession.matchedCount)
                        context.log('update pos session sucsessfully');
                } else {
                    context.log('checkout session not updated');
                }
            }
        }
        return Promise.resolve();
    } catch (error) {
        context.log(error);
        const logObj = {};
        logObj.error = error;
        CustomLogs(logObj, context);
        return Promise.resolve();
    }
    function createPaymentTransaction (message,checkoutSession, quickshop, mySbMsg) {

        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            orderID: orderID,
            amountPaid: Number(mySbMsg.amount),
            currency: message.currency,
            quickShopID: quickshop._id,
            webShopName: quickshop.quickShopName,
            paymentProvider: PAYMENT_PROVIDER_SWISH,
            paymentProviderReference: mySbMsg.id ? mySbMsg.id : null,
            sellerMerchantID: quickshop.merchantID,
            products: checkoutSession.products,
            paymentType: 'creditcard'
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

        return request.post(url, options);
    }
};