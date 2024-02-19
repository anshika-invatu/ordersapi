'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, `${req.body.posSessionID}`, 'The posSessionID specified in the request does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const posSession = await collection.findOne({
            _id: req.body.posSessionID,
            partitionKey: req.body.posSessionID,
            docType: 'posSessionsOld'
        });
        if (!posSession) {
            utils.setContextResError(
                context,
                new errors.POSSessionNotFoundError(
                    'The pos session detail specified doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        let isRefundable = false;
        if (req.body.merchantID) {
            if (posSession && req.body.merchantID === posSession.merchantID) {
                isRefundable = true;
            }
        }
        if (!isRefundable) {
            utils.setContextResError(
                context,
                new errors.UserNotAuthenticatedError(
                    'This user not have authentication to refund pos session.',
                    401
                )
            );
            return Promise.resolve();
        }
        const result = await utils.createRefund(posSession, collection, context);

        context.log(result);
        if (result) {
            const updatedPosSession = await collection.updateOne({
                _id: req.body.posSessionID,
                partitionKey: req.body.posSessionID,
                docType: 'posSessionsOld'
            }, {
                $set: {
                    paymentStatusCode: 'refunded'
                }
            });
            context.log(updatedPosSession.matchedCount);

            const updatedRetailTransaction = await collection.updateOne({
                _id: posSession.retailTransactionID,
                partitionKey: posSession.retailTransactionID,
                $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
            }, {
                $set: {
                    retailTransactionStatusCode: 'canceled'
                }
            });
            context.log(updatedRetailTransaction.matchedCount);
            context.res = {
                body: {
                    description: 'Successfully refund pos-session.'
                }
            };
        }
    } catch (error) {
        context.log(error);
    }
};
