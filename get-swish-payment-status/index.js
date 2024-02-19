'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const Promise = require('bluebird');



module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The posSessionId specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const query = {
            _id: req.params.id
        };
        const result = await collection.findOne(query);
        if (result) {
            if (result.swishCallBackResult && result.swishCallBackResult.status) {
                context.res = {
                    body: { paymentStatus: result.swishCallBackResult.status }
                };
            } else if (result.paymentStatusCode) {
                context.res = {
                    body: { paymentStatus: result.paymentStatusCode }
                };
            } else {
                utils.setContextResError(
                    context,
                    new errors.PaymentStatusNotFoundError(
                        'The pos session does not have payment status.',
                        404
                    )
                );
                return Promise.resolve();
            }
        } else {
            utils.setContextResError(
                context,
                new errors.PosSessionNotFoundError(
                    'The pos session id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
