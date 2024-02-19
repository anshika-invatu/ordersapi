'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleZReport = { ...require('../spec/sample-docs/ZReport'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleZReport.pointOfServiceID = uuid.v4();
sampleZReport.partitionKey = sampleZReport.pointOfServiceID;

describe('Get Zreport', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleZReport);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/zreport/123-abc`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The zreport id specified in the URL does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/zreport/${uuid.v4()}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The zreport id specified in the URL doesn\'t exist.',
                reasonPhrase: 'ZReportNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should get the document when all validation passes', async () => {
        const result = await request
            .get(`${helpers.API_URL}/api/v1/zreport/${sampleZReport._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(result).not.to.be.null;
        expect(result._id).to.eql(sampleZReport._id);

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleZReport._id, docType: 'zreport', partitionKey: sampleZReport.pointOfServiceID });

    });
});