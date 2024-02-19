'use strict';

const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const request = require('request-promise');
const retailTransactionUtils = require('../utils/retail-transaction-pos');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to create a new zreport but the request body seems to be empty. Kindly pass the zreport to be created using request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }

        await utils.validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.');
        
        const oldZreport = await retailTransactionUtils.getOldZreport(req.body._id);
        
        if (oldZreport && oldZreport.isOpen !== false) {
            await retailTransactionUtils.updateOldZreportStatus(req.body, oldZreport.posEvents, req.body.isManual, oldZreport);
        }
        
        const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${req.body.merchantID}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        });

        const zreport = await retailTransactionUtils.createZreport(req.body, merchant, oldZreport);

        if (zreport) {
            context.res = {
                body: zreport.ops[0]
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
