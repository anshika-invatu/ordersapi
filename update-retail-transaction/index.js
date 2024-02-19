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
                'You\'ve requested to update an retail transaction but the request body seems to be empty. Kindly specify the retail transaction properties to be updated using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
    try {
        await utils.validateUUIDField(context, `${req.params.id}`, 'The id field specified in the url does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.updateOne({
            _id: req.params.id,
            docType: 'retailTransaction',
            partitionKey: req.params.id
        },
        {
            $set: Object.assign(
                {},
                req.body,
                {
                    updatedDate: new Date()
                }
            )
        });
        if (result && result.matchedCount) {
            context.res = {
                body: {
                    code: 200,
                    description: 'Successfully updated the retail transaction.'
                }
            };
        } else {
            utils.setContextResError(
                context,
                new errors.RetailTransactionNotFoundError(
                    'The RetailTransaction id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
