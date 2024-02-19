'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
samplePOSSession.partitionKey = samplePOSSession._id;
samplePOSSession.merchantID = uuid.v4();
samplePOSSession.currency = 'SEK';
samplePOSSession.createdDate = new Date('2020-02-21');
samplePOSSession.itemText = 'Test Doc';
samplePOSSession.retailTransactionStatusCode = 'Paid';
samplePOSSession.pspType = 'creditcard';
samplePOSSession.docType = 'posSessionsOld';
samplePOSSession.pointOfServiceID = uuid.v4();
samplePOSSession.siteID = uuid.v4();
samplePOSSession.siteName = 'testSite';


describe('Get Usage Group By SiteID', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should return the document when all validation passes', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/usage-group-by-site`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: samplePOSSession.merchantID
                }
            });
        expect(result).not.to.be.null;
        expect(result[0].numerOfTransactions).to.not.null;
    });

    it('should return the document when all validation passes(with some more parameters)', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/usage-group-by-site`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: samplePOSSession.merchantID,
                    currency: 'SEK',
                    itemText: 'Test'
                }
            });

        expect(result).not.to.be.null;
        expect(result[0].numerOfTransactions).to.not.null;
    });

    it('should return the document when all validation passes(with all parameter)', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/usage-group-by-site`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    merchantID: samplePOSSession.merchantID,
                    itemText: 'Test',
                    currency: 'SEK',
                    status: 'Paid',
                    paymentType: 'creditcard',
                    pointOfServiceID: samplePOSSession.pointOfServiceID,
                    transactionID: samplePOSSession._id,
                    fromDate: '2020-01-01',
                    toDate: '2020-07-29'
                }
            });

        expect(result).not.to.be.null;
        expect(result[0].numerOfTransactions).to.not.null;
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessionsOld', partitionKey: samplePOSSession._id });
    });
});