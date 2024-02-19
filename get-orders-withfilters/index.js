'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const request = require('request-promise');

//Please refer the story bac-386 for more details

module.exports = async (context, req) => {
    let orderCollection;
    return utils
        .validateUUIDField(context, req.body.merchantID, 'The merchantID specified in the request body does not match the UUID v4 format.')
        .then(() => getMongodbCollection('Orders'))
        .then(async collection => {
            orderCollection = collection;
            let wallet;
            if (req.body.email) {
                wallet = await request.get(`${process.env.WALLET_API_URL}/api/${process.env.WALLET_API_VERSION}/users/${req.body.email}/wallet`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.WALLET_API_KEY
                    }
                });
            }
            if (req.body.mobilephone && !wallet) {
                wallet = await request.get(`${process.env.WALLET_API_URL}/api/${process.env.WALLET_API_VERSION}/users/${req.body.mobilephone}/wallet`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.WALLET_API_KEY
                    }
                });
            }
            return wallet;
        })
        .then(wallet => {
            const query = {};
            if ((req.body.email || req.body.mobilephone) && !wallet) {
                return new Array();
            }
            if (wallet) {
                query.walletID = wallet._id;
            }
            if (req.body.currency) {
                query.currency = req.body.currency;
            }
            if (req.body.orderID) {
                query._id = req.body.orderID;
                query.partitionKey = req.body.orderID;
            }
            if (req.body.webshopID) {
                query.webShopID = req.body.webshopID;
            }
            if (req.body.orderStatus) {
                query.orderStatus = req.body.orderStatus;
            }
            if (req.body.fromDate && req.body.toDate) {
                let fromDate = new Date(req.body.fromDate);
                fromDate = fromDate.setHours(0, 0, 1);
                let toDate = new Date(req.body.toDate);
                toDate = toDate.setHours(23, 59, 59);
                query.orderDate = {
                    $gte: fromDate,
                    $lte: toDate
                };
            }
            query.sellerMerchantID = req.body.merchantID;
            query.docType = 'order';
            return orderCollection.find(query)
                .sort({ orderDate: -1 })
                .limit(100)
                .toArray();
        })
        .then(order => {
            if (order) {
                context.res = {
                    body: order
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
