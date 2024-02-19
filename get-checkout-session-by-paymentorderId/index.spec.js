'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const sampleCheckoutSession = require('../spec/sample-docs/CheckoutSession');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleCheckoutSession._id = uuid.v4();
sampleCheckoutSession.partitionKey = sampleCheckoutSession._id;
sampleCheckoutSession.orderID = uuid.v4();

describe('Get checkout session by orderId', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleCheckoutSession);
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/checkout-session-by-paymentorderId/${sampleCheckoutSession.orderID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result._id).to.equal(sampleCheckoutSession._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleCheckoutSession._id, docType: 'checkoutSession', partitionKey: sampleCheckoutSession._id });
    });
});