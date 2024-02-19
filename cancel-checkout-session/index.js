'use strict';

const utils = require('../utils');
const Swish = require('../utils/swish-payment');
const Promise = require('bluebird');
const errors = require('../errors');
const request = require('request-promise');
const { CustomLogs } = utils;
const { getMongodbCollection } = require('../db/mongodb');

module.exports = async function (context, req) {
    
    try {
        const isTesting = process.env.IS_TESTING;
        CustomLogs(req.body, context);
        const collection = await getMongodbCollection('Orders');
        const checkoutSession = await collection.findOne({
            _id: req.params.id,
            partitionKey: req.params.id,
            docType: 'checkoutSession'
        });
        let result;
        if (checkoutSession.pspType && checkoutSession.pspType.toLowerCase() === 'swish') {
            req.instructionUUID = checkoutSession.paymentProviderReference;
            const swishPayment = await Swish.swishPayment(req, context, isTesting, checkoutSession.paymentID);
            context.log(swishPayment);
            let paymentResult;
            if (result && result.location)
                paymentResult = 'approved';
            else
                paymentResult = 'denied';
            await utils.createPaymentLogs(checkoutSession, swishPayment, 'refund','', paymentResult);
            if (swishPayment) {
                result = swishPayment;
            } else {
                utils.setContextResError(
                    context,
                    new errors.SwishPaymentNotFoundError(
                        'The swish id specified in the URL can not be cancel.',
                        404
                    )
                );
                return Promise.resolve();
            }
        } else if (checkoutSession.pspType && checkoutSession.pspType.toLowerCase() === 'bluecode') {
            const reqBody = {};
            if (checkoutSession.payment) {
                reqBody.merchant_tx_id = checkoutSession.payment.merchant_tx_id;
                reqBody.paymentProviderAccountID = checkoutSession.paymentProviderAccountID;
            }
            result = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/bluecode-cancel`, {
                json: true,
                body: reqBody,
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
        }
        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};