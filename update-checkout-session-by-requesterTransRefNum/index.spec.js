'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleCheckoutSession = { ...require('../spec/sample-docs/CheckoutSession'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleCheckoutSession.partitionKey = sampleCheckoutSession._id;
sampleCheckoutSession.paymentTransactionResponse = {
    requesterTransRefNum: 'testRefNum'
};

describe('Update checkout Session', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleCheckoutSession);
    });

    it('should update the document when all validation passes', async () => {
        const result = await request.patch(`${helpers.API_URL}/api/v1/checkout-session-by-requesterTransRefNum/testRefNum`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                newbankAuthCode: uuid.v4()
            }
        });

        expect(result).not.to.be.null;
        expect(result).to.eql({ description: 'Successfully updated the document' });

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleCheckoutSession._id, docType: 'checkoutSession', partitionKey: sampleCheckoutSession._id });

    });
});