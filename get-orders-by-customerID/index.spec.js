'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const sampleOrder = require('../spec/sample-docs/Orders');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleOrder._id = uuid.v4();
sampleOrder.partitionKey = sampleOrder._id;

describe('Get Retail Transaction by customerID', () => {
    before(async () => {
        sampleOrder.customerID = uuid.v4();
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);
    });

    it('should throw error on incorrect customerID field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/customers/123/orders`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The customerID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return empty array if data not exist in db', async () => {

        const result = await request.get(`${helpers.API_URL}/api/v1/customers/${uuid.v4()}/orders`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result).to.be.instanceOf(Array);

    });

    it('should return the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/customers/${sampleOrder.customerID}/orders`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(sampleOrder._id);
    });

    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });
    });
});