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
sampleCheckoutSession.paymentProviderReference = uuid.v4();

describe('Get checkout session by paymentProviderReference', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleCheckoutSession);
    });

    it('should return the document when all validation passes', async () => {
        const order = await request.get(`${helpers.API_URL}/api/v1/checkout-session-by-payeePaymentReference/${sampleCheckoutSession.paymentProviderReference}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(order).not.to.be.null;
        expect(order._id).to.equal(sampleCheckoutSession._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleCheckoutSession._id, docType: 'checkoutSession', partitionKey: sampleCheckoutSession._id });
    });
});