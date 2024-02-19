'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');

module.exports = async (context, req) => {
    if (!req.body) {
        utils.setContextResError(
            context,
            new errors.EmptyRequestBodyError(
                'You\'ve requested to update an pos-session but the request body seems to be empty. Kindly specify the session properties to be updated using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
    try {
        await utils.validateUUIDField(context, req.params.id, 'The pos-session id specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.updateOne({
            _id: req.params.id,
            partitionKey: req.params.id,
            docType: 'posSessions'
        }, {
            $push: {
                statusRecords: req.body
            },
        });
        if (result.matchedCount) {
            context.res = {
                body: {
                    description: 'Successfully updated the document'
                }
            };
        } else {
            utils.setContextResError(
                context,
                new errors.PosSessionNotFoundError(
                    'The pos-session id specified in the URL doesn\'t exist.',
                    404
                )
            );
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
