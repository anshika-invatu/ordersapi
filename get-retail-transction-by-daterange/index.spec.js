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
sampleRetailTransaction.currency = 'SEK';
sampleRetailTransaction.retailTransactionDate = new Date();
sampleRetailTransaction.itemText = 'Test Doc';
sampleRetailTransaction.retailTransactionStatusCode = 'Paid';
sampleRetailTransaction.pspType = 'creditcard';
sampleRetailTransaction.pointOfServiceID = uuid.v4();


describe('Get Retail Transactions By daterange', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);
    });

    it('should return the document when all validation passes', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/retail-transaction-by-daterange`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    groupBy: 'today',
                    merchantID: sampleRetailTransaction.merchantID
                }
            });
        expect(result).not.to.be.null;
        expect(result[0].numerOfTransactions).to.not.null;
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
    });
});