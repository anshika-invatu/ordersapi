'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');

//Please refer the story BASE-35 for more details

module.exports = async (context, req) => {
    try {
        context.log(JSON.stringify(req.body));
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            merchantID: req.body.merchantID
        };

        if (req.body.sessionID) {
            query.sessionID = req.body.sessionID;
        }
        if (req.body.posSessionID) {
            query.posSessionID = req.body.posSessionID;
        }
        if (req.body.currency) {
            query.currency = req.body.currency;
        }
        if (req.body.pointOfServiceID) {
            query.pointOfServiceID = req.body.pointOfServiceID;
        }
        if (req.body.status) {
            query.retailTransactionStatusCode = req.body.status;
        }
        if (req.body.pspType)
            req.body.paymentType = req.body.pspType;
        if (req.body.paymentType) {
            query.pspType = req.body.paymentType;
        }
        if (req.body.retailTransactionID)
            req.body.transactionID = req.body.retailTransactionID;
        if (req.body.transactionID) {
            query._id = req.body.transactionID;
            query.partitionKey = req.body.transactionID;
        }
        if (req.body.itemText) {
            query.itemText = new RegExp(req.body.itemText);
        }
        if (req.body.customerInfo)
            req.body.customerInfoMasked = req.body.customerInfo;
        if (req.body.customerInfoMasked) {
            query.customerInfoMasked = { '$regex': new RegExp('.*' + req.body.customerInfoMasked + '.*', 'i') };
        }
        if (req.body.fromDate && req.body.toDate) {
            let fromDate = new Date(req.body.fromDate);
            fromDate = fromDate.setHours(0, 0, 1);
            let toDate = new Date(req.body.toDate);
            toDate = toDate.setHours(23, 59, 59);
            query.retailTransactionDate = {
                $gte: fromDate,
                $lte: toDate
            };
        }
        let count = 0;
        context.log(JSON.stringify(query));
        for (var prop in req.body) {
            if (req.body.hasOwnProperty(prop))
                ++count;
        }
        let retailTransactions;
        if (count > 1) {
            retailTransactions = await collection.find(query,
                { projection: { 'lineItems': 0 }})
                .sort({ retailTransactionDate: -1 })
                .limit(750)
                .toArray();
        } else {
            retailTransactions = await collection.find(query,
                { projection: { 'lineItems': 0 }})
                .sort({ retailTransactionDate: -1 })
                .limit(100)
                .toArray();
        }

        retailTransactions.forEach(element => {
            delete element.checkoutSessionDoc;
        });
        context.res = {
            body: retailTransactions
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};
