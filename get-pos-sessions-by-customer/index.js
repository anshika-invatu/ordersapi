'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');



module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The cutomer id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');
        
        const result = await collection.findOne({
            docType: 'posSessions',
            customerID: req.params.id
        });

        if (result) {
            context.res = {
                body: result
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
