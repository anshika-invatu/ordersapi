'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const Promise = require('bluebird');


//Please refer the story BASE-447 for more details

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The merchantID specified in the request does not match the UUID v4 format.');
        
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            merchantID: req.params.id
        };
        
        const retailTransactions = await collection.find(query)
            .toArray();

        if (retailTransactions) {
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
