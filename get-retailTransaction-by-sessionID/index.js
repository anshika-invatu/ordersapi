'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The retailTransaction sessionID specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.findOne({
            sessionID: req.params.id,
            docType: 'retailTransaction'
        });
        if (result) {
            context.res = {
                body: result
            };
        } else {
            utils.setContextResError(
                context,
                new errors.RetailTransactionNotFoundError(
                    'The retailTransaction with the specified sessionID doesn\'t exist.',
                    404
                )
            );
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
