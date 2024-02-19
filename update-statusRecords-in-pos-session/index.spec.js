'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
samplePOSSession.partitionKey = samplePOSSession._id;

describe('Update Pos Session', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/pos-session/123-abc`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {}
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The pos-session id specified in the URL does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/pos-session/${uuid.v4()}`, {
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
                description: 'The pos-session id specified in the URL doesn\'t exist.',
                reasonPhrase: 'PosSessionNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should update the document when all validation passes', async () => {
        const result = await request
            .patch(`${helpers.API_URL}/api/v1/pos-session/${samplePOSSession._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    walletID: uuid.v4()
                }
            });

        expect(result).not.to.be.null;
        expect(result).to.eql({ description: 'Successfully updated the document' });

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });

    });
});