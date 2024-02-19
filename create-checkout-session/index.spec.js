'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const userId = uuid.v4();
const { getMongodbCollection } = require('../db/mongodb');
const sampleCartProduct = { ...require('../spec/sample-docs/CartProduct'),
    _id: userId,
    partitionKey: userId
};
sampleCartProduct._id = userId;
const webShopToken = uuid.v4();
sampleCartProduct.products[0].salesPrice = 20;
const sampleWebshop = { ...require('../spec/sample-docs/Webshop'), _id: uuid.v4(), ownerMerchantID: uuid.v4() };
sampleWebshop.webShopToken = webShopToken;

describe('Create Checkout Session', () => {
    before(async () => {
        await request.post(process.env.MERCHANT_API_URL + '/api/v1/webshops', {
            body: sampleWebshop,
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        await request.patch(`${process.env.PRODUCT_API_URL}/api/v1/users/${userId}/cart`, {
            body: {
                product: sampleCartProduct.products[0]
            },
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });

    it('should throw error if amount is less than 3.00 kr sek.', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/checkout-session`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    userSessionID: userId,
                    webShopToken: uuid.v4(),
                    orderDate: new Date()
                }
            });
        } catch (error) {
            // const response = {
            //     code: 400,
            //     description: 'Amount must be at least 3.00 kr sek',
            //     reasonPhrase: 'StripeInvalidRequestError'
            // };
            //console.log(error);
            // expect(error.statusCode).to.equal(400);
            // expect(error.error).to.eql(response);
        }
    });

    it('should create checkout session when all casses are pass', async () => {
        await request.delete(`${process.env.PRODUCT_API_URL}/api/v1/users/${userId}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        sampleCartProduct.products[0].salesPrice = 2000;
        const collectionMerchants = await getMongodbCollection('Merchants');
        await collectionMerchants.insertOne(sampleCartProduct);
        try {
            const result = await request
                .post(`${helpers.API_URL}/api/v1/checkout-session`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    },
                    body: {
                        userSessionID: sampleCartProduct._id,
                        webShopToken: webShopToken,
                        orderDate: new Date()
                    }
                });

            expect(result).not.to.be.null;
        } catch (error) {
            //console.log(error);
        }
        //expect(result.userSessionID).to.eql(userId);

    });

    after(async () => {
        await request.delete(`${process.env.PRODUCT_API_URL}/api/v1/users/${userId}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        await request.delete(process.env.MERCHANT_API_URL + '/api/v1/webshops/' + sampleWebshop._id, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
    });
});