'use strict';


const request = require('request-promise');
const utils = require('../utils');
const Promise = require('bluebird');
const moment = require('moment');
const uuid = require('uuid');
const { getMongodbCollection } = require('../db/mongodb');
const { CustomLogs } = utils;

//BASE-493

module.exports = async (context, mySbMsg) => {
    context.log('JavaScript ServiceBus topic trigger function processed message', JSON.stringify(mySbMsg));
    const receivedMessage = JSON.stringify(mySbMsg);
    CustomLogs(`pos-session-paid incoming message is ${receivedMessage}`, context);
    try {
        if (mySbMsg && mySbMsg.docType !== 'retailTransactionPending' || (mySbMsg.retailTransactionStatusCode &&
            mySbMsg.retailTransactionStatusCode.toUpperCase() !== 'PAID')) {
            return Promise.resolve();
        }
        await utils.validateUUIDField(context, mySbMsg.posSessionID);

        const minBeforeDate = moment().subtract(15, 'minutes')
            .toDate();

        if (new Date(mySbMsg.createdDate) < minBeforeDate) {
            context.log('document older than 15 mins.');
            return Promise.resolve();
        }

        const collection = await getMongodbCollection('Orders');
        const posSessionDoc = await collection.findOne({
            _id: mySbMsg.posSessionID,
            docType: 'posSessions'
        });

        context.log('paymentStatusCode = ' + posSessionDoc.paymentStatusCode);
        if (posSessionDoc.accessToken === 'AUTOPILOT') {
            context.log('Autopilot case. No need to start the charging since it is already started');
            //Update the Component and set its payment status = paid
            const updatedComponentBody = {};
            updatedComponentBody.paymentStatusCode = 'paid';
            updatedComponentBody.posSessionID = '';

            const updateComponentResult = await request.patch(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-components-ocpi/${posSessionDoc.componentID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                },
                body: updatedComponentBody
            });
            context.log('Updated component: ' + JSON.stringify(updateComponentResult));

            let smartChargingProfileID = '';
            // Send set charging profile for Autopilot to increase the charging station power after payment is done
            const component = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/component/${posSessionDoc.componentID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });

            if (component && component.smartChargingProfileID)
                smartChargingProfileID = component.smartChargingProfileID;

            const reqbody = {
                componentID: posSessionDoc.componentID,
                pointOfServiceID: posSessionDoc.pointOfServiceID,
                smartChargingProfileID: smartChargingProfileID
            };

            let protocolCode = '';
            const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSessionDoc.pointOfServiceID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });
            if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.protocolCode)
                protocolCode = pointOfService.deviceEndpoint.protocolCode;

            context.log('To charging station set-charging-profile req body = ' + JSON.stringify(reqbody));
            let function_key, function_url, function_version;
            if (protocolCode === 'ocpp16') {
                function_url = process.env.OCPP16_API_URL;
                function_key = process.env.OCPP16_API_KEY;
                function_version = process.env.OCPP16_API_VERSION;
            } else if (protocolCode === 'ocpp201') {
                function_url = process.env.OCPP201_API_URL;
                function_key = process.env.OCPP201_API_KEY;
                function_version = process.env.OCPP201_API_VERSION;
            } else if (protocolCode === 'ocpi22') {
                function_url = process.env.OCPI22_API_URL;
                function_key = process.env.OCPI22_API_KEY;
                function_version = process.env.OCPI22_API_VERSION;
            } else if (protocolCode === 'ocpi221') {
                function_url = process.env.OCPI221_API_URL;
                function_key = process.env.OCPI221_API_KEY;
                function_version = process.env.OCPI221_API_VERSION;
            } else if (protocolCode === 'ocpi211') {
                function_url = process.env.OCPI211_API_URL;
                function_key = process.env.OCPI211_API_KEY;
                function_version = process.env.OCPI211_API_VERSION;
            }

            if ((protocolCode !== '') && (smartChargingProfileID !== '')) {
                context.log('Sending set-charging-profile to the EV charging station');
                const result = await request.post(`${function_url}/api/${function_version}/set-charging-profile`, {
                    json: true,
                    headers: {
                        'x-functions-key': function_key
                    },
                    body: reqbody
                });
                context.log(result);
            }

        } else if (posSessionDoc.sessionStateCode !== 'started') {
            context.log('Normal start case. Sending remote start.');
            const reqbody = {
                actionCode: 'remoteStart',
                componentID: posSessionDoc.componentID,
                pointOfServiceID: posSessionDoc.pointOfServiceID,
                evseNumber: posSessionDoc.evseNumber,
                connectorNumber: posSessionDoc.connectorNumber,
                accessToken: 'CLOUDKEY',
                posSessionReferenceID: posSessionDoc.posSessionReferenceID,
                posSessionID: posSessionDoc._id
            };

            let protocolCode;
            const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSessionDoc.pointOfServiceID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });

            if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.protocolCode)
                protocolCode = pointOfService.deviceEndpoint.protocolCode;

            if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.auth && pointOfService.deviceEndpoint.auth.username)
                reqbody.chargingStationID = pointOfService.deviceEndpoint.auth.username;

            context.log('To charging station do-action req body = ' + JSON.stringify(reqbody));
            let function_key, function_url, function_version;
            if (protocolCode === 'ocpp16') {
                function_url = process.env.OCPP16_API_URL;
                function_key = process.env.OCPP16_API_KEY;
                function_version = process.env.OCPP16_API_VERSION;
            } else if (protocolCode === 'ocpp201') {
                function_url = process.env.OCPP201_API_URL;
                function_key = process.env.OCPP201_API_KEY;
                function_version = process.env.OCPP201_API_VERSION;
            } else if (protocolCode === 'ocpi22') {
                function_url = process.env.OCPI22_API_URL;
                function_key = process.env.OCPI22_API_KEY;
                function_version = process.env.OCPI22_API_VERSION;
            } else if (protocolCode === 'ocpi221') {
                function_url = process.env.OCPI221_API_URL;
                function_key = process.env.OCPI221_API_KEY;
                function_version = process.env.OCPI221_API_VERSION;
            } else if (protocolCode === 'ocpi211') {
                function_url = process.env.OCPI211_API_URL;
                function_key = process.env.OCPI211_API_KEY;
                function_version = process.env.OCPI211_API_VERSION;
            } else if (protocolCode === 'eways') {
                function_url = process.env.EWAYS_API_URL;
                function_key = process.env.EWAYS_API_KEY;
                function_version = process.env.EWAYS_API_VERSION;
            } else if (protocolCode === 'chargeamps') {
                function_url = process.env.CHARGEAMPS_API_URL;
                function_key = process.env.CHARGEAMPS_API_KEY;
                function_version = process.env.CHARGEAMPS_API_VERSION;
            }
            const result = await request.post(`${function_url}/api/${function_version}/do-action`, {
                json: true,
                headers: {
                    'x-functions-key': function_key
                },
                body: reqbody
            });
            context.log(result);
        }

        const updatedResult = await collection.updateOne({
            _id: mySbMsg.posSessionID,
            partitionKey: mySbMsg.posSessionID,
            docType: 'posSessions'
        }, {
            $set: {
                paymentStatusCode: 'paid',
                updatedDate: new Date()
            }
        });
        context.log(updatedResult.matchedCount);
        const posData = await createPosData(posSessionDoc);
        const posDataInserted = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-data`, {
            body: posData,
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        context.log(posDataInserted);
    } catch (error) {
        context.log(error);
    }

    function createPosData (posSessionDoc) {
        const posData = {};
        posData._id = uuid.v4();
        posData.docType = 'posData';
        posData.partitionKey = posSessionDoc.pointOfServiceID;
        posData.pointOfServiceID = posSessionDoc.pointOfServiceID;
        posData.merchantID = posSessionDoc.merchantID;
        posData.eventCode = 'evChargingPaid';
        posData.direction = 'received';
        posData.actionCode = 'startingEVCharging';
        posData.result = mySbMsg.pspType;
        posData.connectorNumber = posSessionDoc.connectorNumber;
        posData.posSessionID = posSessionDoc._id;
        posData.status = mySbMsg.customerInfoMasked;
        posData.ttl = 8000000;
        posData.createdDate = new Date();
        posData.updatedDate = new Date();
        return posData;
    }
};