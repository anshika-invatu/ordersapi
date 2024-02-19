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
samplePointOfService.merchantID = MerchantID;
sampleZReport.docType = 'zreport';
sampleZReport.partitionKey = samplePointOfService._id;
sampleZReport.pointOfServiceID = samplePointOfService._id;
sampleZReport.createdDate = new Date();


describe('Update Zreport', () => {

    
    it('should throw error on incorrect _id field', async () => {
        try {
            await request.patch(helpers.API_URL + '/api/v1/zreport-status', {
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

    it('should update doc when all validation passes', async () => {
        const collection = await getMongodbCollection('Orders');
        await collection.insertOne(sampleZReport);
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

        const result = await request.patch(helpers.API_URL + '/api/v1/zreport-status', {
            body: samplePointOfService,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(result).not.to.be.null;
        expect(result.description).to.equal('Successfully updated the document');

        const zreport = await collection.findOne({ _id: sampleZReport._id, partitionKey: sampleZReport.partitionKey, docType: 'zreport' });
        expect(zreport).not.to.be.null;
        expect(zreport.pointOfServiceID).to.equal(samplePointOfService._id);
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