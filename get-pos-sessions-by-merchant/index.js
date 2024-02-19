'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');



module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The merchantID specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const query = {
            merchantID: req.params.id,
        };
        if (!req.body)
            req.body = {};
        if (req.body.isActive === true || req.body.isActive === undefined) {
            query.docType = 'posSessions';
        } else if (req.body.isActive === false) {
            query.docType = 'posSessionsOld';
        }
        if (req.body.sessionStateCode)
            query.sessionStateCode = req.body.sessionStateCode;
        if (req.body.customerID)
            query.customerID = req.body.customerID;
        if (req.body.pointOfServiceID)
            query.pointOfServiceID = req.body.pointOfServiceID;
        if (req.body.componentID)
            query.componentID = req.body.componentID;
        if (req.body.siteID)
            query.siteID = req.body.siteID;
        if (req.body.zoneID)
            query.zoneID = req.body.zoneID;
        if (req.body.businssUnitID)
            query.businssUnitID = req.body.businssUnitID;
        if (req.body.paymentStatusCode)
            query.paymentStatusCode = req.body.paymentStatusCode;
        if (req.body.fromDate && req.body.toDate) {
            let fromDate = new Date(req.body.fromDate);
            fromDate = fromDate.setHours(0, 0, 1);
            let toDate = new Date(req.body.toDate);
            toDate = toDate.setHours(23, 59, 59);
            query.sessionStartDate = {
                $gte: fromDate,
                $lte: toDate
            };
        }
        const result = await collection.find(query, { projection: { _id: 1, merchantName: 1, pointOfServiceName: 1, pointOfServiceID: 1, componentName: 1, siteID: 1, siteName: 1,
            componentID: 1, iconImageURL: 1, sessionType: 1, sessionStartDate: 1, sessionStopDate: 1, sessionStateCode: 1, retailTransactionID: 1,
            paymentStatusCode: 1, pspType: 1, totalAmountInclVat: 1, currency: 1, posSessionReferenceID: 1, usageTotalVolume: 1, usageTotalTimeMinutes: 1, unitCode: 1, customerID: 1, customerInfo: 1, usageRecords: 1, posSessionStopReason: 1 }})
            .limit(500)
            .sort({ sessionStartDate: -1 })
            .toArray();

        if (result) {
            context.res = {
                body: result
            };
        }
    } catch (error) {
        utils.handleError(context, error);
    }
};
