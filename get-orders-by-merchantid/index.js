'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');
const moment = require('moment');

//Please refer the story bac-280 for more details

module.exports = (context, req) => {

    return utils
        .validateUUIDField(context, req.params.id)
        .then(() => getMongodbCollection('Orders'))
        .then(collection => {
            const query = [];
            if (req.query.webShopID) {
                query.push({ webShopID: req.query.webShopID });
            }
            query.push({ sellerMerchantID: req.params.id });

            if (req.query.fromDate && req.query.toDate) {
                return collection.find({
                    $and: query,
                    docType: 'order',
                    orderDate: {
                        $gte: moment(req.query.fromDate).startOf('day')
                            .toDate(),
                        $lte: new Date(req.query.toDate)
                    }
                })
                    .limit(50)
                    .toArray();
            } else {
                if (query.length === 1) { // if it have only merchantID in query
                    return collection.find({
                        $and: query,
                        docType: 'order',
                    }).sort({ orderDate: -1 })
                        .limit(50)
                        .toArray();
                } else {
                    return collection.find({
                        $and: query,
                        docType: 'order',
                    }).toArray();
                }
            }
        })
        .then(orders => {
            if (orders) {
                context.res = {
                    body: orders
                };
            } else {
                utils.setContextResError(
                    context,
                    new errors.OrderNotFoundError(
                        'The order of specified details not exist',
                        404
                    )
                );
            }
        })
        .catch(error => utils.handleError(context, error));
};
