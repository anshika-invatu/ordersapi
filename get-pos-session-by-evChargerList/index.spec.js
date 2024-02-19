'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
samplePOSSession.partitionKey = samplePOSSession._id;
samplePOSSession.merchantID = uuid.v4();
samplePOSSession.sessionStartDate = new Date('2019-02-21');

describe('get-pos-session by the evChargerList', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/pos-session-by-evChargerList?pointOfServiceID=${123}&&componentID=${'123abc'}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The pointOfService id specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return error when pos session does not exist.', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/pos-session-by-evChargerList?pointOfServiceID=${uuid.v4()}&&componentID={123abc}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The component id specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/pos-session-by-evChargerList?pointOfServiceID=${samplePOSSession.pointOfServiceID}&&componentID=${samplePOSSession.componentID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result.docType).to.equal('posSessions');
    });


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});