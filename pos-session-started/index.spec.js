'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: uuid.v4() };
const sampleComponents = { ...require('../spec/sample-docs/Components'), _id: uuid.v4() };
const sampleProducts = { ...require('../spec/sample-docs/Products'), _id: uuid.v4() };
samplePointOfService.deviceEndpoint = { protocolCode: 'ocpp16', auth: { username: 'test' }};
sampleComponents.pointOfServiceID = samplePointOfService._id;
const sampleUsers = { ...require('../spec/sample-docs/Users'), _id: uuid.v4() };
sampleUsers.partitionKey = sampleUsers._id;
sampleUsers.merchants = [{
    merchantID: samplePointOfService.merchantID,
    merchantName: 'test',
    roles: 'admin'
}];


describe('Pos Session Started', () => {
    before(async () => {
        await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-services`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        sampleComponents.defaultProduct = { productID: sampleProducts._id };
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
            await request.post(`${helpers.API_URL}/api/v1/pos-session-started`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to pos session started but the request body seems to be empty. Kindly specify the request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return error message with 200 code when wrong pointOfSerciceID.', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/pos-session-started`, {
            body: { pointOfServiceID: '123',
                componentID: sampleComponents._id,
                salesChannelTypeCode: 'pos',
                salesChannelID: uuid.v4(),
                sessionType: 'test' },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).to.eql({ description: 'Theres is an error when pos session event started.' });

    });

    it('should start pos session when all validation passes', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/pos-session-started`, {
            body: { pointOfServiceID: samplePointOfService._id,
                componentID: sampleComponents._id,
                salesChannelTypeCode: 'pos',
                salesChannelID: uuid.v4(),
                sessionType: 'test' },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;

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