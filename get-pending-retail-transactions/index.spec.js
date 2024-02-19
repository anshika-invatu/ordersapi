'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleRetailTransaction = { ...require('../spec/sample-docs/RetailTransaction'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleRetailTransaction.partitionKey = sampleRetailTransaction._id;
sampleRetailTransaction.merchantID = uuid.v4();
sampleRetailTransaction.posSessionID = uuid.v4();

describe('Get Pending Retail Transactions', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/merchants/${sampleRetailTransaction.merchantID}/pending-retail-transaction`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(sampleRetailTransaction._id);
    });

    it('should return the document when all validation passes(with query parameters)', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/merchants/${sampleRetailTransaction.merchantID}/pending-retail-transaction?posSessionID=${sampleRetailTransaction.posSessionID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(sampleRetailTransaction._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
    });
});