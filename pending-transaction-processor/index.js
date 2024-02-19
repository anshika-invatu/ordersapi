'use strict';


const moment = require('moment');
const utils = require('../utils');
const { CustomLogs } = utils;
const { getMongodbCollection } = require('../db/mongodb');



module.exports = async function (context) {

    context.log('JavaScript timer trigger function ran!');
    try {
        const TwoDaysAgoDate = moment().subtract(2, 'days')
            .toDate();
        const collection = await getMongodbCollection('Orders');
        const transcations = await collection.find({
            docType: 'retailTransactionPending',
            retailTransactionStatusCode: 'Paid',
            createdDate: { $gte: TwoDaysAgoDate }
        }).toArray();
        context.log('Transcations.length = ' + transcations.length);
        CustomLogs('Transcations.length = ' + transcations.length, context);
        if (transcations && Array.isArray(transcations)) {
            //for (let i = 0; i < transcations.length; i++) {
            for (const element of transcations) {
                const result = await transcationProcessor(element, collection, context);
                context.log(result);
            }
        }
    } catch (error) {
        context.log(error);
    }
    async function transcationProcessor (element, collection, context) {
        try {
            //const element = transcations[i];
            CustomLogs('retail transction id = ' + element._id, context);
            context.log(element.posSessionID);
            const posSession = await collection.findOne({
                _id: element.posSessionID,
                docType: 'posSessionsOld',
                $and: [{ $or: [{ 'sessionStateCode': 'notPaidInTime' }, { 'sessionStateCode': 'expired' }, { 'sessionStateCode': 'denied' }, { 'sessionStateCode': 'started' }, { 'sessionStateCode': 'starting' }]},
                    { $or: [{ 'docType': 'posSessionsOld' }, { 'docType': 'posSessionsOld' }]}]
            });
            if (!posSession) {
                CustomLogs('posSession not exist with id = ' + element.posSessionID, context);
                return;
            }
            context.log('posSession = ' + posSession);
            CustomLogs('posSession = ' + JSON.stringify(posSession), context);
        
            context.log('Doing refund...');
            const result = await utils.createRefund(posSession, collection, context, 'autoRefunded', element);
            context.log('Refund result = ' + result);
            CustomLogs('Refund result = ' + JSON.stringify(result) + 'with retailTransaction id = ' + element._id, context);
            if (result && !(result).toString().includes('error')) {
                const updatedResult = await collection.updateOne({
                    _id: element._id,
                    partitionKey: element.partitionKey
                },
                {
                    $set: {
                        retailTransactionStatusCode: 'canceled',
                        retailTransactionStatusText: 'Canceled',
                        updatedDate: new Date()
                    }
                });
                if (updatedResult && updatedResult.matchedCount) {
                    context.log('retailTransaction updated');
                    CustomLogs('retailTransaction updated = ' + JSON.stringify(updatedResult) + 'with retailTransaction id = ' + element._id, context);
                }
            } else {
                const updatedResult = await collection.updateOne({
                    _id: element._id,
                    partitionKey: element.partitionKey
                },
                {
                    $set: {
                        retailTransactionStatusCode: 'refundFailed',
                        retailTransactionStatusText: 'Refund failed',
                        updatedDate: new Date()
                    }
                });
                if (updatedResult && updatedResult.matchedCount) {
                    context.log('retailTransaction updated');
                    CustomLogs('retailTransaction updated with fail status= ' + JSON.stringify(updatedResult) + 'with retailTransaction id = ' + element._id, context);
                }
            }
            return result;
            
        } catch (err) {
            context.log(err);
            return;
        }
    }

};