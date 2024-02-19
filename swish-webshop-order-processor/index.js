'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const uuid = require('uuid');
const utils = require('../utils');
const Promise = require('bluebird');
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/retail-transaction-webshop');

//From merchant portal

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
                paymentProviderSessionID: mySbMsg.payeePaymentReference,
                docType: 'checkoutSession'
            });
        }
        if (!checkoutSession) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentProviderSessionID = mySbMsg.payeePaymentReference;
            checkoutSessionNotFound.message = 'checkoutSession doc not found.';
            CustomLogs(checkoutSessionNotFound, context);
            return Promise.resolve();
        }
        const res = await collection.updateOne({
            _id: checkoutSession._id,
            partitionKey: checkoutSession.partitionKey
        },{
            $set: {
                paymentStatus: mySbMsg.status
            }
        });
        context.log(res.matchedCount);
        const cart = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${checkoutSession.userSessionID}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (!cart) {
            const cartNotFound = {};
            cartNotFound.paymentProviderSessionID = mySbMsg.payeePaymentReference;
            cartNotFound.message = `cart not found for this paymentProviderSessionID = ${mySbMsg.payeePaymentReference}`;
            CustomLogs(cartNotFound, context);
            return Promise.resolve();
        }
        const cartDoc = {};
        cartDoc.paymentProviderSessionID = mySbMsg.payeePaymentReference;
        cartDoc.cart = cart;
        CustomLogs(cartDoc, context);

        const webShop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshops/${cart.webShopID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });

        let amount = 0, vatAmount = 0; const products = [];
        
        if (cart.products && Array.isArray(cart.products)) {
            for (let i = 0; i < cart.products.length; i++) {
                const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${cart.products[i].productID}`, {
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
                    products.push(cart.products[i]);
                }
            }
        }

        const paymentTransaction = await createPaymentTransaction(mySbMsg, cart, webShop, amount, vatAmount,mySbMsg.id);


        if (paymentTransaction) {
            const pendingOrder = {
                _id: orderID,
                docType: 'order',
                orderDate: new Date(),
                orderStatus: 'Pending',
                transactionID: paymentTransaction._id,
                transactionStatus: paymentTransaction.transactionStatus,
                amountPaid: Number(Number(amount).toFixed(2)),
                vatAmount: Number(Number(vatAmount).toFixed(2)),
                currency: mySbMsg.currency,
                webShopID: cart.webShopID,
                webShopName: cart.webShopName,
                products: products,
                createdDate: new Date(),
                updatedDate: new Date(),
                partitionKey: orderID,
                sellerMerchantID: webShop.ownerMerchantID
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
                orderDoc.paymentProviderSessionID = mySbMsg.payeePaymentReference;
                orderDoc.order = order.ops[0];
                CustomLogs(orderDoc, context);

                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);
                context.log('webShopID = ' + checkoutSession.webShopID);
                const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession);
                context.log('retailTransaction = ' + retailTransaction);
                const updatedCheckoutSession = await collection.updateOne({
                    paymentProviderSessionID: mySbMsg.payeePaymentReference,
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
                    const cartResult = await request.delete(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${checkoutSession.userSessionID}/cart`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PRODUCT_API_KEY
                        }
                    });
                    if (cartResult) {
                        
                        context.log('deleted cart sucsessfully');
                    }
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
    function createPaymentTransaction (message, cartDoc, webShop, amount, vatAmount,id) {

        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            orderID: orderID,
            amountPaid: Number(amount),
            vatAmount: Number(vatAmount),
            currency: message.currency,
            webShopID: cartDoc.webShopID,
            webShopName: cartDoc.webShopName,
            paymentProvider: PAYMENT_PROVIDER_SWISH,
            paymentProviderReference: id ? id : null,
            sellerMerchantID: webShop.ownerMerchantID,
            products: cartDoc.products,
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