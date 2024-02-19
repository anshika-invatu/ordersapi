'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');


describe('Get low value orders', () => {
    
    it('should return the document when all validation passes', async () => {
        const lowValueOrders = await request
            .get(`${helpers.API_URL}/api/v1/low-value-orders`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });

        expect(lowValueOrders).not.to.be.null;
        expect(lowValueOrders).to.be.instanceOf(Array);
    });

    
});