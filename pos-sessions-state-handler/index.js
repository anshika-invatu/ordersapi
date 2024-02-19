'use strict';
const utils = require('../utils');
const { CustomLogs } = utils;
const { getMongodbCollection } = require('../db/mongodb');

module.exports = async function (context) {
    try {
        const collection = await getMongodbCollection('Orders');
        const posSessions = await collection.find({
            docType: 'posSessions',
            sessionExpiryDate: { $lt: new Date() },
        }).toArray();
        context.log(posSessions.length);
        if (posSessions && Array.isArray(posSessions)) {
            for (let i = 0; i < posSessions.length; i++) {
                const element = posSessions[i];
                CustomLogs(`get expire posSession doc with id ${element._id}`, context);
                const result = await collection.updateOne({
                    _id: element._id,
                    partitionKey: element.partitionKey,
                    docType: 'posSessions'
                }, {
                    $set: Object.assign({}, element, {
                        docType: 'posSessionsOld',
                        eventCode: 'posSessionExpired',
                        sessionStateCode: 'expired',
                        sessionStateUpdatedDate: new Date(),
                        updatedDate: new Date()
                    })
                });
                if (result && result.matchedCount)
                    CustomLogs(`posSession doc with id ${element._id} updated`, context);
                if (element.paymentStatusCode && element.paymentStatusCode.toLowerCase() === 'paid') {
                    CustomLogs(`create refund of posSession doc with id ${element._id}`, context);
                    const retailTransaction = await collection.findOne({
                        _id: element.retailTransactionID,
                        $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
                    });
                    const refundResult = await utils.createRefund(element, collection, context, 'autoRefund', retailTransaction);
                    context.log(refundResult);
                    CustomLogs(`swish refund result ${refundResult} of posSession doc with id ${element._id}`, context);
                    if (refundResult) {
                        const updatedPosSession = await collection.updateOne({
                            _id: element._id,
                            partitionKey: element.partitionKey,
                            docType: 'posSessionsOld'
                        }, {
                            $set: {
                                paymentStatusCode: 'refunded'
                            }
                        });
                        context.log(updatedPosSession.matchedCount);
            
                        const updatedRetailTransaction = await collection.updateOne({
                            _id: element.retailTransactionID,
                            partitionKey: element.retailTransactionID,
                            $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
                        }, {
                            $set: {
                                retailTransactionStatusCode: 'canceled',
                                retailTransactionStatusText: 'Canceled'
                            }
                        });
                        context.log(updatedRetailTransaction.matchedCount);
                    }
                }
            }
        }
        return Promise.resolve();
    } catch (error) {
        context.log(error);
        CustomLogs(`error with pos-sessions-state-handler  ${error}`, context);
        return Promise.resolve();
    }
   
};

