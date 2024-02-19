'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const moment = require('moment');



module.exports = async (context, req) => {
    try {

        const collection = await getMongodbCollection('Orders');
        const query = {
            docType: 'posSessions'
        };
        if (req.body.merchantID)
            query.merchantID = req.body.merchantID;
        if (req.body.reportDateRange === 'today') {
            let fromDate = moment();
            fromDate = fromDate.startOf('day')
                .toDate();
            let toDate = moment();
            toDate = toDate.endOf('day')
                .toDate();
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        } else if (req.body.reportDateRange === 'yesterday') {
            let fromDate = moment().subtract(1, 'days');
            fromDate = fromDate.startOf('day')
                .toDate();
            let toDate = moment().subtract(1, 'days');
            toDate = toDate.endOf('day')
                .toDate();
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        } else if (req.body.reportDateRange === 'thisWeek') {
            const currentDate = moment();
            const fromDate = currentDate.clone().startOf('week')
                .toDate();
            const toDate = currentDate.clone().endOf('week')
                .toDate();
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        } else if (req.body.reportDateRange === 'lastWeek') {
            const currentDate = moment().subtract(1, 'weeks');
            const fromDate = currentDate.clone().startOf('week')
                .toDate();
            const toDate = currentDate.clone().endOf('week')
                .toDate();
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        } else if (req.body.reportDateRange === 'thisMonth') {
            const currentDate = moment();
            const fromDate = currentDate.clone().startOf('months')
                .toDate();
            const toDate = currentDate.clone().endOf('months')
                .toDate();
            query.createdDate = {
                $gte: fromDate,
                $lte: toDate
            };
        } else if (req.body.reportDateRange === 'lastMonth') {
            const currentDate = moment().subtract(1, 'months');
            const fromDate = currentDate.clone().startOf('months')
                .toDate();
            const toDate = currentDate.clone().endOf('months')
                .toDate();
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        }
        const result = await collection.find(query).toArray();

        if (result) {
            context.res = {
                body: result
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
