'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const moment = require('moment');
const errors = require('../errors');
const { Promise } = require('bluebird');

module.exports = async (context, req) => {
    try {
        
        const collection = await getMongodbCollection('Orders');
        const query = {
            merchantID: { $in: req.body.userMerchants },
            docType: 'zreport'
        };
        if (req.query.pointOfServiceID) {
            query.pointOfServiceID = req.query.pointOfServiceID;
            query.partitionKey = req.query.pointOfServiceID;
        }
        if (req.query.fromDate && req.query.toDate) {
            const toDate = moment(req.query.toDate).format('YYYY-MM-DD');
            const fromDate = moment(req.query.fromDate).format('YYYY-MM-DD');
            query.createdDate = {
                $gte: moment(fromDate).startOf('day')
                    .toDate(),
                $lte: moment(toDate).endOf('day')
                    .toDate()
            };
        } else {
            const toDate = moment().format('YYYY-MM-DD');
            const fromDate = moment().subtract(7,'d')
                .format('YYYY-MM-DD');
            query.createdDate = {
                $gte: moment(fromDate).startOf('day')
                    .toDate(),
                $lte: moment(toDate).endOf('day')
                    .toDate()
            };
        }
        const zreport = await collection.find(query)
            .limit(200)
            .toArray();
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
