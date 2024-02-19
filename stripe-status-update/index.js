'use strict';

const Promise = require('bluebird');
const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const { CustomLogs } = utils;

//BAC-385 From merchant Portal
module.exports = async (context, event) => {
    const incomingRequest = {};
    incomingRequest.event = event;
    CustomLogs(incomingRequest, context);

    if (!event || !event.type || event.type !== 'charge.succeeded' || !event.data || !event.data.object) {
        return Promise.resolve();
    }

    const session = event.data.object;

    try {
        const orderCollection = await getMongodbCollection('Orders');

        const checkoutSession = await orderCollection.findOne({
            paymentID: session.payment_intent,
            docType: 'checkoutSession'
        });
        if (!checkoutSession) {
            const checkoutSessionNotFound = {};
            checkoutSessionNotFound.paymentID = session.payment_intent;
            checkoutSessionNotFound.message = `checkoutSession doc not found for this payment_intent = ${session.payment_intent}`;
            CustomLogs(checkoutSessionNotFound, context);
            return Promise.resolve();
        }
        const updatedcheckoutSession = await orderCollection.updateOne({
            _id: checkoutSession._id,
            docType: 'checkoutSession',
            partitionKey: checkoutSession.partitionKey
        }, {
            $set: {
                changeID: session.id,
                updatedDate: new Date()
            }
        });
        context.log(updatedcheckoutSession.matchedCount);
        const retailTransaction = await orderCollection.findOne({
            checkoutSessionID: checkoutSession._id,
            docType: 'retailTransactionPending'
        });

        let customerInfoMasked = '';
        if (session.payment_method_details.card.last4) {
            customerInfoMasked = 'xxxxxxxxxxx' + session.payment_method_details.card.last4;
            if (session.payment_method_details.card.brand === 'visa') {
                customerInfoMasked = '4' + customerInfoMasked;
            } else if (session.payment_method_details.card.brand === 'mastercard') {
                customerInfoMasked = '5' + customerInfoMasked;
            } else if (session.payment_method_details.card.brand === 'amex') {
                customerInfoMasked = '3' + customerInfoMasked;
            }
        }

        const updatedRetailTrasaction = await orderCollection.updateOne({
            checkoutSessionID: checkoutSession._id,
            docType: 'retailTransactionPending',
            partitionKey: retailTransaction.partitionKey
        }, {
            $set: {
                retailTransactionStatusCode: 'Paid',
                retailTransactionStatusText: 'Paid',
                customerInfoMasked: customerInfoMasked,
                updatedDate: new Date()
            }
        });
        if (updatedRetailTrasaction && updatedRetailTrasaction.matchedCount) {
            await orderCollection.updateOne({
                _id: checkoutSession.posSessionID,
                $or: [{ 'docType': 'posSessions' }, { 'docType': 'posSessionsOld' }],
                partitionKey: checkoutSession.posSessionID
            }, {
                $set: {
                    paymentStatusCode: 'Paid',
                    updatedDate: new Date()
                }
            });
            context.log('update checkout session sucsessfully');
            retailTransaction.retailTransactionStatusCode = 'Paid';
            retailTransaction.retailTransactionStatusText = 'Paid';
            await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_RETAIL_TRANSACTIONS, retailTransaction);
        } else {
            context.log('checkout session not updated');
        }

        if (retailTransaction.posSessionID) {
            const updatedPosSession = await orderCollection.updateOne({
                _id: retailTransaction.posSessionID,
                docType: 'posSessions',
                partitionKey: retailTransaction.posSessionID
            }, {
                $set: {
                    customerInfo: customerInfoMasked,
                    updatedDate: new Date()
                }
            });
            context.log('Updated POS Session: ' + updatedPosSession.matchedCount);
        }

    } catch (error) {
        context.log(error);
        error => utils.handleError(context, error);
    }

};