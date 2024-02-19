'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const request = require('request-promise');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to stop pos session but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body.posSessionID && !req.body.componentID) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'Please send componentID Or posSessionID in input request.',
                    400
                )
            );
            return Promise.resolve();
        }
        let posSessionDoc;
        const collection = await getMongodbCollection('Orders');

        if (req.body.posSessionID) {
            posSessionDoc = await collection.findOne({
                docType: 'posSessions',
                _id: req.body.posSessionID,
                partitionKey: req.body.posSessionID
            });
            if (!posSessionDoc) {
                utils.setContextResError(
                    context,
                    new errors.POSSessionNotFoundError(
                        'The pos session detail specified doesn\'t exist.',
                        404
                    )
                );
                return Promise.resolve();
            }
            if (!req.body.componentID)
                req.body.componentID = posSessionDoc.componentID;
        }
        const component = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/component/${req.body.componentID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${component.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        let protocolCode;
        if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.protocolCode)
            protocolCode = pointOfService.deviceEndpoint.protocolCode;
        let evseNumber, connectorNumber;
        if (component.evse && component.evse.evseNumber)
            evseNumber = component.evse.evseNumber;
        if (component.connector && component.connector.connectorNumber)
            connectorNumber = component.connector.connectorNumber;
        let actionCode;
        if (!req.body.posSessionID) {
            const query = {
                docType: 'posSessions',
                componentID: req.body.componentID
            };
            if (req.body.customerInfo)
                query.customerInfo = req.body.customerInfo;
            if (query.customerInfo && (query.customerInfo).toLowerCase() === 'nocode')
                delete query.customerInfo;
            const posSessionDocs = await collection.find(query).sort({ createdDate: 1 })
                .limit(1)
                .toArray();
            if (!posSessionDocs || posSessionDocs.length < 1) {
                actionCode = 'unlock';
            } else if (posSessionDocs.length > 0) {
                posSessionDoc = posSessionDocs[0];
            }
        }
        if (posSessionDoc) {
            await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                { $set: Object.assign({},{ sessionStateCode: 'stopping' },{ updatedDate: new Date() }) });
        }
        if (!actionCode)
            actionCode = 'remoteStop';
        const reqbody = {
            actionCode: actionCode,
            componentID: req.body.componentID,
            pointOfServiceID: component.pointOfServiceID,
            evseNumber: evseNumber,
            connectorNumber: connectorNumber,
        };
        if (posSessionDoc) {
            reqbody.posSessionReferenceID = posSessionDoc.posSessionReferenceID;
            reqbody.posSessionID = posSessionDoc._id;
        }
        if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.auth && pointOfService.deviceEndpoint.auth.username)
            reqbody.chargingStationID = pointOfService.deviceEndpoint.auth.username;
        let function_key, function_url, function_version;
        if (protocolCode === 'ocpp16') {
            function_url = process.env.OCPP16_API_URL;
            function_key = process.env.OCPP16_API_KEY;
            function_version = process.env.OCPP16_API_VERSION;
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
        context.log('req body = ' + JSON.stringify(reqbody));
        const result = await request.post(`${function_url}/api/${function_version}/do-action`, {
            json: true,
            headers: {
                'x-functions-key': function_key
            },
            body: reqbody
        });
        if (result && posSessionDoc) {
            const log = Object.assign({}, posSessionDoc, { posSessionID: posSessionDoc._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);
        }
        context.res = {
            body: {
                description: 'Successfully stop pos session.'
            }
        };
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
    }
};
