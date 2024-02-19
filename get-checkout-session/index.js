'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The checkout-session id specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.findOne({
            partitionKey: req.params.id,
            _id: req.params.id,
            docType: 'checkoutSession'
        });
        if (result) {
            context.res = {
                body: result
            };
        } else {
            utils.setContextResError(
                context,
                new errors.CheckoutSessionNotFoundError(
                    'The checkout session id specified in the URL doesn\'t exist.',
                    404
                )
            );
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
