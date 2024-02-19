'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const errors = require('../errors');

//Please refer the story BASE-474 for more details

module.exports = async (context, req) => {
    if (req.body && !req.body.merchantID) {
        utils.setContextResError(
            context,
            new errors.FieldValidationError(
                'Please send the merchantiD field in request body.',
                404
            )
        );
    }
    try {
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'posSessionsOld',
            merchantID: req.body.merchantID
        };
        if (req.body.fromDate && req.body.toDate) {
            let fromDate = new Date(req.body.fromDate);
            fromDate = fromDate.setHours(0, 0, 1);
            let toDate = new Date(req.body.toDate);
            toDate = toDate.setHours(23, 59, 59);
            query.createdDate = {
                $gte: fromDate,
                $lte: toDate
            };
        }
        if (req.body.pointOfServiceID) {
            query.pointOfServiceID = req.body.pointOfServiceID;
        }
        if (req.body.siteID) {
            query.siteID = req.body.siteID;
        }
        if (req.body.zoneID) {
            query.zoneID = req.body.zoneID;
        }
        if (req.body.businessUnitID) {
            query.businessUnitID = req.body.businessUnitID;
        }
        if (req.body.componentID) {
            query.componentID = req.body.componentID;
        }
        if (req.body.pspType) {
            query.pspType = req.body.pspType;
        }
        if (req.body.productID) {
            query.productID = req.body.productID;
        }
        const result =  await collection.aggregate([
            { '$match': query },
            { '$sort': { createdDate: -1 }},
            { '$group': { _id: { $hour: '$createdDate' },
                usageTotalVolume: { '$sum': '$$ROOT.usageTotalVolume' },
                usageTotalTimeMinutes: { '$sum': '$$ROOT.usageTotalTimeMinutes' }}},
            { '$project': { _id: 0, hour: '$_id', usageTotalVolume: 1, usageTotalTimeMinutes: 1 }}
        ]).toArray();
        
        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};
