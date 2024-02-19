'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const sampleRetailTransaction = { ...require('../spec/sample-docs/RetailTransaction'), _id: uuid.v4() };
const collectionName = 'Orders';

describe('Update retail transaction', () => {
    before(async () => {
        sampleRetailTransaction.partitionKey = sampleRetailTransaction._id;
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleRetailTransaction);

    });
    it('should return status code 400 when request body is null', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/retail-transaction/${sampleRetailTransaction._id}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to update an retail transaction but the request body seems to be empty. Kindly specify the retail transaction properties to be updated using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect _id field', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/retail-transaction/123`, {
                json: true,
                body: {},
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The id field specified in the url does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw 404 error if the documentId is invalid', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/retail-transaction/${uuid.v4()}`, {
                body: { isRedeemed: true },
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

    it('should update document when all validation passes', async () => {
        const result = await request.patch(`${helpers.API_URL}/api/v1/retail-transaction/${sampleRetailTransaction._id}`, {
            body: { retailTransactionStatusCode: 'Refunded' },
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result.description).to.eql('Successfully updated the retail transaction.');

        // Get sample document
        const retailTransaction = await request.get(`${helpers.API_URL}/api/v1/retail-transaction/${sampleRetailTransaction._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(retailTransaction).not.to.be.null;
        expect(retailTransaction.retailTransactionStatusCode).to.equal('Refunded');
        expect(retailTransaction.createdDate).not.to.be.null;
        expect(retailTransaction.updatedDate).not.to.be.null;
    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleRetailTransaction._id, docType: 'retailTransaction', partitionKey: sampleRetailTransaction._id });
 
    });
});