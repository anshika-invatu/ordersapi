'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');


//Please refer the story BASE-642 for more details

module.exports = async (context, req) => {
    try {

        await utils.validateUUIDField(context, req.params.posSessionID, 'The posSessionID specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const  posSession = await collection.findOne({ _id: req.params.posSessionID, partitionKey: req.params.posSessionID });
        
        if (!posSession) {
            await utils.setContextResError(
                context,
                new errors.POSSessionNotFoundError(
                    'The pos session detail specified doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        if (!posSession.retailTransactionID) {
            await utils.setContextResError(
                context,
                new errors.PaymentReceiptError(
                    'Payment receipt is not yet available for this session',
                    403
                )
            );
            return Promise.resolve();
        }

        const retailTransaction = await collection.findOne({ _id: posSession.retailTransactionID, partitionKey: posSession.retailTransactionID });

        if (!retailTransaction) {
            utils.setContextResError(
                context,
                new errors.RetailTransactionNotFoundError(
                    'The RetailTransaction id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        if (!retailTransaction.receiptID) {
            utils.setContextResError(
                context,
                new errors.PaymentReceiptError(
                    'Payment receipt is not yet available for this session',
                    403
                )
            );
            return Promise.resolve();
        }
        const receipt = await collection.findOne({ _id: retailTransaction.receiptID, partitionKey: retailTransaction.receiptID, docType: 'receipts' });
        if (!receipt) {
            utils.setContextResError(
                context,
                new errors.ReceiptNotFoundError(
                    'The receipt id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        if (receipt) {
            context.res = {
                body: receipt
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
