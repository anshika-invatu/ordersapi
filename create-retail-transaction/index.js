'use strict';

const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const retailTransactionUtils = require('../utils/retail-transaction-pos');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to create a new retail-transaction but the request body seems to be empty. Kindly pass the checkoutSession to be created using request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }

        await utils.validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.');
        
        const retailTransaction = await retailTransactionUtils.createRetailTransActions(req.body);

        if (retailTransaction) {
            context.res = {
                body: retailTransaction.ops[0]
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
