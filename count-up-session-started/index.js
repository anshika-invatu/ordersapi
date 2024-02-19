'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const request = require('request-promise');
const errors = require('../errors');
const moment = require('moment');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to count up session started but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body.componentID || !req.body.pointOfServiceID || !req.body.salesChannelTypeCode  || !req.body.salesChannelID || !req.body.sessionType) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'Please pass these params(componentID, pointOfServiceID, salesChannelTypeCode, salesChannelID and sessionType).',
                    400
                )
            );
            return Promise.resolve();
        }
        context.log('req body = ' + JSON.stringify(req.body));
        const collection = await getMongodbCollection('Orders');
        let posSession;
        if (req.body.countUpSessionsID)
            posSession = await collection.findOne({
                _id: req.body.countUpSessionsID,
                partitionKey: req.body.countUpSessionsID,
                docType: 'countUpSessions'
            });
        if (!posSession && req.body.posSessionReferenceID) {
            posSession = await collection.findOne({
                posSessionReferenceID: req.body.posSessionReferenceID,
                componentID: req.body.componentID,
                docType: 'countUpSessions'
            });
        }
        if (!posSession) {
            const countUpSessions = await collection.find({
                componentID: req.body.componentID,
                docType: 'countUpSessions'
            }).sort({ createdDate: 1 })
                .toArray();
            if (countUpSessions.length > 0)
                posSession = countUpSessions[0];
        }
        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        const component = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/component/${req.body.componentID}`, {
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
        if (!posSession)
            posSession = await this.createCountUpSession(req, pointOfService, component, evseNumber, connectorNumber, protocolCode, collection);
        if (posSession) {
            const isUpdated = await collection.updateOne({ _id: posSession._id, docType: 'countUpSessions', partitionKey: posSession._id },
                { $set: Object.assign({},{
                    _ts: new Date(),
                    ttl: 60 * 60 * 24 * 7,
                    sessionExpiryDate: moment().add(72, 'hours')
                        .toDate(),
                    sessionStateUpdatedDate: new Date(),
                    sessionStateCode: 'started',
                    evseNumber: evseNumber,
                    usageRecords: [{
                        usageStartDate: new Date(),
                        usageStartValue: req.body.usageStartValue ? req.body.usageStartValue : 0,
                        unitCode: req.body.unitCode ? req.body.unitCode : 'Wh'
                    }],
                    updatedDate: new Date() }) });
            if (isUpdated && isUpdated.matchedCount)
                context.log(isUpdated.matchedCount);
        }
        
        const updatedPosSession = await collection.findOne({ _id: posSession._id, partitionKey: posSession.partitionKey, docType: 'countUpSessions' });
        if (updatedPosSession) {
            const log = Object.assign({}, updatedPosSession, { posSessionID: updatedPosSession._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);
        }
        context.res = {
            body: {
                description: 'Successfully started count up session event.',
                posSessionReferenceID: posSession.posSessionReferenceID ? posSession.posSessionReferenceID : ''
            }
        };
        
    } catch (error) {
        context.log(error);
        context.res = {
            body: {
                description: 'Theres is an error when count up session event started.'
            }
        };
    }
};


exports.createCountUpSession = async (req, pointOfService, component, evseNumber, connectorNumber, protocolCode, collection) => {
    const countUpSessions = {};
    countUpSessions._id = uuid.v4();
    countUpSessions.docType = 'countUpSessions';
    countUpSessions.partitionKey = countUpSessions._id;
    countUpSessions.merchantID = pointOfService.merchantID;
    countUpSessions.merchantName = pointOfService.merchantName;
    countUpSessions.pointOfServiceID = req.body.pointOfServiceID;
    countUpSessions.pointOfServiceName = pointOfService.pointOfServiceName;
    countUpSessions.componentID = req.body.componentID;
    countUpSessions.componentName = component.componentName;
    countUpSessions.iconImageURL = component.iconImageURL;
    countUpSessions.sessionReferenceID = req.body.posSessionReferenceID;
    if (protocolCode === 'ocpp16')
        countUpSessions.sessionReferenceID = Math.floor(Math.random() * 10000000) + 1;
    countUpSessions.sessionType = req.body.sessionType;
    countUpSessions.sessionStartDate = new Date();
    countUpSessions.sessionStopDate = '';
    countUpSessions.sessionExpiryDate = moment().add(72, 'hours')
        .toDate();
    countUpSessions.sessionStateUpdatedDate = new Date();
    countUpSessions.statusCode = 'started';
    countUpSessions.sessionStateCode = 'started';
    countUpSessions.paymentStatusCode = 'paid';
    countUpSessions.paymentProvider = 'Access Token';
    if (req.body.accessToken && req.body.accessToken !== 'CLOUDKEY') {
        const accessTokenDoc = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/access-token-by-accessToken/${req.body.accessToken}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        countUpSessions.accessTokenID = accessTokenDoc._id;
        countUpSessions.accessTokenName = accessTokenDoc.accessTokenName;
        countUpSessions.accessTokenHash = utils.hashToken(req.body.accessToken);
        countUpSessions.customerID = accessTokenDoc.customerID;
        countUpSessions.customerName = accessTokenDoc.customerName;
        countUpSessions.customerAccountID = accessTokenDoc.customerAccountID;
        countUpSessions.customerAccountName = accessTokenDoc.customerAccountName;
        countUpSessions.accessToken = '';
    }
    countUpSessions.pspType = 'accessToken';
    countUpSessions.startingFunction = 'pos-session-started';
    if (countUpSessions.accessToken === undefined)
        countUpSessions.accessToken = req.body.accessToken;
    countUpSessions.currency = pointOfService.currency;
    countUpSessions.salesChannel = {
        salesChannelName: pointOfService.salesChannelName,
        salesChannelTypeCode: req.body.salesChannelTypeCode,
        salesChannelID: req.body.salesChannelID,
    };
    if (component.defaultProduct) {
        countUpSessions.productID = component.defaultProduct.productID;
        countUpSessions.productName = component.defaultProduct.productName;
        const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${component.defaultProduct.productID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (product) {
            countUpSessions.vatPercent = product.vatPercent;
            countUpSessions.vatClass = product.vatClass;
            countUpSessions.salesPrice = product.salesPrice;
            countUpSessions.priceType = product.priceType;
            countUpSessions.unitCode = product.unitCode;
            countUpSessions.priceGroupID = product.priceGroupID;
            countUpSessions.priceGroupName = product.priceGroupName;
        }
    }
    countUpSessions.connectorNumber = connectorNumber;
    countUpSessions.evseNumber = evseNumber;
    countUpSessions.usageRecords = [{
        usageStartDate: req.body.usageStartDate ? req.body.usageStartDate : new Date(),
        usageStartValue: req.body.usageStartValue ? req.body.usageStartValue : 0,
        unitCode: req.body.unitCode ? req.body.unitCode : 'Wh'
    }];
    countUpSessions._ts = new Date();
    countUpSessions.ttl = 60 * 60 * 24 * 7;
    countUpSessions.createdDate = new Date();
    countUpSessions.updatedDate = new Date();
    const insertedPosSession = await collection.insertOne(countUpSessions);
    let countUpSessionDoc;
    if (insertedPosSession && insertedPosSession.ops)
        countUpSessionDoc = insertedPosSession.ops[0];
    return countUpSessionDoc;
};