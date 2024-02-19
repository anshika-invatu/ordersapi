'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const moment = require('moment');

module.exports = (context) => {
    const todaysDate = moment().format('YYYY-MM-DD');
    const lowValueOrderPartitionKey = `LOWVALUEORDER-${todaysDate}`;
    return getMongodbCollection('Orders')
        .then(collection => {
            return collection.find({
                partitionKey: lowValueOrderPartitionKey,
                isSent: false,
                docType: 'lowValueOrder'
            }).limit(20)
                .toArray();
        })
        .then(lowValueOrder => {
            if (lowValueOrder) {
                context.res = {
                    body: lowValueOrder
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
