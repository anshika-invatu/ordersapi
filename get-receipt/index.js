'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');


//Please refer the story BASE-180 for more details

module.exports = async (context, req) => {
    try {

        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'receipts'
        };
        if (req.query.receiptID) {
            await utils.validateUUIDField(context, req.query.receiptID, 'The receiptID specified in the request does not match the UUID v4 format.');
            query._id = req.query.receiptID;
            query.partitionKey = req.query.receiptID;
        }
        if (req.query.retailTransactionID) {
            await utils.validateUUIDField(context, req.query.retailTransactionID, 'The retailTransactionID specified in the request does not match the UUID v4 format.');
            query.retailTransactionID = req.query.retailTransactionID;
        }
        if (req.query.customerID) {
            await utils.validateUUIDField(context, req.query.customerID, 'The customerID specified in the request does not match the UUID v4 format.');
            query.customerID = req.query.customerID;
        }

        const receipts = await collection.find(query).toArray();

        if (receipts) {
            context.res = {
                body: receipts
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
