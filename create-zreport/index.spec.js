'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const MerchantID = uuid.v4();
const { getMongodbCollection } = require('../db/mongodb');
const sampleZReport = { ...require('../spec/sample-docs/ZReport'), _id: uuid.v4() };
const samplePointOfService = { ...require('../spec/sample-docs/PointOfService'), _id: uuid.v4() };
const sampleMerchants = { ...require('../spec/sample-docs/Merchants'), _id: MerchantID };
sampleZReport.partitionKey = sampleZReport._id;
samplePointOfService.merchantID = MerchantID;
sampleZReport.docType = 'zreport';


describe('Create Zreport', () => {

    
    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/zreport', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to create a new zreport but the request body seems to be empty. Kindly pass the zreport to be created using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });
    it('should throw error on incorrect _id field', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/zreport', {
                body: {
                    _id: 123
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The _id specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should create doc when all validation passes', async () => {

        await request.post(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            body: sampleMerchants
        });
        const url = `${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-services`;
        await request.post(url, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            },
            body: samplePointOfService
        });

        const result = await request.post(helpers.API_URL + '/api/v1/zreport', {
            body: samplePointOfService,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(result).not.to.be.null;
        expect(result.pointOfServiceID).to.equal(samplePointOfService._id);
        expect(result.docType).to.equal('zreport');

    });

    after(async () => {
        const collection = await getMongodbCollection('Orders');
        await collection.deleteOne({ _id: sampleZReport._id, partitionKey: sampleZReport.partitionKey, docType: 'zreport' });
       
        await request.delete(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${sampleMerchants._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        await request.delete(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/merchants/${samplePointOfService.merchantID}/point-of-services?pointOfServiceID=${samplePointOfService._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
    });
});