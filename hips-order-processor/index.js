'use strict';

const uuid = require('uuid');
const Promise = require('bluebird');
const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const utils = require('../utils');
const PAYMENT_PROVIDER_HIPS = 'hips';
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/retail-transaction-webshop');

//From merchant portal
module.exports = async (context, mySbMsg) => {
    const orderID = uuid.v4();
    const incomingRequest = {};
    incomingRequest.mySbMsg = mySbMsg;
    CustomLogs(incomingRequest, context);

    if (!mySbMsg || !mySbMsg.resource || !mySbMsg.resource.order_id) {
        CustomLogs('id or merchant_reference.order_id does not exist');
        return Promise.resolve();
    }
    if (mySbMsg.event && mySbMsg.event !== 'payment.purchase.authorized') {
        CustomLogs(`not payment.purchase.authorized event, event is ${mySbMsg.event}`);
        return Promise.resolve();
    }

    try {
        const orderCollection = await getMongodbCollection('Orders');

        const checkoutSession = await orderCollection.findOne({
            paymentProviderSessionID: mySbMsg.resource.order_id,
            docType: 'checkoutSession'
        });
        if (!checkoutSession) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentProviderSessionID = mySbMsg.resource.order_id;
            checkoutSessionNotFound.message = 'checkoutSession doc not found.';
            CustomLogs(checkoutSessionNotFound, context);
            return Promise.resolve();
        }

        const cart = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${checkoutSession.userSessionID}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (!cart) {
            const cartNotFound = {};
            cartNotFound.paymentProviderSessionID = mySbMsg.resource.order_id;
            cartNotFound.userSessionID = checkoutSession.userSessionID;
            cartNotFound.message = `cart not found for this userSessionID = ${checkoutSession.userSessionID}`;
            CustomLogs(cartNotFound, context);
            return Promise.resolve();
        }
        const cartDoc = {};
        cartDoc.paymentProviderSessionID = mySbMsg.resource.order_id;
        cartDoc.userSessionID = checkoutSession.userSessionID;
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
                    cart.products[i].vatAmount = Number(Number(cart.products[i].vatAmount).toFixed(2));
                    cart.products[i].salesPrice = Number(Number(cart.products[i].salesPrice).toFixed(2));
                    vatAmount += cart.products[i].vatAmount;
                    amount += cart.products[i].salesPrice;
                    products.push(cart.products[i]);
                }
            }
        }

        const paymentTransaction = await createPaymentTransaction(mySbMsg.resource, cart, webShop, amount, vatAmount,mySbMsg.resource.order_id);


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
                currency: mySbMsg.resource.settlement_currency,
                webShopID: cart.webShopID,
                webShopName: cart.webShopName,
                products: products,
                customerEmail: checkoutSession.customerEmail,
                receiverEmail: checkoutSession.receiverEmail,
                receiverMobilePhone: checkoutSession.receiverMobilePhone,
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
            if (pendingOrder.receiverMobilePhone && !pendingOrder.receiverMobilePhone.includes('+'))
                pendingOrder.receiverMobilePhone = '+' + pendingOrder.receiverMobilePhone;
            context.log('Creating Order Doc');

            const order = await orderCollection.insertOne(pendingOrder);

            if (order && order.ops) {
                const orderDoc = {};
                orderDoc.paymentProviderSessionID = mySbMsg.resource.order_id;
                orderDoc.userSessionID = checkoutSession.userSessionID;
                orderDoc.order = order.ops[0];
                CustomLogs(orderDoc, context);

                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);

                const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession);
                context.log('retailTransaction = ' + retailTransaction);
                const updatedCheckoutSession = await orderCollection.updateOne({
                    userSessionID: checkoutSession.userSessionID,
                    paymentProviderSessionID: mySbMsg.resource.order_id,
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

        const stripeOrderProcessorError = {};
        stripeOrderProcessorError.paymentProviderSessionID = mySbMsg.resource.order_id;
        stripeOrderProcessorError.order = error;
        CustomLogs(stripeOrderProcessorError, context);

        error => utils.handleError(context, error);
    }

    function createPaymentTransaction (message, cartDoc, webShop, amount, vatAmount,id) {

        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            orderID: orderID,
            amountPaid: Number(amount),
            vatAmount: Number(vatAmount),
            currency: message.settlement_currency,
            webShopID: cartDoc.webShopID,
            webShopName: cartDoc.webShopName,
            paymentProvider: PAYMENT_PROVIDER_HIPS,
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
    return Promise.resolve();
};