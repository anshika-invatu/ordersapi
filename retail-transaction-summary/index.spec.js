'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleRetailTransaction = { ...require('../spec/sample-docs/RetailTransaction'), _id: uuid.v4() };
const sampleMerchants = { ...require('../spec/sample-docs/Merchants'), _id: sampleRetailTransaction.merchantID };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleRetailTransaction.partitionKey = sampleRetailTransaction._id;
sampleRetailTransaction.merchantID = uuid.v4();
sampleRetailTransaction.currency = 'SEK';
sampleRetailTransaction.retailTransactionDate = new Date('2020-02-21');
sampleRetailTransaction.itemText = 'Test Doc';
sampleRetailTransaction.retailTransactionStatusCode = 'Paid';
sampleRetailTransaction.pspType = 'creditcard';

describe('Get Retail Transactions Summary', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);
        sampleMerchants._id = sampleRetailTransaction.merchantID;
        await request.post(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            body: sampleMerchants,
            json: true
        });
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/retail-transaction-summary`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                merchantID: sampleRetailTransaction.merchantID
            }
        });

        expect(result).not.to.be.null;
        expect(result.merchantID).to.equal(sampleRetailTransaction.merchantID);
    });

    it('should return the document when all validation passes(with some more parameters)', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/retail-transaction-summary`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                merchantID: sampleRetailTransaction.merchantID,
                currency: 'SEK',
                itemText: 'Test'
            }
        });

        expect(result).not.to.be.null;
        expect(result.merchantID).to.equal(sampleRetailTransaction.merchantID);
    });

    it('should return the document when all validation passes(with all parameter)', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/retail-transaction-summary`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                merchantID: sampleRetailTransaction.merchantID,
                itemText: 'Test',
                currency: 'SEK',
                status: 'Paid',
                paymentType: 'creditcard',
                pointOfServiceID: sampleRetailTransaction.pointOfServiceID,
                transactionID: sampleRetailTransaction._id,
                fromDate: '2020-01-01',
                toDate: '2020-07-29'
            }
        });

        expect(result).not.to.be.null;
        expect(result.merchantID).to.equal(sampleRetailTransaction.merchantID);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
        await request.delete(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${sampleMerchants._id}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        });
    });
});