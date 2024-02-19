'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const Promise = require('bluebird');


//Please refer the story BASE-35 for more details

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The _id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            _id: req.params.id,
            partitionKey: req.params.id
        };
        const retailTransactions = await collection.findOne(query);
        if (retailTransactions) {
            delete retailTransactions.checkoutSessionDoc;
            context.res = {
                body: retailTransactions
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
