'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const utils = require('../utils');
const Promise = require('bluebird');
const uuid = require('uuid');
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/retail-transaction-webshop');

//From POS Device

module.exports = async (context, mySbMsg) => {
    const orderID = uuid.v4();
    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);
    try {
        const collection = await getMongodbCollection('Orders');
        let checkoutSession;
        if (mySbMsg.orderId) {
            checkoutSession = await collection.findOne({
                orderID: mySbMsg.orderId,
                docType: 'checkoutSession'
            });
        }
        if (!checkoutSession) {
            context.log('checkoutSession doc does not exist');
            const logObj = {};
            logObj.massage = `checkoutSession does not exist in db for ${mySbMsg.orderid}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }

        if (!mySbMsg.transactionInfo || !mySbMsg.transactionInfo.status || mySbMsg.transactionInfo.status.toUpperCase() !== 'RESERVED') {
            context.log('incoming massage status is not RESERVED');
            const logObj = {};
            logObj.massage = `incoming massage status is not RESERVED for ${mySbMsg.orderId}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }

       
        const res = await collection.updateOne({
            _id: checkoutSession._id,
            partitionKey: checkoutSession.partitionKey
        },{
            $set: {
                paymentStatus: mySbMsg.transactionInfo.status
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

        if (!quickshop) {
            context.log('this is not for quickshop');
            return Promise.resolve();
        }
        const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-capture?paymentProviderAccountID=${mySbMsg.paymentProviderAccountID}`, {
            json: true,
            body: {
                merchantSerialNumber: checkoutSession.merchantSerialNumber,
                orderID: checkoutSession.orderID,
                amount: checkoutSession.totalAmountInclVat * 100,
                transactionText: 'error',
                paymentRequestID: checkoutSession.paymentRequestID
            },
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        
        context.log(result);


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
                const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession);
                context.log('retailTransaction = ' + JSON.stringify(retailTransaction));
                const updatedCheckoutSession = await collection.updateOne({
                    paymentProviderReference: mySbMsg.payeePaymentReference,
                    docType: 'checkoutSession',
                    partitionKey: checkoutSession.partitionKey
                }, {
                    $set: {
                        _ts: new Date(),
                        ttl: 60 * 60 * 24 * 3,
                        docType: 'checkoutSessionCompleted',
                        updatedDate: new Date()
                    }
                });
                if (updatedCheckoutSession && updatedCheckoutSession.matchedCount) {
                    context.log('update checkout session sucsessfully');
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


    function  createPaymentTransaction (message,checkoutSession, quickshop, mySbMsg) {

        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            orderID: orderID,
            amountPaid: Number(mySbMsg.amount),
            currency: message.currency,
            quickShopID: quickshop._id,
            webShopName: quickshop.quickShopName,
            paymentProvider: 'Vipps',
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