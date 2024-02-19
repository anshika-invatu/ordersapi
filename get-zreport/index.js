'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const { Promise } = require('bluebird');

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The zreport id specified in the URL does not match the UUID v4 format.');
        const collection = await getMongodbCollection('Orders');
        const zreport = await collection.findOne({
            _id: req.params.id,
            docType: 'zreport'
        });
        if (zreport) {
            context.res = {
                body: zreport
            };
        } else {
            utils.setContextResError(
                context,
                new errors.ZReportNotFoundError(
                    'The zreport id specified in the URL doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
