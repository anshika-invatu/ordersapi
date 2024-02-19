'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');

module.exports = (context, req) => {

    if (!req.body) {
        utils.setContextResError(
            context,
            new errors.EmptyRequestBodyError(
                'You\'ve requested to create a new order but the request body seems to be empty. Kindly pass the order to be created using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    return utils
        .validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.')
        .then(() => {
            return getMongodbCollection('Orders');
        })
        .then(collection => {
            if (collection) {
                const order = Object.assign(
                    {},
                    utils.formatDateFields(req.body),
                    {
                        partitionKey: req.body._id,
                        docType: 'order',
                        orderDate: new Date(req.body.orderDate),
                        createdDate: new Date(),
                        updatedDate: new Date()
                    }
                );
                return collection.insertOne(order);
            }
        })
        .then(response => {
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
        })
        .catch(error => utils.handleError(context, error));
};
