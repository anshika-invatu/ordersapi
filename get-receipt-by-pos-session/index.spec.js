'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const sampleReceipts = require('../spec/sample-docs/Receipts');
const uuid = require('uuid');
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleReceipts._id = uuid.v4();
sampleReceipts.partitionKey = sampleReceipts._id;
sampleReceipts.retailTransactionID = uuid.v4();
const samplePOSSession = { ...require('../spec/sample-docs/POSSession'), _id: uuid.v4() };
samplePOSSession.partitionKey = samplePOSSession._id;
const sampleRetailTransaction = { ...require('../spec/sample-docs/RetailTransaction'), _id: uuid.v4() };
sampleRetailTransaction.partitionKey = sampleRetailTransaction._id;
samplePOSSession.retailTransactionID = sampleRetailTransaction._id;
sampleRetailTransaction.receiptID = sampleReceipts._id;

describe('Get Receipts', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(samplePOSSession);
    });

    it('should throw error on incorrect id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/receipt-by-session/123`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The posSessionID specified in the request does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });
    it('should throw error on incorrect pos session id field', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/receipt-by-session/${uuid.v4()}`, {
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
    it('should return empty array if the documentId is invalid', async () => {
        try {
            await request.get(`${helpers.API_URL}/api/v1/receipt-by-session/${samplePOSSession._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The RetailTransaction id specified in the URL doesn\'t exist.',
                reasonPhrase: 'RetailTransactionNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

    it('should return the document when all validation passes', async () => {
        const collection = await getMongodbCollection(collectionName);
        sampleRetailTransaction.receiptID = sampleReceipts._id;
        await collection.insertOne(sampleRetailTransaction);
        await collection.insertOne(sampleReceipts);
        const result = await request.get(`${helpers.API_URL}/api/v1/receipt-by-session/${samplePOSSession._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result._id).to.equal(sampleReceipts._id);
    });

   
    after(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.deleteOne({ _id: sampleReceipts._id, docType: 'receipts', partitionKey: sampleReceipts._id });
        await collection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
        await collection.deleteOne({ _id: samplePOSSession._id, docType: 'posSessions', partitionKey: samplePOSSession._id });
    });
});