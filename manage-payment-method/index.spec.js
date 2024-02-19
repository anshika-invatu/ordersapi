'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const sampleWallets = { ...require('../spec/sample-docs/Wallets'), _id: uuid.v4() };
const crypto = require('crypto');
const randomString = crypto.randomBytes(3).toString('hex');
const randomString2 = crypto.randomBytes(3).toString('hex');
sampleWallets.vourityID = randomString;
sampleWallets.mobilePhone = randomString2;
sampleWallets.pspName = 'Stripe';
sampleWallets.stripeToken = '123';

describe('Manage Payments', () => {
    before(async () => {
        await request.post(`${process.env.WALLET_API_URL}/api/${process.env.WALLET_API_VERSION}/wallets`, {
            json: true,
            headers: {
                'x-functions-key': process.env.WALLET_API_KEY
            },
            body: sampleWallets
        });
    });

    it('should return error with invalied token.', async () => {
        try {
            await request.post(`${helpers.API_URL}/api/v1/manage-payment`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                },
                body: sampleWallets
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'No such token: \'123\'',
                reasonPhrase: 'StripeInvalidRequestError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }

    });

    after(async () => {
        await request.delete(`${process.env.WALLET_API_URL}/api/${process.env.WALLET_API_VERSION}/wallets/${sampleWallets._id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.WALLET_API_KEY
            }
        });
    });
});