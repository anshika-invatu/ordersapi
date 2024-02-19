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
                    'You\'ve requested to pos session started but the request body seems to be empty. Kindly specify the request body in application/json format',
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
        if (req.body.posSessionsID)
            posSession = await collection.findOne({
                _id: req.body.posSessionsID,
                partitionKey: req.body.posSessionsID,
                docType: 'posSessions'
            });
        if (!posSession && req.body.posSessionReferenceID) {
            posSession = await collection.findOne({
                posSessionReferenceID: req.body.posSessionReferenceID,
                componentID: req.body.componentID,
                docType: 'posSessions'
            });
        }
        if (!posSession) {
            const posSessions = await collection.find({
                componentID: req.body.componentID,
                docType: 'posSessions'
            }).sort({ createdDate: 1 })
                .toArray();
            if (posSessions.length > 0)
                posSession = posSessions[0];
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
        let componentName;
        if (component && component.componentName) {
            
            for (const key in component.componentName) {
                if (Object.hasOwnProperty.call(component.componentName, key)) {
                    const element = component.componentName[key];
                    componentName = element.text;
                    if (componentName)
                        break;
                }
            }
        }

        let protocolCode;
        let priceCalculation = 'vourity';
        if (pointOfService.evChargingSettings && pointOfService.evChargingSettings.priceCalculation) {
            priceCalculation = pointOfService.evChargingSettings.priceCalculation;
        }
        if (pointOfService.deviceEndpoint && pointOfService.deviceEndpoint.protocolCode)
            protocolCode = pointOfService.deviceEndpoint.protocolCode;
        let evseNumber, connectorNumber;
        if (component.evse && component.evse.evseNumber)
            evseNumber = component.evse.evseNumber;
        if (component.connector && component.connector.connectorNumber)
            connectorNumber = component.connector.connectorNumber;
        if (!posSession) {
            context.log('No posSession found. Creating a new posSession...');
            posSession = await this.createPosSession(req, pointOfService, component, evseNumber, connectorNumber, protocolCode, collection, componentName);
        }

        let sessionProduct;
        if (posSession && posSession.productID) {
            sessionProduct = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${posSession.productID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.PRODUCT_API_KEY
                }
            });
        }

        if (posSession) {
            context.log('Found existing posSession: ' + posSession._id);
            const isUpdated = await collection.updateOne({ _id: posSession._id, docType: 'posSessions', partitionKey: posSession._id },
                { $set: Object.assign({},{
                    _ts: new Date(),
                    ttl: 60 * 60 * 24 * 7,
                    sessionExpiryDate: moment().add(72, 'hours')
                        .toDate(),
                    sessionStateUpdatedDate: new Date(),
                    sessionStateCode: 'started',
                    evseNumber: evseNumber,
                    priceCalculation: priceCalculation,
                    usageRecords: [{
                        usageStartDate: new Date(),
                        usageStartValue: req.body.usageStartValue ? req.body.usageStartValue : 0,
                        unitCode: req.body.unitCode ? req.body.unitCode : 'Wh'
                    }],
                    componentID: req.body.componentID,
                    componentName: componentName,
                    fees: pointOfService.fees ? pointOfService.fees : {},
                    shipEvent: pointOfService.shipEvent ? pointOfService.shipEvent : 'NA',
                    shipID: pointOfService.shipID ? pointOfService.shipID : 'NA',
                    shipLocationID: pointOfService.shipLocationID ? pointOfService.shipLocationID : 'NA',
                    shipVATNumber: pointOfService.shipVATNumber ? pointOfService.shipVATNumber : 'NA',
                    evChargingBasicFees: sessionProduct.evChargingBasicFees ? sessionProduct.evChargingBasicFees : {},
                    updatedDate: new Date() }) });
            if (isUpdated && isUpdated.matchedCount)
                context.log(isUpdated.matchedCount);
        }
        
        const updatedPosSession = await collection.findOne({ _id: posSession._id, partitionKey: posSession.partitionKey, docType: 'posSessions' });
        if (updatedPosSession) {
            const log = Object.assign({}, updatedPosSession, { posSessionID: updatedPosSession._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);
        }

        if (req.body.accessToken && req.body.accessToken === 'AUTOPILOT') {
            //Autopilot set waiting for payment status also on the Component
            const updatedComponentBody = {};
            updatedComponentBody.paymentStatusCode = 'waitingforpayment';
            updatedComponentBody.posSessionID = updatedPosSession._id;
            context.log('Updated component body: ' + JSON.stringify(updatedComponentBody));
            const updateComponentResult = await request.patch(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-components-ocpi/${req.body.componentID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                },
                body: updatedComponentBody
            });
            context.log('Updated component: ' + JSON.stringify(updateComponentResult));
        }

        const energyEvents = {};
        energyEvents._id = uuid.v4();
        energyEvents.docType = 'energyEvents';
        energyEvents.partitionKey = energyEvents._id;
        energyEvents.eventCode = 'posSessionStarted';
        energyEvents.eventText = 'POS Session Started';
        energyEvents.pointOfServiceID = posSession.pointOfServiceID;
        energyEvents.pointOfServiceName = pointOfService.pointOfServiceName;
        energyEvents.merchantID = pointOfService.merchantID;
        energyEvents.posSessionID = posSession._id;
        energyEvents.createdDate = new Date();
        const sendMsg = await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ENERGY_EVENTS, energyEvents);
        context.log('Energy event sent ' + sendMsg);

        context.res = {
            body: {
                description: 'Successfully started pos session event.',
                posSessionReferenceID: posSession.posSessionReferenceID ? posSession.posSessionReferenceID : ''
            }
        };

    } catch (error) {
        context.log(error);
        context.res = {
            body: {
                description: 'Theres is an error when pos session event started.'
            }
        };
    }
};


