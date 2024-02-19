'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const sampleOrder2 = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const sampleMerchantID = uuid.v4();
const sampleWebShopID = uuid.v4();
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');

sampleOrder.partitionKey = sampleOrder._id;
sampleOrder2.partitionKey = sampleOrder2._id;
describe('Get order by merchantID', () => {
    before(async () => {
        sampleOrder2.sellerMerchantID = sampleMerchantID;
        sampleOrder2.webShopID = sampleWebShopID;
        sampleOrder2.orderDate = new Date('2017-10-16T14:05:36Z');

        sampleOrder.sellerMerchantID = sampleMerchantID;
        sampleOrder.webShopID = sampleWebShopID;
        sampleOrder.orderDate = new Date('2018-10-16T14:05:36Z');
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);
        await collection.insertOne(sampleOrder2);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/merchants/abc-123/orders`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The order id specified in the URL does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });


    it('should return the document by only merchantID', async () => {
        const orders = await request
            .get(`${helpers.API_URL}/api/v1/merchants/${sampleMerchantID}/orders`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(orders).not.to.be.null;
        expect(orders).to.be.instanceOf(Array).and.not.have.lengthOf(0);
        expect(orders[0].sellerMerchantID).to.equal(sampleMerchantID);
    });

    it('should not return the document if merchantID or webshopID is incorrect', async () => {
        const orders = await request
            .get(`${helpers.API_URL}/api/v1/merchants/${sampleMerchantID}/orders?webShopID=${123}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(orders).not.to.be.null;
        expect(orders).to.be.instanceOf(Array).and.have.lengthOf(0);
    });

    it('should return the document if merchantID and webshopID is correct', async () => {
        const orders = await request
            .get(`${helpers.API_URL}/api/v1/merchants/${sampleMerchantID}/orders?webShopID=${sampleWebShopID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(orders).not.to.be.null;
        expect(orders).to.be.instanceOf(Array).and.not.have.lengthOf(0);
        expect(orders[0].sellerMerchantID).to.equal(sampleMerchantID);
        expect(orders[0].webShopID).to.equal(sampleWebShopID);
    });

    it('should return the document if merchantID and webshopID is correct', async () => {
        const orders = await request
            .get(`${helpers.API_URL}/api/v1/merchants/${sampleMerchantID}/orders?webShopID=${sampleWebShopID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(orders).not.to.be.null;
        expect(orders).to.be.instanceOf(Array).and.not.have.lengthOf(0);
        expect(orders[0].sellerMerchantID).to.equal(sampleMerchantID);
        expect(orders[0].webShopID).to.equal(sampleWebShopID);
    });

    it('should return the document if merchantID and webshopID is correct', async () => {
        const orders = await request
            .get(`${helpers.API_URL}/api/v1/merchants/${sampleMerchantID}/orders?webShopID=${sampleWebShopID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        
        expect(orders).not.to.be.null;
        expect(orders).to.be.instanceOf(Array).and.not.have.lengthOf(0);
        expect(orders[0].sellerMerchantID).to.equal(sampleMerchantID);
        expect(orders[0].webShopID).to.equal(sampleWebShopID);
    });


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });
        await collection.deleteOne({ _id: sampleOrder2._id, docType: 'order', partitionKey: sampleOrder2._id });
    });
});