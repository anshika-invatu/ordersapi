'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const { getMongodbCollection } = require('../db/mongodb');
const uuid = require('uuid');
const sampleWallet = { ...require('../spec/sample-docs/Wallets'), _id: uuid.v4() };
const collectionName = 'Wallets';
sampleWallet.partitionKey = sampleWallet._id;

describe('Delete card', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleWallet);
    });
    
    it('should return error on invalid uuid ', async () => {
        try {
            await request.delete(helpers.API_URL + `/api/v1/card/${sampleWallet._id}`, {
                body: {},
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

    it('should delete the stripe token from wallet', async () => {

        const result = await request.delete(helpers.API_URL + `/api/v1/card/${sampleWallet._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });


        expect(result.code).to.equal(200);
        expect(result).to.eql({
            code: 200,
            description: 'Successfully deleted the stripe source token'
        });

    });


    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleWallet._id, docType: 'wallets', partitionKey: sampleWallet._id });
 
    });

});