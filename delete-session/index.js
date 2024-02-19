'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = (context, req) => {
    return utils
        .validateUUIDField(context, req.params.id, 'The session id specified in the URL does not match the UUID v4 format.')
        .then(() => getMongodbCollection('Orders'))
        .then(collection => collection.deleteOne({
            _id: req.params.id,
            partitionKey: req.params.id,
            docType: 'session'
        }))
        .then(result => {
            if (result && result.deletedCount === 1) {
                context.res = {
                    body: {
                        description: 'Successfully deleted the specified session'
                    }
                };
            } else {
                utils.setContextResError(
                    context,
                    new errors.SessionNotFoundError(
                        'The session id specified in the URL doesn\'t exist.',
                        404
                    )
                );
            }
        })
        .catch(error => utils.handleError(context, error));
};
