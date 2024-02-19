'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
samplePOSSession.partitionKey = samplePOSSession._id;
samplePOSSession.merchantID = uuid.v4();
samplePOSSession.sessionStartDate = new Date('2019-02-21');

describe('get-pos-sessions-by-merchant', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/merchants/123/pos-sessions`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The merchantID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/merchants/${samplePOSSession.merchantID}/pos-sessions`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(samplePOSSession._id);
    });

    it('should return the document when all validation passes(with all params)', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/merchants/${samplePOSSession.merchantID}/pos-sessions`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                sessionStateCode: samplePOSSession.sessionStateCode,
                customerID: samplePOSSession.customerID,
                pointOfServiceID: samplePOSSession.pointOfServiceID,
                componentID: samplePOSSession.componentID,
                paymentStatusCode: samplePOSSession.paymentStatusCode,
                fromDate: '2019-02-20',
                toDate: '2019-02-22'
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(samplePOSSession._id);
    });

    it('should return the document when all validation passes(with all params)', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/merchants/${samplePOSSession.merchantID}/pos-sessions`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                sessionStateCode: samplePOSSession.sessionStateCode,
                customerID: samplePOSSession.customerID,
                isActive: true,
                pointOfServiceID: samplePOSSession.pointOfServiceID,
                componentID: samplePOSSession.componentID,
                paymentStatusCode: samplePOSSession.paymentStatusCode,
                fromDate: '2019-02-20',
                toDate: '2019-02-22'
            }
        });

        expect(result).not.to.be.null;
        expect(result[0]._id).to.equal(samplePOSSession._id);
    });

    it('should return the document when all validation passes(with all params)', async () => {
        const result = await request.post(`${helpers.API_URL}/api/v1/merchants/${samplePOSSession.merchantID}/pos-sessions`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: {
                sessionStateCode: samplePOSSession.sessionStateCode,
                customerID: samplePOSSession.customerID,
                isActive: false,
                pointOfServiceID: samplePOSSession.pointOfServiceID,
                componentID: samplePOSSession.componentID,
                paymentStatusCode: samplePOSSession.paymentStatusCode,
                fromDate: '2019-02-20',
                toDate: '2019-02-22'
            }
        });
        console.log(result);

        expect(result).not.to.be.null;
        expect(result[0]).to.eql(undefined);
    });

    


    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});