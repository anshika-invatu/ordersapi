'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');



module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');
        
        const result = await collection.find({
            $or: [{ 'docType': 'posSessions' }, { 'docType': 'posSessionsOld' }],
            _id: req.params.id
        },
        { projection: { 'docType': 0, partitionKey: 0, pointOfServiceID: 0, startingFunction: 0,
            customerID: 0, 'salesChannel.salesChannelID': 0, productID: 0, ttl: 0, paymentProviderAccountID: 0,
            paymentProviderAccountName: 0, customerInfo: 0 }})
            .toArray();

        if (result && Array.isArray(result) && result.length) {
            context.res = {
                body: result[0]
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
