'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The checkoutSession sessionID specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const result = await collection.findOne({
            sessionID: req.params.id,
            $or: [{ 'docType': 'checkoutSessionCompleted' }, { 'docType': 'checkoutSession' }]
        });
        if (result) {
            context.res = {
                body: result
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
