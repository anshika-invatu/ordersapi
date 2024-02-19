'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = (context, req) => {
    return utils
        .validateUUIDField(context, req.params.id)
        .then(() => getMongodbCollection('Orders'))
        .then(collection => collection.deleteOne({
            _id: req.params.id,
            partitionKey: req.params.id,//bac-181 related to partitionKey
            docType: 'order'
        }))
        .then(result => {
            if (result && result.deletedCount === 1) {
                context.res = {
                    body: {
                        description: 'Successfully deleted the specified order'
                    }
                };
            } else {
                utils.setContextResError(
                    context,
                    new errors.OrderNotFoundError(
                        'The order id specified in the URL doesn\'t exist.',
                        404
                    )
                );
            }
        })
        .catch(error => utils.handleError(context, error));
};
