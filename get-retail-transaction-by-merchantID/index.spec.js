'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const sampleRetailTransaction = require('../spec/sample-docs/RetailTransaction');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleRetailTransaction._id = uuid.v4();
sampleRetailTransaction.partitionKey = sampleRetailTransaction._id;

describe('Get Retail Transaction by merchantID', () => {
    before(async () => {
        sampleRetailTransaction.merchantID = uuid.v4();
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);
    });

    it('should throw error on incorrect merchantID field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/merchants/123-abc/retail-transaction`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The merchantID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect merchantID field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/merchants/${uuid.v4()}/retail-transaction`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The merchantID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return empty array if data not exist in db', async () => {

        const result = await request.get(`${helpers.API_URL}/api/v1/merchants/${uuid.v4()}/retail-transaction`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result).to.be.instanceOf(Array);

    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/merchants/${sampleRetailTransaction.merchantID}/retail-transaction`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(sampleRetailTransaction._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
    });
});