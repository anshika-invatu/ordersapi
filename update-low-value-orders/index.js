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
                'You\'ve requested to update an low value order doc but the request body seems to be empty. Kindly specify the low order doc properties to be updated using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    return utils
        .validateUUIDField(context, req.params.id)
        .then(() => getMongodbCollection('Orders'))
        .then(collection => {
            if (req.body._ts) {
                req.body._ts = new Date(req.body._ts);
            }
            return collection.updateOne({
                _id: req.params.id,
                partitionKey: req.query.partitionKey,
                docType: 'lowValueOrder'
            }, {
                $set: Object.assign(
                    {},
                    req.body,
                    {
                        sentDate: new Date(req.body.sentDate),
                        updatedDate: new Date()
                    }
                )
            });
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
                        new errors.LowValueOrderNotFound(
                            'The low value order of specified details in the URL doesn\'t exist.',
                            404
                        )
                    );
                }
            }
        })
        .catch(error => utils.handleError(context, error));
};
