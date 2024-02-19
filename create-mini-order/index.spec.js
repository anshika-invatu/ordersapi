'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleWebshop = {
    ...require('../spec/sample-docs/Webshop'),
    _id: uuid.v4(),
    ownerMerchantID: uuid.v4()
};
const sampleMiniOrder = require('../spec/sample-docs/MiniOrder');
sampleMiniOrder.webshopID = sampleWebshop._id;
const {
    getMongodbCollection
} = require('../db/mongodb');
sampleWebshop.partitionKey = sampleWebshop.ownerMerchantID;

const sampleProduct = {
    ...require('../spec/sample-docs/Products'),
    _id: uuid.v4()
};

sampleProduct.partitionKey = sampleProduct._id;
sampleMiniOrder.productID = sampleProduct._id;
sampleWebshop.issueVouchers = true;
sampleWebshop.doActions = true;
sampleWebshop.actions = [{
    actionCode: 'openDoor',
    actionName: 'Open door',
    pointOfServiceID: uuid.v4(),
    merchantID: uuid.v4(),
    pointofServiceName: 'Main door'
}];

describe('Create MiniOrder', () => {
    before(async () => {
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.insertOne(sampleWebshop);
        await request.post(process.env.PRODUCT_API_URL + '/api/v1/products', {
            body: sampleProduct,
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });


    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/mini-orders', {
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
            await request.post(helpers.API_URL + '/api/v1/mini-orders', {
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

    it('should throw error if currency is missing from request body', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/mini-orders', {
                json: true,
                body: {
                    amountPaid: 123,
                    vatamountPaid: 11
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



    it('should create the transaction', async () => {
        delete sampleMiniOrder._id;
        const result = await request.post(helpers.API_URL + '/api/v1/mini-orders', {
            body: {
                ...sampleMiniOrder
            },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        // Get paymentTransaction document
        const paymentTransactionBaseUrl = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}`;
        const paymentTransactionUrl = paymentTransactionBaseUrl + `/orders/${result.orderID}/transaction`;

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
        expect(paymentTransaction.orderID).to.equal(result.orderID);
        expect(paymentTransaction.sellerMerchantID).to.equal(webShop.ownerMerchantID);

        expect(typeof paymentTransaction.amountPaid).to.equal('number');
        expect(typeof paymentTransaction.vatAmount).to.equal('number');


        const pendingOrderUrl = `${helpers.API_URL}/api/v1/orders/${result.orderID}`;

        // Get pending order document
        const pendingOrder = await request.get(pendingOrderUrl, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(pendingOrder).not.to.be.null;
        expect(pendingOrder._id).to.equal(result.orderID);
        expect(pendingOrder.orderStatus).to.equal('Pending');

        expect(pendingOrder.transactionID).to.equal(paymentTransaction._id);
        expect(pendingOrder.transactionStatus).to.equal(paymentTransaction.transactionStatus);

        expect(typeof pendingOrder.amountPaid).to.equal('number');
        expect(typeof pendingOrder.vatAmount).to.equal('number');

        // expect(pendingOrder.customerEmail).to.equal(sampleOrderRequest.email);
        // expect(pendingOrder.receiverEmail).to.equal(sampleOrderRequest.email);

        // OrderAPI Result
        expect(result).to.eql({
            description: 'Successfully send the order to azure bus topic for processing.',
            orderID: result.orderID
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
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.deleteOne({
            _id: sampleWebshop._id,
            docType: 'webshop',
            partitionKey: sampleWebshop.partitionKey
        });
        await request.delete(process.env.PRODUCT_API_URL + '/api/v1/products/' + sampleProduct._id, {
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });
});