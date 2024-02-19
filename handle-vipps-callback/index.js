'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const utils = require('../utils');
const errors = require('../errors');
const { Promise } = require('bluebird');

module.exports = async (context, req) => {
    try {
        
        const collection = await getMongodbCollection('Orders');
        const checkoutSession = await collection.findOne({
            _id: req.body.checkoutSessionID,
            docType: 'checkoutSession'
        });
        if (!checkoutSession) {
            utils.setContextResError(
                context,
                new errors.CheckoutSessionNotFoundError(
                    'The checkout session id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/vipps-status?paymentProviderAccountID=${checkoutSession.paymentProviderAccountID}`, {
            json: true,
            body: {
                orderID: checkoutSession.orderID,
                paymentRequestID: checkoutSession.paymentRequestID
            },
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
       
        context.log(result);
        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_VIPPS, result);
        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};
