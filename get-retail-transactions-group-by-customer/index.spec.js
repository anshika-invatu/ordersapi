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
sampleRetailTransaction.retailTransactionDate = new Date('2020-02-21');
sampleRetailTransaction.itemText = 'Test Doc';
sampleRetailTransaction.retailTransactionStatusCode = 'Paid';
sampleRetailTransaction.pspType = 'creditcard';
sampleRetailTransaction.pointOfServiceID = uuid.v4();
sampleRetailTransaction.businessUnitID = uuid.v4();


describe('Get Retail Transactions Group By customerID', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);
    });

    it('should return the document when all validation passes', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/retail-transaction-group-by-customer`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleRetailTransaction.merchantID
                }
            });
        expect(result).not.to.be.null;
        expect(result[0].pspType).not.to.be.null;
    });

    it('should return the document when all validation passes(with some more parameters)', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/retail-transaction-group-by-customer`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleRetailTransaction.merchantID,
                    businessUnitID: sampleRetailTransaction.businessUnitID
                }
            });
        expect(result).not.to.be.null;
        expect(result[0].pspType).not.to.be.null;
    });

    it('should return the document when all validation passes(with all parameter)', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/retail-transaction-group-by-pointOfService`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: sampleRetailTransaction.merchantID,
                    businessUnitID: sampleRetailTransaction.businessUnitID,
                    fromDate: '2020-01-01',
                    toDate: '2020-07-29'
                }
            });
        expect(result).not.to.be.null;
        expect(result[0].pspType).not.to.be.null;
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
    });
});