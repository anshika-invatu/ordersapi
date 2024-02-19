'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const moment = require('moment');
const Promise = require('bluebird');


//Please refer the story BASE-120 for more details

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The customerID specified in the request does not match the UUID v4 format.');
        
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            customerID: req.params.id
        };
        if (req.query.fromDate && req.query.toDate) {
            query.createdDate = {
                $gte: moment(req.query.fromDate).startOf('day')
                    .toDate(),
                $lte: new Date(req.query.toDate)
            };
        }
        const retailTransactions = await collection.find(query)
            .sort({ retailTransactionDate: -1 })
            .limit(500)
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
