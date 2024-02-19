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
samplePOSSession.customerID = uuid.v4();

describe('get-pos-session-old', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/pos-session-old/${123}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The id specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return error when pos session does not exist.', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/pos-session-old/${uuid.v4()}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The pos session detail specified doesn\'t exist.',
                reasonPhrase: 'POSSessionNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/pos-session-old/${samplePOSSession._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result.docType).to.equal('posSessionsOld');
    });


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});