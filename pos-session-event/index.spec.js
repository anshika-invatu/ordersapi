'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: uuid.v4() };
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
const sampleProducts = { ...require('../spec/sample-docs/Products'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');


describe('Pos Session event', () => {
    before(async () => {
        
        await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-services`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        await request.post(process.env.PRODUCT_API_URL + '/api/v1/products', {
            body: sampleProducts,
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });
    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/pos-session-event`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to pos session event but the request body seems to be empty. Kindly specify the request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incomplete parameters', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/pos-session-event`, {
                json: true,
                body: { pointOfServiceID: '123' },
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'Please pass atleast one of them(posSessionID, pointOfServiceID or posSessionReferenceID) and eventCode.',
                reasonPhrase: 'FieldValidationError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/pos-session-event`, {
                body: { pointOfServiceID: uuid.v4(), eventCode: 'test' },
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
        await request.delete(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/merchants/${samplePointOfService.merchantID}/point-of-services?pointOfServiceID=${samplePointOfService._id}`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        await request.delete(process.env.PRODUCT_API_URL + '/api/v1/products/' + sampleProducts._id, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, partitionKey: samplePOSSession._id, docType: 'posSessions' });
    });
});