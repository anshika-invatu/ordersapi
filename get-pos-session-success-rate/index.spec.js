'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
samplePOSSession.partitionKey = samplePOSSession._id;
samplePOSSession.docType = 'posSessionsOld';
samplePOSSession.merchantID = uuid.v4();
samplePOSSession.usageTotalVolume = 100;
samplePOSSession.customerID = uuid.v4();

describe('get-pos-session-success-rate', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/pos-session-success-rate`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: { merchantID: '123' }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The merchant id specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/pos-session-success-rate`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: { merchantID: samplePOSSession.merchantID }
        });

        expect(result).not.to.be.null;
        expect(result.plugInSuccessRatePercentage).to.equal(100);
    });
    


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});