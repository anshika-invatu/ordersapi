'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: uuid.v4() };
const sampleComponents = { ...require('../spec/sample-docs/Components'), _id: uuid.v4() };
const sampleProducts = { ...require('../spec/sample-docs/Products'), _id: uuid.v4() };
sampleComponents.defaultProduct.productID = sampleProducts._id;
samplePointOfService.deviceEndpoint = { protocolCode: 'ocpp16', auth: { username: 'test' }};
sampleComponents.pointOfServiceID = samplePointOfService._id;
const sampleUsers = { ...require('../spec/sample-docs/Users'), _id: uuid.v4() };
sampleComponents.partitionKey = sampleComponents._id;
sampleUsers.partitionKey = sampleUsers._id;
sampleUsers.merchants = [{
    merchantID: samplePointOfService.merchantID,
    merchantName: 'test',
    roles: 'admin'
}];


describe('Stop count up Session', () => {
    before(async () => {
        await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-services`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-components`, {
            json: true,
            body: sampleComponents,
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
            await request.post(`${helpers.API_URL}/api/v1/stop-count-up-session`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to stop count up session but the request body seems to be empty. Kindly specify the request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect _id field', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/stop-count-up-session`, {
                json: true,
                body: { componentID: uuid.v4() },
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The Components of specified details doesn\'t exist.',
                reasonPhrase: 'ComponentsNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/stop-count-up-session`, {
                body: { componentID: uuid.v4() },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The Components of specified details doesn\'t exist.',
                reasonPhrase: 'ComponentsNotFoundError'
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
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });
});