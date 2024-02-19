'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() };
const collectionName = 'Orders';

describe('Update order', () => {
    before(async () => {
        sampleOrder.partitionKey = sampleOrder._id;
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleOrder);

    });
    it('should return status code 400 when request body is null', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to update an order but the request body seems to be empty. Kindly specify the order properties to be updated using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect _id field', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/orders/123`, {
                json: true,
                body: {},
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

    it('should throw error if the request body does not contain any fields', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
                body: {},
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to update an order but the request body seems to be empty. Kindly specify the order properties to be updated using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/orders/${uuid.v4()}`, {
                body: { isRedeemed: true },
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

    it('should update document when all validation passes', async () => {
        const result = await request.patch(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
            body: { isRedeemed: true },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).to.eql({ description: 'Successfully updated the document' });

        // Get sample document
        const order = await request.get(`${helpers.API_URL}/api/v1/orders/${sampleOrder._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(order).not.to.be.null;
        expect(order.isRedeemed).to.equal(true);
        expect(order.createdDate).not.to.be.null;
        expect(order.updatedDate).not.to.be.null;
        expect(order.updatedDate).not.to.equal(sampleOrder.updatedDate);
    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleOrder._id, docType: 'order', partitionKey: sampleOrder._id });
 
    });
});