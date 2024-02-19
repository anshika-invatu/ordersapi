'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
samplePOSSession.partitionKey = samplePOSSession._id;

describe('Cancel pos Session', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/cancel-pos-session`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: { posSessionID: '123' }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The posSessionID field specified in the url does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/cancel-pos-session`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    posSessionID: uuid.v4()
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

    it('should update the document when all validation passes', async () => {
        const result = await request
            .post(`${helpers.API_URL}/api/v1/cancel-pos-session`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    posSessionID: samplePOSSession._id
                }
            });

        expect(result).not.to.be.null;
        expect(result.description).to.eql('Successfully cancel the posSession.');

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessionOld', partitionKey: samplePOSSession._id });

    });
});