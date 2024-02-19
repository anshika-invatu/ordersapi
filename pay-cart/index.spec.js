'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const pointOfServiceID = uuid.v4();
const productID = uuid.v4();
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: pointOfServiceID, transactionID: uuid.v4() };
const sampleProduct = { ...require('../spec/sample-docs/Products'), _id: productID };
samplePointOfService.isEnabled = true;
samplePointOfService.isOpenForSale = true;
samplePointOfService.isInMaintenanceMode = false;
samplePointOfService.actions = [];

describe('Pay-cart', () => {
    before(async () => {
        await request.post(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products`, {
            json: true,
            body: sampleProduct,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
    });

    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/pay-cart', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to pay cart but the request body seems to be empty. Kindly pass request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect pointOfServiceID field', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/pay-cart', {
                body: {
                    pointOfServiceID: 123
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The pointOfServiceID specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('Should return error if cart doc not exist', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/pay-cart', {
                body: {
                    pointOfServiceID: uuid.v4(),
                    pspType: 'creditcard',
                    paymentStatus: 'approved',
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'cart does not exist.',
                reasonPhrase: 'CartNotFoundError'
            };
            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }

    });

    it('Should pay cart when all validations true.', async () => {
       
        await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-services`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        await request.patch(`${process.env.PRODUCT_API_URL}/api/v1/add-product-to-cart/${pointOfServiceID}`, {
            body: { productID: productID },
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        const result = await request.post(helpers.API_URL + '/api/v1/pay-cart', {
            body: {
                pointOfServiceID: pointOfServiceID,
                pspType: 'creditcard',
                paymentStatus: 'approved',
                paymentTransactionResponse: {
                    fingerPrint: 'TESTVALUE'
                }
            },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(result).not.to.be.null;
        expect(result.checkoutSessionID).not.to.be.null;
    });

    after(async () => {
        await request.delete(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${sampleProduct._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        await request.delete(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/merchants/${samplePointOfService.merchantID}/point-of-services?pointOfServiceID=${pointOfServiceID}`, {
            json: true,
            body: samplePointOfService,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
    });
});