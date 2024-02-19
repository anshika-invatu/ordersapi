'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const moment = require('moment');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
samplePOSSession.partitionKey = samplePOSSession._id;
samplePOSSession.merchantID = uuid.v4();
samplePOSSession.sessionStartDate = moment().subtract(1, 'days')
    .toDate();

describe('get-pos-session-by-daterange', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    

    it('should return the document when all validation passes', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/pos-session-by-daterange`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                merchantID: samplePOSSession.merchantID,
                reportDateRange: 'yesterday'
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(samplePOSSession._id);
    });


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});