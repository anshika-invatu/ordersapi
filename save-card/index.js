'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');

module.exports = (context, req) => {

    if (!req.body.sourcetoken) {
        utils.setContextResError(
            context,
            new errors.MissingStripeTokenError(
                'You\'ve requested to save source token but the request body is missing source token field. Kindly pass the source token using request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }

    let walletDoc, walletCollection;
    return utils.validateUUIDField(context, `${req.params.walletID}`, 'The walletID field specified in the url does not match the UUID v4 format.')
        .then(() => getMongodbCollection('Wallets'))
        .then(collection => {
            walletCollection = collection;
            return collection.findOne({
                _id: req.params.walletID,
                partitionKey: req.params.walletID,
                docType: 'wallets'
            });
        })
        .then(wallet => {
            if (wallet) {
                walletDoc = wallet;
                if (wallet.pspAccount) {
                    walletDoc.pspSource = req.body.sourcetoken;
                    walletDoc.pspName = 'Stripe';
                    return Promise.resolve(null);

                } else {
                    return utils.createStripeCustomer(wallet.email);
                }
            }
        })
        .then(customerDetails => {
            if (customerDetails) {
                walletDoc.pspAccount = customerDetails.id;
                walletDoc.pspSource = req.body.sourcetoken;
                walletDoc.pspName = 'Stripe';
            }
            return walletCollection.updateOne({
                _id: req.params.walletID,
                docType: 'wallets',
                partitionKey: req.params.walletID
            },
            {
                $set: Object.assign(
                    {},
                    walletDoc,
                    {
                        updatedDate: new Date()
                    }
                )
            });

        })
        .then(result => {
            if (result && result.matchedCount) {
                context.res = {
                    body: {
                        code: 200,
                        description: 'Successfully saved the stripe source token'
                    }
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
