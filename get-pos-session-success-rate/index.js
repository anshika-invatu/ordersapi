'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const moment = require('moment');



//BASE-660
module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.body.merchantID, 'The merchant id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');
        
        const query = {
            docType: 'posSessionsOld',
            merchantID: req.body.merchantID
        };
        if (req.body.businessUnitID)
            query.businessUnitID = req.body.businessUnitID;
        if (req.body.siteID)
            query.siteID = req.body.siteID;
        if (req.body.zoneID)
            query.zoneID = req.body.zoneID;
        if (req.body.customerID)
            query.customerID = req.body.customerID;
        if (req.body.fromDate && req.body.toDate) {
            query.createdDate = {
                $gte: moment(req.body.fromDate).startOf('day')
                    .toDate(),
                $lte: new Date(req.body.toDate)
            };
        }
        const posSessionOlds = await collection.find(query).toArray();
        const totalNumberOfSessions = posSessionOlds.length;
        //const failedSessions = [], successfulSessions = [];
        const successfulSessions = [];
        posSessionOlds.map(posSessionOld => {
            if (posSessionOld.usageTotalVolume && posSessionOld.usageTotalVolume > 0)
                successfulSessions.push(posSessionOld);
        });
        const totalNumberOfSuccessfulSessions = successfulSessions.length;
        const totalNumberOfFailedSessions = totalNumberOfSessions - totalNumberOfSuccessfulSessions;
        //await posSessionOlds.map(posSessionOld => {
        //    if ((posSessionOld.usageTotalVolume === 0 || posSessionOld.usageTotalVolume !== undefined) && (posSessionOld.usageTotalVolume < 0 || posSessionOld.usageTotalVolume === 0))
        //        failedSessions.push(posSessionOld);
        //});
        const successRatePercentage = (totalNumberOfSuccessfulSessions / totalNumberOfSessions) * 100;
        
        const result = {
            numberOfSessions: totalNumberOfSessions,
            numberOfSuccessfulSessions: totalNumberOfSuccessfulSessions,
            numberOfFailedSessions: totalNumberOfFailedSessions,
            plugInSuccessRatePercentage: successRatePercentage
        };

        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};