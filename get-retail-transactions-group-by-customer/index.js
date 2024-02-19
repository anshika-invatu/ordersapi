'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const request = require('request-promise');

//Please refer the story BASE-652 for more details

module.exports = async (context, req) => {
    try {
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            merchantID: req.body.merchantID
        };
        if (req.body.businessUnitID)
            query.businessUnitID = req.body.businessUnitID;
        if (req.body.siteID)
            query.siteID = req.body.siteID;
        if (req.body.zoneID)
            query.zoneID = req.body.zoneID;
        if (req.body.pspType)
            query.pspType = req.body.pspType;
        if (req.body.customerType)
            query.customerType = req.body.customerType;
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
        
        const retailTransactions = await collection.aggregate([
            { '$match': query },
            {
                '$group': {
                    _id: {
                        customerID: '$customerID',
                        pspType: '$pspType'
                    },
                    totalAmountInclVat: { '$sum': '$totalAmountInclVat' },
                    totalVatAmount: { '$sum': '$totalVatAmount' },
                    numberOfTransactions: { '$sum': 1 }
                }
            },
            {
                '$group': {
                    _id: '$_id.customerID',
                    pspType: {
                        '$push': {
                            pspType: '$_id.pspType',
                            totalAmountInclVat: { '$sum': '$totalAmountInclVat' },
                            totalVatAmount: { '$sum': '$totalVatAmount' },
                            numberOfTransactions: { '$sum': 1 }
                        }
                    }
                }
            },
            { '$project': { _id: 0, customerID: '$_id', pspType: 1 }},
            { '$sort': { retailTransactionDate: -1 }},
            { '$limit': 50 }
        ]).toArray();
        if (retailTransactions && Array.isArray(retailTransactions)) {
            for (let i = 0; i < retailTransactions.length; i++) {
                const element = retailTransactions[i];
                if (element.customerID) {
                    try {
                        const customer =  await request.get(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/customers/${element.customerID}`, {
                            json: true,
                            headers: {
                                'x-functions-key': process.env.CUSTOMER_API_KEY
                            }
                        });
                        if (customer)
                            retailTransactions[i].customerName = customer.customerName;
                    } catch (error) {
                        context.log(error);
                    }
                }
            }
        }
        context.res = {
            body: retailTransactions
        };
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
    }
};
