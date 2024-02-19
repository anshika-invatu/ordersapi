'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleCheckoutSession = { ...require('../spec/sample-docs/CheckoutSession'), _id: uuid.v4() };
sampleCheckoutSession.partitionKey = sampleCheckoutSession._id;
sampleCheckoutSession.pointOfServiceID = uuid.v4();

describe('Create Retail Transaction', () => {

    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/retail-transaction-by-checkoutsession', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to create a new retail-transaction but the request body seems to be empty. Kindly pass the checkoutSession to be created using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });
    it('should throw error on incorrect _id field', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/retail-transaction-by-checkoutsession', {
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
                description: 'The pointOfServiceID specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should return error if cart not exist.', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/retail-transaction', {
                body: sampleCheckoutSession,
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The point-of-service of specified details in the URL doesn\'t exist.',
                reasonPhrase: 'PointOfServiceNotFoundError'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
        
    });

});