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
                'You\'ve requested to create a new session but the request body seems to be empty. Kindly pass the session to be created using request body in application/json format',
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
                if (req.body.sessionStartDate)
                    req.body.sessionStartDate = new Date(req.body.sessionStartDate);
                if (req.body.sessionExpiryDate)
                    req.body.sessionExpiryDate = new Date(req.body.sessionExpiryDate);
                if (req.body.orderDate)
                    req.body.orderDate = new Date(req.body.orderDate);
                const session = Object.assign(
                    {},
                    utils.formatDateFields(req.body),
                    {
                        partitionKey: req.body._id,
                        docType: 'session',
                        createdDate: new Date(),
                        updatedDate: new Date(),
                        _ts: new Date(),
                        ttl: 60 * 60 * 12 //12 hours
                    }
                );
                return collection.insertOne(session);
            }
        })
        .then(response => {
            if (response) {
                try {
                    const session = response.ops[0];
                    context.res = {
                        body: session
                    };
                } catch (err) {
                    console.log(err);
                }
            }
        })
        .catch(error => utils.handleError(context, error));
};
