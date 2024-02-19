'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const Promise = require('bluebird');
const request = require('request-promise');
const { CustomLogs } = utils;
module.exports = async (context, mySbMsg) => {

    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);

    try {
        const collection = await getMongodbCollection('Orders');
        const query = {
            $and:
                [
                    { $or: [{ docType: 'posSessions' }, { docType: 'posSessionsOld' }, { docType: 'checkoutSessionCompleted' }, { docType: 'checkoutSession' }]},
                    { $or: [{ paymentProviderSessionID: mySbMsg.payeePaymentReference }, { paymentProviderReference: mySbMsg.payeePaymentReference }]}
                ]
        };
       
        const session = await collection.findOne(query);

        const transactions = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions?paymentProviderReference=${mySbMsg.payeePaymentReference}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });

        if (!session && !transactions) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentProviderSessionID = mySbMsg.payeePaymentReference;
            checkoutSessionNotFound.message = 'checkoutSession doc not found.';
            CustomLogs(checkoutSessionNotFound, context);
            return Promise.resolve();
        }
        if (session) {
            const res = await collection.updateOne({
                _id: session._id,
                partitionKey: session.partitionKey
            }, {
                $set: {
                    swishCallBackResult: mySbMsg
                }
            });
            context.log(res.matchedCount);
            if (session.docType === 'posSessions') {
                const checoutSession = await collection.findOne({ posSessionID: session._id, docType: 'checkoutSession',
                    paymentProviderReference: mySbMsg.payeePaymentReference });
                const response = await collection.updateOne({
                    _id: checoutSession._id,
                    partitionKey: checoutSession.partitionKey
                }, {
                    $set: {
                        swishCallBackResult: mySbMsg
                    }
                });
                context.log(response.matchedCount);
            }
        }
        if (transactions) {
            const result = await request.patch(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions/${transactions._id}`, {
                json: true,
                body: {
                    swishCallBackResult: mySbMsg
                },
                headers: {
                    'x-functions-key': process.env.PAYMENTS_API_KEY
                }
            });
            context.log(result);
        }
    } catch (error) {
        context.log(error);
    }
    return Promise.resolve();
};