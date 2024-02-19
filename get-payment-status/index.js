'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const Promise = require('bluebird');



module.exports = async (context, req) => {
    try {
        console.log('request',req);
        //await utils.validateUUIDField(context, req.params.id, 'The _id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');
        //console.log('collection',collection);

        const query = {
            _id: req.params.id
        };
        const result = await collection.findOne(query);
        if (result) {
            console.log('results',result);
            if (result.transactionStatus) {
                context.res = {
                    body: { paymentStatus: result.transactionStatus }
                };
            } else {
                utils.setContextResError(
                    context,
                    new errors.PaymentStatusNotFoundError(
                        'The checkout session does not have payment status.',
                        404
                    )
                );
                return Promise.resolve();
            }
        } else {
            utils.setContextResError(
                context,
                new errors.CheckOutSessionNotFoundError(
                    'The checkout session id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
