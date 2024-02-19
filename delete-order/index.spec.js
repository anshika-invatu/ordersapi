'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleOrder.partitionKey = sampleOrder._id;

describe('Delete order', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.delete(`${helpers.API_URL}/api/v1/orders/123-abc`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The order id specified in the URL does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.delete(`${helpers.API_URL}/api/v1/orders/${uuid.v4()}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The order id specified in the URL doesn\'t exist.',
                reasonPhrase: 'OrderNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should delete the document when all validation passes', async () => {
        const order = await request
            .delete(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(order).not.to.be.null;
        expect(order).to.eql({ description: 'Successfully deleted the specified order' });

        // Get document
        try {
            await request.get(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            expect(error.statusCode).to.equal(404);
        }
    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });

    });
});