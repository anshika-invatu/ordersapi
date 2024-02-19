'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleCartProduct = { ...require('../spec/sample-docs/CartProduct'), _id: uuid.v4() };
sampleCartProduct.webShopID = uuid.v4();
const sampleWebshop = { ...require('../spec/sample-docs/Webshop'), _id: sampleCartProduct.webShopID,ownerMerchantID: uuid.v4() };
const sampleOrderRequest = { ...require('../spec/sample-docs/OrderRequest'), _id: uuid.v4() };
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const collectionName = 'Orders';
const queueName = 'pending-orders-queue-test';
const { getMongodbCollection } = require('../db/mongodb');
sampleOrder.partitionKey = sampleOrder._id;
sampleWebshop.partitionKey = sampleWebshop.ownerMerchantID;
sampleWebshop.issueVouchers = true;
sampleWebshop.doActions = true;
sampleWebshop.actions = [{
    actionCode: 'openDoor',
    actionName: 'Open door',
    pointOfServiceID: uuid.v4(),
    merchantID: uuid.v4(),
    pointofServiceName: 'Main door'
}];

describe('Create Order', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.insertOne(sampleWebshop);
    });

    describe('Validations', () => {
        it('should return status code 400 when request body is null', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body seems to be empty. Kindly pass the order to be created using request body in application/json format',
                    reasonPhrase: 'EmptyRequestBodyError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if amount is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {},
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing amount field. Kindly pass the order amount to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeAmountError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if vatAmount is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing vatAmount field. Kindly pass the order vatAmount to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeVatAmountError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if currency is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                        vatAmount: 11
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing currency field. Kindly pass the order currency to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeCurrencyError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if description is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                        vatAmount: 11,
                        currency: 'SEK'
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing description field. Kindly pass the order description to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeDescriptionError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if stripeToken is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                        vatAmount: 11,
                        currency: 'SEK',
                        description: 'Order description'
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing stripeToken field. Kindly pass the order stripeToken to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeTokenError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if email is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                        vatAmount: 11,
                        description: 'Cart description',
                        stripeToken: '123',
                        currency: 'SEK'
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing email field. Kindly pass the order email to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeReceiptEmailError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error if userSessionId is missing from request body', async () => {
            try {
                await request.post(helpers.API_URL + '/api/v1/orders', {
                    json: true,
                    body: {
                        amount: 123,
                        vatAmount: 11,
                        currency: 'SEK',
                        description: 'Cart description',
                        stripeToken: 'abc123',
                        email: 'user@domain.ext'
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'You\'ve requested to create a new order but the request body is missing userSessionId field. Kindly pass the order userSessionId to be charged using request body in application/json format',
                    reasonPhrase: 'MissingStripeUserSessionIdError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });

        it('should throw error on incorrect _id field', async () => {
            try {
                await request.post(`${helpers.API_URL}/api/v1/orders`, {
                    json: true,
                    body: {
                        _id: 123,
                        amount: 123,
                        vatPercent: 12,
                        vatAmount: 25,
                        currency: 'SEK',
                        description: 'Cart description',
                        stripeToken: 'abc123',
                        email: 'user@domain.ext',
                        userSessionId: uuid.v4()
                    },
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (error) {
                const response = {
                    code: 400,
                    description: 'The _id specified in the request body does not match the UUID v4 format.',
                    reasonPhrase: 'InvalidUUIDError'
                };

                expect(error.statusCode).to.equal(400);
                expect(error.error).to.eql(response);
            }
        });
    });

    it('should throw error if cart document could not be found', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/orders`, {
                json: true,
                body: {
                    _id: uuid.v4(),
                    amount: 123,
                    vatPercent: 12,
                    vatAmount: 25,
                    currency: 'SEK',
                    description: 'Cart description',
                    stripeToken: 'abc123',
                    email: 'user@domain.ext',
                    userSessionId: uuid.v4()
                },
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'Cart document for userSessionId specified in the URL doesn\'t exist.',
                reasonPhrase: 'CartNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error if webshop document could not be found', async () => {
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.deleteOne({ _id: sampleWebshop._id, docType: 'webshop', partitionKey: sampleWebshop.partitionKey });
        
        try {
            // Create cart document
            const userId = uuid.v4();
            const cartUrl = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${userId}/cart`;
            await request.patch(cartUrl, {
                body: {
                    product: sampleCartProduct.products[0],
                    webShopID: sampleCartProduct.webShopID,
                    webShopName: sampleCartProduct.webShopName
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });

            const orderID = uuid.v4();

            await request.post(helpers.API_URL + '/api/v1/orders', {
                body: {
                    ...sampleOrderRequest,
                    userSessionId: userId,
                    queueName,
                    _id: orderID
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The webshop doesn\'t exist with this webShopID.',
                reasonPhrase: 'WebShopNotFoundError'
            };
            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
        await collectionMerchants.insertOne(sampleWebshop);
    });
    it('should create a stripe charge, paymentTransaction, pending order documents', async () => {
        // Create cart document
        const userId = uuid.v4();
        const cartUrl = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${userId}/cart`;
        await request.patch(cartUrl, {
            body: {
                product: sampleCartProduct.products[0],
                webShopID: sampleCartProduct.webShopID,
                webShopName: sampleCartProduct.webShopName
            },
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });

        const orderID = uuid.v4();

        const result = await request.post(helpers.API_URL + '/api/v1/orders', {
            body: {
                ...sampleOrderRequest,
                mobilePhone: '+46123466777',
                userSessionId: userId,
                queueName,
                _id: orderID
            },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        // Get paymentTransaction document
        const paymentTransactionBaseUrl = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}`;
        const paymentTransactionUrl = paymentTransactionBaseUrl + `/orders/${orderID}/transaction`;

        const paymentTransaction = await request.get(paymentTransactionUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });

        const collectionMerchants = await getMongodbCollection('Merchants');
        const webShop = await collectionMerchants.findOne({
            _id: sampleWebshop._id,
            docType: 'webshop'
        });
        expect(paymentTransaction).not.to.be.null;
        expect(paymentTransaction.transactionStatus).to.equal('Captured');
        expect(paymentTransaction.orderID).to.equal(orderID);
        expect(paymentTransaction.sellerMerchantID).to.equal(webShop.ownerMerchantID);

        expect(typeof paymentTransaction.amountPaid).to.equal('number');
        expect(typeof paymentTransaction.vatAmount).to.equal('number');


        const pendingOrderUrl = `${helpers.API_URL}/api/v1/orders/${orderID}`;

        // Get pending order document
        const pendingOrder = await request.get(pendingOrderUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(pendingOrder).not.to.be.null;
        expect(pendingOrder._id).to.equal(orderID);
        expect(pendingOrder.orderStatus).to.equal('Pending');
        expect(pendingOrder.receiverMobilePhone).to.equal('+46123466777');

        expect(pendingOrder.transactionID).to.equal(paymentTransaction._id);
        expect(pendingOrder.transactionStatus).to.equal(paymentTransaction.transactionStatus);

        expect(typeof pendingOrder.amountPaid).to.equal('number');
        expect(typeof pendingOrder.vatAmount).to.equal('number');

        expect(pendingOrder.customerEmail).to.equal(sampleOrderRequest.email);
        expect(pendingOrder.receiverEmail).to.equal(sampleOrderRequest.email);

        // Check if cart document is deleted.
        const cart = await request.get(cartUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        expect(cart).to.be.undefined;

        // OrderAPI Result
        expect(result).to.eql({
            description: 'Successfully send the order to azure bus topic for processing.',
            orderID
        });

        // Delete payment transaction
        await request.delete(`${paymentTransactionBaseUrl}/transactions/${paymentTransaction._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });

        // Delete pending order doc
        await request.delete(pendingOrderUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.deleteOne({ _id: sampleWebshop._id, docType: 'webshop', partitionKey: sampleWebshop.partitionKey });
    });
});