exports.createPosSession = async (req, pointOfService, component, evseNumber, connectorNumber, protocolCode, collection, componentName) => {
    const posSessions = {};
    posSessions._id = uuid.v4();
    posSessions.docType = 'posSessions';
    posSessions.partitionKey = posSessions._id;
    posSessions.merchantID = pointOfService.merchantID;
    posSessions.merchantName = pointOfService.merchantName;
    posSessions.pointOfServiceID = req.body.pointOfServiceID;
    posSessions.pointOfServiceName = pointOfService.pointOfServiceName;
    posSessions.businessUnitID = pointOfService.businessUnitID;
    posSessions.componentID = req.body.componentID;
    posSessions.componentName = componentName;
    posSessions.iconImageURL = component.iconImageURL;
    posSessions.siteID = component.siteID;
    posSessions.siteName = component.siteName;
    posSessions.posSessionReferenceID = req.body.posSessionReferenceID;
    if (protocolCode === 'ocpp16')
        posSessions.posSessionReferenceID = Math.floor(Math.random() * 10000000) + 1;
    posSessions.sessionType = req.body.sessionType;
    posSessions.sessionStartDate = new Date();
    posSessions.sessionStopDate = '';
    posSessions.sessionExpiryDate = moment().add(72, 'hours')
        .toDate();
    posSessions.sessionStateUpdatedDate = new Date();
    posSessions.sessionStateCode = 'started';
    posSessions.paymentStatusCode = 'paid';
    posSessions.paymentProvider = 'Access Token';
    if (req.body.accessToken && req.body.accessToken === 'AUTOPILOT') {
        posSessions.paymentStatusCode = 'waitingforpayment';
    }
    if (req.body.accessToken && req.body.accessToken !== 'CLOUDKEY' && req.body.accessToken !== 'AUTOPILOT') {
        const accessTokenDoc = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/access-token-by-accessToken/${req.body.accessToken}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        let customer;
        if (accessTokenDoc.customerID) {
            try {
                customer = await request.get(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/customers/${accessTokenDoc.customerID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.CUSTOMER_API_KEY
                    }
                });
            } catch (error) {
                context.log(error);
            }
        }
        posSessions.accessTokenID = accessTokenDoc._id;
        posSessions.accessTokenName = accessTokenDoc.accessTokenName;
        posSessions.accessTokenType = accessTokenDoc.accessTokenType;
        posSessions.accessTokenHash = utils.hashToken(req.body.accessToken);
        posSessions.customerID = accessTokenDoc.customerID;
        posSessions.customerName = accessTokenDoc.customerName;
        posSessions.customerAccountID = accessTokenDoc.customerAccountID;
        posSessions.customerAccountName = accessTokenDoc.customerAccountName;
        posSessions.customerType = customer ? customer.customerType : '';
        posSessions.accessToken = '';
        posSessions.customerInfo = accessTokenDoc.accessTokenName;
    }
    posSessions.pspType = 'accessToken';
    posSessions.startingFunction = 'pos-session-started';
    if (posSessions.accessToken === undefined)
        posSessions.accessToken = req.body.accessToken;
    posSessions.currency = pointOfService.currency;
    posSessions.salesChannel = {
        salesChannelName: pointOfService.salesChannelName,
        salesChannelTypeCode: req.body.salesChannelTypeCode,
        salesChannelID: req.body.salesChannelID,
    };
    if (component.defaultProduct) {
        posSessions.productID = component.defaultProduct.productID;
        posSessions.productName = component.defaultProduct.productName;
        const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${component.defaultProduct.productID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (product) {
            posSessions.vatPercent = product.vatPercent;
            posSessions.vatClass = product.vatClass;
            posSessions.salesPrice = product.salesPrice;
            posSessions.priceType = product.priceType;
            posSessions.unitCode = product.unitCode;
            posSessions.priceGroupID = product.priceGroupID;
            posSessions.priceGroupName = product.priceGroupName;
            posSessions.evChargingBasicFees = product.evChargingBasicFees ? product.evChargingBasicFees : {};
        }
    }
    posSessions.connectorNumber = connectorNumber;
    posSessions.evseNumber = evseNumber;
    posSessions.usageRecords = [{
        usageStartDate: req.body.usageStartDate ? req.body.usageStartDate : new Date(),
        usageStartValue: req.body.usageStartValue ? req.body.usageStartValue : 0,
        unitCode: req.body.unitCode ? req.body.unitCode : 'Wh'
    }];
    posSessions._ts = new Date();
    posSessions.ttl = 60 * 60 * 24 * 7;
    posSessions.createdDate = new Date();
    posSessions.updatedDate = new Date();
    const insertedPosSession = await collection.insertOne(posSessions);
    let posSessionDoc;
    if (insertedPosSession && insertedPosSession.ops)
        posSessionDoc = insertedPosSession.ops[0];
    return posSessionDoc;
};