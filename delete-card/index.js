'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');


module.exports = (context, req) => {

    let walletCollection;
    return utils.validateUUIDField(context, `${req.params.walletID}`, 'The walletID field specified in the url does not match the UUID v4 format.')
        .then(() => getMongodbCollection('Wallets'))
        .then(collection => {
            walletCollection = collection;
            return collection.findOne({
                _id: req.params.walletID,
                docType: 'wallets',
                partitionKey: req.params.walletID
            });
        })
        .then(wallet => {
            if (wallet) {
                return walletCollection.updateOne({
                    _id: req.params.walletID,
                    docType: 'wallets',
                    partitionKey: req.params.walletID
                },
                {
                    $set: Object.assign(
                        {},
                        { pspSource: '' },
                        {
                            updatedDate: new Date()
                        }
                    )
                });
            }
        })
        .then(result => {
            if (result && result.matchedCount) {
                context.res = {
                    body: {
                        code: 200,
                        description: 'Successfully deleted the stripe source token'
                    }
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
