'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');

module.exports = async (context, req) => {
    try {
        const collection = await getMongodbCollection('Orders');
        const checkoutSession = await collection.findOne({
            paymentProviderReference: req.params.payeePaymentReference,
            docType: 'checkoutSession'
        });
        if (checkoutSession) {
            context.res = {
                body: checkoutSession
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
