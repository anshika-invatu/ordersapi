'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const moment = require('moment');
const request = require('request-promise');


//BASE-359

module.exports = async function (context) {
    try {
        
        const collection = await getMongodbCollection('Orders');
        const posSessions = await collection.find({
            docType: 'posSessions',
            sessionStateCode: 'started',
            paymentStatusCode: { $ne: 'paid' }
        }).toArray();
        context.log(posSessions.length);
        if (posSessions && Array.isArray(posSessions)) {
            for (let i = 0; i < posSessions.length; i++) {
                const element = posSessions[i];
                const date = moment(element.createdDate).add(5, 'minutes')
                    .toDate();
                if (date > new Date()) {
                    continue;
                }
                const result = await collection.updateOne({
                    _id: element._id,
                    partitionKey: element.partitionKey,
                    docType: 'posSessions'
                }, {
                    $set: Object.assign({}, element, {
                        docType: 'posSessionsOld',
                        eventCode: 'posSessionExpired',
                        paymentStatusCode: 'notPaidInTime',
                        sessionStateCode: 'notPaidInTime',
                        sessionStateUpdatedDate: new Date(),
                        updatedDate: new Date()
                    })
                });
                if (result && result.matchedCount)
                    context.log('pos session doc updated');
            
        
                const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${element.pointOfServiceID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
                const component = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/component/${element.componentID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
                let evseNumber, connectorNumber;
                if (component.evse && component.evse.evseNumber)
                    evseNumber = component.evse.evseNumber;
                if (component.connector && component.connector.connectorNumber)
                    connectorNumber = component.connector.connectorNumber;
                let protocolCode;
                if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.protocolCode)
                    protocolCode = pointOfService.deviceEndpoint.protocolCode;
                const reqbody = {
                    actionCode: 'remoteStop',
                    componentID: element.componentID,
                    pointOfServiceID: component.pointOfServiceID,
                    evseNumber: evseNumber,
                    connectorNumber: connectorNumber,
                    posSessionReferenceID: element.posSessionReferenceID,
                    posSessionID: element._id
                };
                if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.auth && pointOfService.deviceEndpoint.auth.username)
                    reqbody.chargingStationID = pointOfService.deviceEndpoint.auth.username;
                let function_key, function_url, function_version;
                if (protocolCode === 'ocpp16') {
                    function_url = process.env.OCPP16_API_URL;
                    function_key = process.env.OCPP16_API_KEY;
                    function_version = process.env.OCPP16_API_VERSION;
                } else if (protocolCode === 'ocpp21') {
                    function_url = process.env.OCPP21_API_URL;
                    function_key = process.env.OCPP21_API_KEY;
                    function_version = process.env.OCPP21_API_VERSION;
                } else if (protocolCode === 'ocpi211') {
                    function_url = process.env.OCPI211_API_URL;
                    function_key = process.env.OCPI211_API_KEY;
                    function_version = process.env.OCPI211_API_VERSION;
                } else if (protocolCode === 'ocpi22') {
                    function_url = process.env.OCPI22_API_URL;
                    function_key = process.env.OCPI22_API_KEY;
                    function_version = process.env.OCPI22_API_VERSION;
                } else if (protocolCode === 'ocpi221') {
                    function_url = process.env.OCPI221_API_URL;
                    function_key = process.env.OCPI221_API_KEY;
                    function_version = process.env.OCPI221_API_VERSION;
                }
                context.log('req body = ' + JSON.stringify(reqbody));
                const actionResult = await request.post(`${function_url}/api/${function_version}/do-action`, {
                    json: true,
                    headers: {
                        'x-functions-key': function_key
                    },
                    body: reqbody
                });
                context.log(actionResult);
            }
        }
        return Promise.resolve();
    } catch (error) {
        context.log(error);
        return Promise.resolve();
    }
};