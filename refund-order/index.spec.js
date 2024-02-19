'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleOrder = { ...require('../spec/sample-docs/Orders'), _id: uuid.v4() ,transactionID: uuid.v4() };
describe('Refund-order', () => {
    before(async () => {
        await request.post(helpers.API_URL + '/api/v1/orders-doc', {
            body: sampleOrder,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
    });

    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/refund-order', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to refund order but the request body seems to be empty. Kindly pass request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should throw error on incorrect _id field', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/refund-order', {
                body: {
                    orderID: 123,
                    reasonForRefund: 'abc'
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The orderID field specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('Should return error if transaction doc not exist', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/refund-order', {
                body: {
                    orderID: sampleOrder._id,
                    reasonForRefund: 'duplicate'
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The transaction id specified in the URL doesn\'t exist.',
                reasonPhrase: 'TransactionNotFoundError'
            };
            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }

    });
    after(async () => {
        await request.delete(helpers.API_URL + '/api/v1/orders/' + sampleOrder._id, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
    });
});