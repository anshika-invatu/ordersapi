'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const Promise = require('bluebird');


//Please refer the story BASE-528 for more details

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The _id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');
        let retailTransactions;
        if (req.query.posSessionID) {
            retailTransactions = await collection.find({
                $or: [{ docType: 'retailTransaction' }, { docType: 'retailTransactionPending' }],
                merchantID: req.params.id,
                posSessionID: req.query.posSessionID
            })
                .sort({ createdDate: -1 })
                .toArray();
        } else {
            retailTransactions = await collection.find({
                merchantID: req.params.id,
                $or: [{ docType: 'retailTransaction' }, { docType: 'retailTransactionPending' }]
            }).limit(100)
                .sort({ createdDate: -1 })
                .toArray();
        }
        
        if (retailTransactions && Array.isArray(retailTransactions)) {
            for (let i = 0; i < retailTransactions.length; i++) {
                const element = retailTransactions[i];
                delete element.checkoutSessionDoc;
            }
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
