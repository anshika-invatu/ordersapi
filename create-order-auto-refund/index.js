'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');

//Please refer the story bac-444 for more details

module.exports = async (context, req) => {

    if (!req.body) {
        utils.setContextResError(
            context,
            new errors.EmptyRequestBodyError(
                'You\'ve requested to create a new order-auto-refund but the request body seems to be empty. Kindly pass the order-auto-refund to be created using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
    try {
        await utils.validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');

        const orderAutoRefund = Object.assign(
            {},
            utils.formatDateFields(req.body),
            {
                partitionKey: req.body.orderID,
                docType: 'orderAutoRefund',
                autoRefundAfterDate: new Date(req.body.autoRefundAfterDate),
                createdDate: new Date(),
                updatedDate: new Date()
            }
        );

        const response = await collection.insertOne(orderAutoRefund);

        if (response) {
            try {
                const order = response.ops[0];
                context.res = {
                    body: order
                };
            } catch (err) {
                console.log(err);
            }
        }
    } catch (error) {
        error => utils.handleError(context, error);
    }
};
