'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleSession = { ...require('../spec/sample-docs/Session'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleSession.partitionKey = sampleSession._id;

describe('Update Session', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/session/123-abc`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {}
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The session id specified in the URL does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/session/${uuid.v4()}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    walletID: uuid.v4()
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The session id specified in the URL doesn\'t exist.',
                reasonPhrase: 'SessionNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should update the document when all validation passes', async () => {
        const session = await request
            .patch(`${helpers.API_URL}/api/v1/session/${sampleSession._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    walletID: uuid.v4()
                }
            });

        expect(session).not.to.be.null;
        expect(session).to.eql({ description: 'Successfully updated the document' });

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleSession._id, docType: 'session', partitionKey: sampleSession._id });

    });
});