'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleWallet = { ...require('../spec/sample-docs/Wallets'), _id: uuid.v4() };
const { getMongodbCollection } = require('../db/mongodb');
const collectionName = 'Wallets';

describe('Save source token', () => {
    before(async () => {
        sampleWallet.partitionKey = sampleWallet._id;
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleWallet);

    });



    it('should return status code 400 when source token is missing', async () => {
        try {
            await request.post(helpers.API_URL + `/api/v1/card/${sampleWallet._id}`, {
                body: {},
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to save source token but the request body is missing source token field. Kindly pass the source token using request body in application/json format',
                reasonPhrase: 'MissingStripeTokenError'
            };
            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return error on invalid uuid', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/card/123-abc', {
                body: {
                    'sourcetoken': 'tok_visa_update'
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The walletID field specified in the url does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };
            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should save the stripe token in wallet', async () => {

        const result = await request.post(helpers.API_URL + `/api/v1/card/${sampleWallet._id}`, {
            json: true,
            body: {
                'sourcetoken': 'tok_visa'
            },
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });


        expect(result.code).to.equal(200);
        expect(result).to.eql({
            code: 200,
            description: 'Successfully saved the stripe source token'
        });

    });


    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleWallet._id, docType: 'wallets', partitionKey: sampleWallet._id });
 
    });

});