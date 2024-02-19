'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');

module.exports = async (context, req) => {
    try {
        const collection = await getMongodbCollection('Orders');
        const checkoutSession = await collection.findOne({
            $or: [{ 'docType': 'checkoutSession' }, { 'docType': 'checkoutSessionCompleted' }],
            'paymentTransactionResponse.requesterTransRefNum': req.params.requesterTransRefNum
        });
        if (checkoutSession) {
            const result = await collection.updateOne({
                _id: checkoutSession._id,
                partitionKey: checkoutSession.partitionKey,
                $or: [{ 'docType': 'checkoutSession' }, { 'docType': 'checkoutSessionCompleted' }],
            }, {
                $set: {
                    'paymentTransactionResponse.bankAuthCode': req.body.newbankAuthCode
                }
            });
            if (result && result.matchedCount) {
                context.res = {
                    body: {
                        description: 'Successfully updated the document'
                    }
                };
            }
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
