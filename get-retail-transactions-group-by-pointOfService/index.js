'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');

//Please refer the story BASE-126 for more details

module.exports = async (context, req) => {
    try {
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction'
        };
        if (req.body.merchantID)
            query.merchantID = req.body.merchantID;
        else
            query.merchantID = { $in: req.body.merchantIds };
        if (req.body.currency) {
            query.currency = req.body.currency;
        }
        if (req.body.pointOfServiceID) {
            query.pointOfServiceID = req.body.pointOfServiceID;
        }
        if (req.body.businessUnitID) {
            query.businessUnitID = req.body.businessUnitID;
        }
        if (req.body.siteID) {
            query.siteID = req.body.siteID;
        }
        if (req.body.zoneID) {
            query.zoneID = req.body.zoneID;
        }
        if (req.body.customerID) {
            query.customerID = req.body.customerID;
        }
        if (req.body.status) {
            query.retailTransactionStatusCode = req.body.status;
        }
        if (req.body.paymentType) {
            query.pspType = req.body.paymentType;
        }
        if (req.body.transactionID) {
            query._id = req.body.transactionID;
            query.partitionKey = req.body.transactionID;
        }
        if (req.body.itemText) {
            query.itemText = new RegExp(req.body.itemText);
        }
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
        if (!req.body.sortBy)
            req.body.sortBy = 'salesAmount';
        const retailTransactions = await collection.aggregate([
            { '$match': query },
            { '$group': {
                _id: '$pointOfServiceID', 'doc': { '$first':
                { pointOfServiceID: '$$ROOT.pointOfServiceID',
                    pointOfServiceName: '$$ROOT.pointOfServiceName',
                }},
                salesAmount: { '$sum': '$$ROOT.totalAmountInclVat' },
                numerOfTransactions: { '$sum': 1 }
            }},
            { '$project': { _id: 0, pointOfServiceID: '$doc.pointOfServiceID', pointOfServiceName: '$doc.pointOfServiceName', salesAmount: 1, numerOfTransactions: 1 }},
            { '$sort': { [req.body.sortBy]: -1 }}
        ]).toArray();
        
        context.res = {
            body: retailTransactions
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};
