'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const request = require('request-promise');
const validator = require('validator');

//Please refer the story BASE-639 for more details

module.exports = async (context, req) => {
    try {
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            merchantID: req.body.merchantID
        };
        context.log('req body = ' + JSON.stringify(req.body));

        if (req.body.businessUnitID) {
            query.businessUnitID = req.body.businessUnitID;
        }
        if (req.body.customerID) {
            query.customerID = req.body.customerID;
        }
        
        if (req.body.pspType) {
            query.pspType = req.body.pspType;
        }
        let retailTransactions;
        if (req.body.fromDate && req.body.toDate) {
            let fromDate = new Date(req.body.fromDate);
            fromDate = fromDate.setHours(0, 0, 1);
            let toDate = new Date(req.body.toDate);
            toDate = toDate.setHours(23, 59, 59);
            query.retailTransactionDate = {
                $gte: fromDate,
                $lte: toDate
            };
            retailTransactions = await collection.aggregate([
                { '$match': query },
                {
                    '$group': {
                        _id: '$siteID', 'doc': { '$first': { siteName: '$siteName' }},
                        totalAmountInclVat: { '$sum': '$$ROOT.totalAmountInclVat' },
                        totalVatAmount: { '$sum': '$$ROOT.totalVatAmount' },
                        numerOfTransactions: { '$sum': 1 }
                    }
                },
                { '$project': { _id: 0, siteID: '$_id', siteName: '$doc.siteName', totalAmountInclVat: 1, totalVatAmount: 1, numerOfTransactions: 1 }},
                { '$sort': { retailTransactionDate: -1 }}
            ]).toArray();
        } else {
            retailTransactions = await collection.aggregate([
                { '$match': query },
                { $limit: 200 },
                {
                    '$group': {
                        _id: '$siteID', 'doc': { '$first': { siteName: '$siteName' }},
                        totalAmountInclVat: { '$sum': '$$ROOT.totalAmountInclVat' },
                        totalVatAmount: { '$sum': '$$ROOT.totalVatAmount' },
                        numerOfTransactions: { '$sum': 1 }
                    }
                },
                { '$project': { _id: 0, siteID: '$_id', siteName: '$doc.siteName', totalAmountInclVat: 1, totalVatAmount: 1, numerOfTransactions: 1 }},
                { '$sort': { retailTransactionDate: -1 }}
            ])
                .toArray();
        }
        if (retailTransactions.length) {
            for (let i = 0; i < retailTransactions.length; i++) {
                const element = retailTransactions[i];
                if (!element.siteName && element.siteID && validator.isUUID(element.siteID, 4)) {
                    const site = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/sites/${element.siteID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                    if (site && site.siteName)
                        retailTransactions[i].siteName = site.siteName;
                }
                // if  (!element.siteID) {
                //     delete retailTransactions[i];
                // }
            }
            context.res = {
                body: retailTransactions
            };
        } else {
            context.res = {
                body: [{
                    totalAmountInclVat: 0,
                    totalVatAmount: 0,
                    numerOfTransactions: 0,
                    siteName: ''
                }]
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
