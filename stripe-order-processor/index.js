'use strict';

const uuid = require('uuid');
const Promise = require('bluebird');
const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const utils = require('../utils');
const PAYMENT_PROVIDER_STRIPE = 'stripe';
const { CustomLogs } = utils;
const retailTransactionUtils = require('../utils/retail-transaction-webshop');

//BAC-385 From merchant Portal
module.exports = async (context, event) => {
    const orderID = uuid.v4();
    const incomingRequest = {};
    incomingRequest.event = event;
    CustomLogs(incomingRequest, context);

    if (!event || !event.type || event.type !== 'checkout.session.completed' || !event.data || !event.data.object) {
        return Promise.resolve();
    }

    const session = event.data.object;

    if (!session.client_reference_id) {
        const cancelRequest = {};
        cancelRequest.eventId = event.id;
        cancelRequest.paymentProviderSessionID = session.id;
        cancelRequest.type = event.type;
        CustomLogs(cancelRequest, context);
        return Promise.resolve();
    }

    try {
        const orderCollection = await getMongodbCollection('Orders');

        const checkoutSession = await orderCollection.findOne({
            userSessionID: session.client_reference_id,
            paymentProviderSessionID: session.id,
            docType: 'checkoutSession'
        });
        if (!checkoutSession) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentProviderSessionID = session.id;
            checkoutSessionNotFound.userSessionID = session.client_reference_id;
            checkoutSessionNotFound.message = `checkoutSession doc not found for this userSessionID = ${session.client_reference_id}`;
            CustomLogs(checkoutSessionNotFound, context);
            return Promise.resolve();
        }

        const cart = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${session.client_reference_id}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (!cart) {
            const cartNotFound = {};
            cartNotFound.paymentProviderSessionID = session.id;
            cartNotFound.userSessionID = session.client_reference_id;
            cartNotFound.message = `cart not found for this userSessionID = ${session.client_reference_id}`;
            CustomLogs(cartNotFound, context);
            return Promise.resolve();
        }
        const cartDoc = {};
        cartDoc.paymentProviderSessionID = session.id;
        cartDoc.userSessionID = session.client_reference_id;
        cartDoc.cart = cart;
        CustomLogs(cartDoc, context);
        let webshop;
        try {
            webshop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshops/${cart.webShopID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.MERCHANT_API_KEY
                }
            });
        } catch (error) {
            context.log(error);
        }
        if (!webshop) {
            webshop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshop-by-webShopTitle/${cart.webShopName}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.MERCHANT_API_KEY
                }
            });
            cart.webShopID = webshop._id;
            const updateCart = await request.patch(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/cart/${session.client_reference_id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                },
                body: {
                    webShopID: webshop._id
                }
            });
            context.log(updateCart);
        }
        context.log(webshop);
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

        const charge = await utils.getStripeCharge(context, session);
        context.log(charge);
        const paymentTransaction = await createPaymentTransaction(session, cart, webshop, amount, vatAmount,charge);

        context.log(paymentTransaction);
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
                currency: (session.currency).toUpperCase(),
                webShopID: cart.webShopID,
                webShopName: cart.webShopName,
                customerEmail: session.customer_email,
                receiverEmail: session.customer_email,
                receiverMobilePhone: session.customer_mobilePhone,
                products: products,
                createdDate: new Date(),
                updatedDate: new Date(),
                partitionKey: orderID,
                sellerMerchantID: webshop.ownerMerchantID
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
                orderDoc.paymentProviderSessionID = session.id;
                orderDoc.userSessionID = session.client_reference_id;
                orderDoc.order = order.ops[0];
                CustomLogs(orderDoc, context);

                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);
                const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession);
                context.log('retailTransaction = ' + retailTransaction);

                const updatedCheckoutSession = await orderCollection.updateOne({
                    userSessionID: session.client_reference_id,
                    docType: 'checkoutSession',
                    partitionKey: checkoutSession.partitionKey
                }, {
                    $set: {
                        _ts: new Date(),
                        changeID: charge.id,
                        ttl: 60 * 60 * 24 * 3,
                        docType: 'checkoutSessionCompleted',
                        updatedDate: new Date()
                    }
                });
                if (updatedCheckoutSession && updatedCheckoutSession.matchedCount) {
                    const cartResult = await request.delete(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${session.client_reference_id}/cart`, {
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

    } catch (error) {

        const stripeOrderProcessorError = {};
        stripeOrderProcessorError.paymentProviderSessionID = session.id;
        stripeOrderProcessorError.userSessionID = session.client_reference_id;
        stripeOrderProcessorError.order = error;
        CustomLogs(stripeOrderProcessorError, context);

        error => utils.handleError(context, error);
    }

    function createPaymentTransaction (message, cartDoc, webShop, amount, vatAmount,charge) {

        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            orderID: orderID,
            amountPaid: Number(amount),
            vatAmount: Number(vatAmount),
            currency: (message.currency) ? message.currency.toUpperCase() : '',
            webShopID: cartDoc.webShopID,
            webShopName: cartDoc.webShopName,
            paymentProvider: PAYMENT_PROVIDER_STRIPE,
            paymentProviderReference: charge ? charge.id : null,
            sellerMerchantID: webShop.ownerMerchantID,
            products: cartDoc.products,
        };

        if (message.payment_method_types && Array.isArray(message.payment_method_types) && message.payment_method_types.includes('card')) {
            body.paymentType = 'creditcard';
        }
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