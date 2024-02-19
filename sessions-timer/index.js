'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const Promise = require('bluebird');

//Please refer bac-416, 421 for this endpoint related details

module.exports = async function (context) {
    try {
        const collection = await getMongodbCollection('Orders');
        const sessions = await collection.find({
            docType: 'session',
            sessionType: { $in: ['vending', 'vendingVoucher', 'openDoor', 'vending2']},
            sessionExpiryDate: {
                $lt: new Date()
            }
        }).limit(100)
            .toArray();
        if (sessions && sessions.length) {
            context.log(sessions.length);
            await Promise.map(sessions, async element => {
                if (element && element.orderID) {
                    let refundedResult;
                    if (element.sessionType === 'vending') {
                        refundedResult = await request.post(process.env.FUNCTION_URL + '/api/v1/refund-order', {
                            body: {
                                orderID: element.orderID,
                                reasonForRefund: 'duplicate'
                            },
                            json: true,
                            headers: {
                                'x-functions-key': process.env.X_FUNCTIONS_KEY
                            }
                        });
                    } else if (element.sessionType === 'openDoor' || element.sessionType === 'vending2') {
                        if (element.paymentProvider === 'hips')
                            refundedResult = await request.patch(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/hips-refund-order/${element.paymentProviderReference}?paymentProviderAccountID=${element.paymentProviderAccountID}`, {
                                json: true,
                                headers: {
                                    'x-functions-key': process.env.PAYMENTS_API_KEY
                                }
                            });
                        if (element.paymentProvider === 'planetpayment') {
                            const reqBody = {
                                amount: sessions.totalVatAmount,
                                requesterTransRefNum: sessions.requesterTransRefNum,
                                requesterLocationID: sessions.requesterLocationID,
                                requesterStationID: sessions.requesterStationID,
                                bankAuthCode: sessions.bankAuthCode,
                                SCATransRef: sessions.SCATransRef,
                                token: sessions.paymentTransactionResponse.token,
                                currency: sessions.currency
                            };
                            context.log(JSON.stringify(reqBody));
                            refundedResult = await request.post(`${process.env.PAYMENTS_API_URL}/api/v1/capture-planet-payment?paymentProviderAccountID=${sessions.paymentProviderAccountID}`, {
                                json: true,
                                body: reqBody,
                                headers: {
                                    'x-functions-key': process.env.PAYMENTS_API_KEY
                                }
                            });
                        }
                    }
                    let insertedSession, deletedSession;
                    if (refundedResult || element.sessionType === 'vendingVoucher') {
                        deletedSession = await collection.deleteOne({
                            _id: element._id,
                            partitionKey: element._id,
                            docType: 'session'
                        });
                        if (deletedSession) {
                            const sessionOldDoc = Object.assign(
                                {},
                                element,
                                {
                                    docType: 'sessionOld',
                                    _ts: new Date(),
                                    ttl: 60 * 60 * 24 * 45 //45 days
                                });
                            insertedSession = await collection.insertOne(sessionOldDoc);
                        }
                    }
                    if (insertedSession) {
                        context.log('Successfully deleted the specified session');
                    }
                }
            });
            return Promise.resolve();
        }
    } catch (err) {
        context.log(err);
        return Promise.resolve();
    }
    return Promise.resolve();
};