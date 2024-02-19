'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The session id specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const session = await collection.findOne({
            pointOfServiceID: req.params.id,
            docType: 'session'
        });
        if (session) {
            context.res = {
                body: session
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
    } catch (error) {
        utils.handleError(context, error);
    }
};
