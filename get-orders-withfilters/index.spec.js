'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleOrder.partitionKey = sampleOrder._id;
sampleOrder.sellerMerchantID = uuid.v4();
const crypto = require('crypto');
const randomString = crypto.randomBytes(3).toString('hex');
const email = `test.${randomString}@vourity.com`;
sampleOrder.currency = 'SEK';
const sampleWallet = { ...require('../spec/sample-docs/Wallets'), _id: uuid.v4(), mobilePhone: '7896541230', vourityID: 'HJHJ4566641' };
sampleWallet.email = email;
sampleOrder.walletID = sampleWallet._id;
sampleOrder.webShopID = uuid.v4();
sampleOrder.orderStatus = 'Pending';
sampleOrder.orderDate = new Date('2019-02-21');

describe('Get Orders Withfilters', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);
        await request.post(process.env.WALLET_API_URL + `/api/${process.env.WALLET_API_VERSION}/wallets`, {
            body: sampleWallet,
            json: true,
            headers: {
                'x-functions-key': process.env.WALLET_API_KEY
            }
        });
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/orders-withfilters`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: '123'
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The merchantID specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const order = await request
            .post(`${helpers.API_URL}/api/v1/orders-withfilters`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleOrder.sellerMerchantID
                }
            });

        expect(order).not.to.be.null;
        expect(order[0]._id).to.equal(sampleOrder._id);
    });

    it('should return the document when all validation passes(with email)', async () => {
        const order = await request
            .post(`${helpers.API_URL}/api/v1/orders-withfilters`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleOrder.sellerMerchantID,
                    email: email
                }
            });

        expect(order).not.to.be.null;
        expect(order[0]._id).to.equal(sampleOrder._id);
    });

    it('should return the document when all validation passes(with all parameter)', async () => {
        const order = await request
            .post(`${helpers.API_URL}/api/v1/orders-withfilters`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleOrder.sellerMerchantID,
                    email: email,
                    orderID: sampleOrder._id,
                    currency: 'SEK',
                    webshopID: sampleOrder.webShopID,
                    orderStatus: 'Pending',
                    fromDate: '2019-01-01',
                    toDate: '2019-04-29'
                }
            });

        expect(order).not.to.be.null;
        expect(order[0]._id).to.equal(sampleOrder._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });
        await request.delete(process.env.WALLET_API_URL + `/api/${process.env.WALLET_API_VERSION}/wallets/${sampleWallet._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.WALLET_API_KEY
            }
        });
    });
});