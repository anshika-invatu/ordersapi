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
                'You\'ve requested to update an order but the request body seems to be empty. Kindly specify the order properties to be updated using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    return utils
        .validateUUIDField(context, req.params.id)
        .then(() => getMongodbCollection('Orders'))
        .then(collection => {
            if (Object.keys(req.body).length) {
                return collection.updateOne({
                    _id: req.params.id,
                    partitionKey: req.params.id,//bac-181 related to partitionKey
                    docType: 'order'
                }, {
                    $set: Object.assign(
                        {},
                        req.body,
                        {
                            updatedDate: new Date()
                        }
                    )
                });
            } else {
                return Promise.resolve();
            }
        })
        .then(result => {
            if (result) {
                if (result.matchedCount) {
                    context.res = {
                        body: {
                            description: 'Successfully updated the document'
                        }
                    };
                } else {
                    utils.setContextResError(
                        context,
                        new errors.OrderNotFoundError(
                            'The order id specified in the URL doesn\'t exist.',
                            404
                        )
                    );
                }
            } else {
                utils.setContextResError(
                    context,
                    new errors.EmptyRequestBodyError(
                        'You\'ve requested to update an order but the request body seems to be empty. Kindly specify the order properties to be updated using request body in application/json format',
                        400
                    )
                );
            }
        })
        .catch(error => utils.handleError(context, error));
};
