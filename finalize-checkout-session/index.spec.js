'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const pointOfServiceID = uuid.v4();
const productID = uuid.v4();
const sessionID = uuid.v4();
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: pointOfServiceID, transactionID: uuid.v4() };
const sampleProduct = { ...require('../spec/sample-docs/Products'), _id: productID };
const sampleSession = { ...require('../spec/sample-docs/Session'), _id: sessionID };
const { getMongodbCollection } = require('../db/mongodb');
samplePointOfService.isEnabled = true;
samplePointOfService.isOpenForSale = true;
samplePointOfService.actions = [];
samplePointOfService.isInMaintenanceMode = false;
sampleSession.partitionKey = sampleSession._id;
sampleSession.pointOfServiceID = pointOfServiceID;

let payCartResult;

describe('Finalize-checkout-session', () => {
    before(async () => {
        const collection = await getMongodbCollection('Orders');
        await collection.insertOne(sampleSession);
        await request.post(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products`, {
            json: true,
            body: sampleProduct,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
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
        
        payCartResult = await request.post(helpers.API_URL + '/api/v1/pay-cart', {
            body: {
                pointOfServiceID: pointOfServiceID,
                pspType: 'creditcard',
                paymentStatus: 'approved',
                paymentTransactionResponse: {
                    merchant_order_id: sessionID
                }
            },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
    });

    it('should throw error on incorrect pointOfServiceID field', async () => {
        try {
            await request.patch(helpers.API_URL + '/api/v1/finalize-checkout-session/123', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The checkoutSessionID specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('Should return error when not fullfil hips api.', async () => {
       
        try {
            await request.patch(helpers.API_URL + `/api/v1/finalize-checkout-session/${payCartResult.checkoutSessionID}`, {
                json: true,
                body: { sessionID: payCartResult.sessionID },
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The paymentProviderAccountsNotFoundError id specified in the URL doesn\'t exist Or does not have settings section.',
                reasonPhrase: 'PaymentProviderAccountsNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
      
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
        
        const walletCollection = await getMongodbCollection('Orders');
        await walletCollection.deleteOne({ _id: sampleSession._id, docType: 'session', partitionKey: sampleSession._id });
    });
});