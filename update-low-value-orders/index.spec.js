'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');

describe('Update-low-value-orders', () => {
   
    it('should return status code 404 when request data is incorrect', async () => {
        try {
            await request.patch(`${helpers.API_URL}/api/v1/low-value-orders/${uuid.v4()}?partitionKey=${123}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: { isSent: false }
            });
        } catch (error) {
            const response = {
                code: 404,
                description: 'The low value order of specified details in the URL doesn\'t exist.',
                reasonPhrase: 'LowValueOrderNotFound'
            };

            expect(error.statusCode).to.equal(404);
            expect(error.error).to.eql(response);
        }
    });

   
});