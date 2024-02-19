'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() ,transactionID: uuid.v4() };



describe('Refund Pos Session', () => {
    before(async () => {
        samplePOSSession.partitionKey = samplePOSSession._id;
        samplePOSSession.docType = 'posSessionsOld';
        const collection = await getMongodbCollection('Orders');
        await collection.insertOne(samplePOSSession);
    });

    it('should return status code 400 when pos session id is not uuid.', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/pos-session-error-refund', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: {
                    posSessionID: '123'
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The posSessionID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });


    it('Should return error if doc not exist', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/pos-session-error-refund', {
                body: {
                    posSessionID: uuid.v4(),
                    merchantID: uuid.v4()
                },
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
   

    after(async () => {
        const collection = await getMongodbCollection('Orders');
        await collection.deleteOne({ _id: samplePOSSession._id, partitionKey: samplePOSSession._id });
    });
});