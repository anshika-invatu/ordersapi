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
                'You\'ve requested to cancel a posSession but the request body seems to be empty. Kindly send input parameters',
                400
            )
        );
        return Promise.resolve();
    }
    try {
        await utils.validateUUIDField(context, `${req.body.posSessionID}`, 'The posSessionID field specified in the url does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.updateOne({
            _id: req.body.posSessionID,
            docType: 'posSessions',
            partitionKey: req.body.posSessionID
        },
        {
            $set: {
                docType: 'posSessionOld',
                updatedDate: new Date()
            }
        });
        if (result && result.matchedCount) {
            context.res = {
                body: {
                    code: 200,
                    description: 'Successfully cancel the posSession.'
                }
            };
        } else {
            utils.setContextResError(
                context,
                new errors.POSSessionNotFoundError(
                    'The pos session detail specified doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};

