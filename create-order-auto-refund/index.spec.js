'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const orderID = uuid.v4();

const orderAutoRefund = {};
orderAutoRefund._id = uuid.v4();
orderAutoRefund.docType = 'orderAutoRefund';
orderAutoRefund.partitionKey = orderID;
orderAutoRefund.orderID = orderID;
orderAutoRefund.autoRefundAfterDate = new Date();
orderAutoRefund.createdDate = new Date();
orderAutoRefund.updatedDate = new Date();

describe('Create order -auto-refund', () => {

    it('should return status code 400 when request body is null', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/order-auto-refund', {
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'You\'ve requested to create a new order-auto-refund but the request body seems to be empty. Kindly pass the order-auto-refund to be created using request body in application/json format',
                reasonPhrase: 'EmptyRequestBodyError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });
    it('should throw error on incorrect _id field', async () => {
        try {
            await request.post(helpers.API_URL + '/api/v1/order-auto-refund', {
                body: {
                    _id: '123'
                },
                json: true,
                headers: {
                    'x-functions-key': process.env.X_FUNCTIONS_KEY
                }
            });
        } catch (error) {
            const response = {
                code: 400,
                description: 'The _id specified in the request body does not match the UUID v4 format.',
                reasonPhrase: 'InvalidUUIDError'
            };

            expect(error.statusCode).to.equal(400);
            expect(error.error).to.eql(response);
        }
    });

    it('should create doc when all validation passes', async () => {

        const result = await request.post(helpers.API_URL + '/api/v1/order-auto-refund', {
            body: orderAutoRefund,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });

        expect(result).not.to.be.null;
        expect(result._id).to.equal(orderAutoRefund._id);
        expect(result.docType).to.equal('orderAutoRefund');

    });

    after(async () => {
        const collection = await getMongodbCollection('Orders');
        await collection.deleteOne({ _id: orderAutoRefund._id, partitionKey: orderAutoRefund.partitionKey, docType: 'orderAutoRefund' });
    });
});