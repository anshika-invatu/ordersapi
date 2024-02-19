'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const request = require('request-promise');
const moment = require('moment');
const errors = require('../errors');


//BASE-492
module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to start count up session but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        await utils.validateUUIDField(context, req.body.componentID, 'The point-of-service id specified in the URL does not match the UUID v4 format.');
        context.log('Req body = ' + JSON.stringify(req.body));
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

        let posStartSessionRequestAccepted = false;
        context.log('Component status = ' + JSON.stringify(component.statusCode));
        if (pointOfService.isEnabled === true && component.isEnabledForSale === true && component.statusCode &&
             (component.statusCode.toUpperCase() !== 'CHARGING' || component.statusCode.toUpperCase() !== 'OUTOFSERVICE')) {
            posStartSessionRequestAccepted = true;
        } else posStartSessionRequestAccepted = false;
        let response, resultBody;
        if (posStartSessionRequestAccepted === true) {
            context.log('Start Session Accepted');
            context.log('Input req body = ' + JSON.stringify(req.body));
            const ocpp16TransID = Math.floor(Math.random() * 10000000) + 1;
           
            let evseNumber, connectorNumber;
            if (component.evse && component.evse.evseNumber)
                evseNumber = component.evse.evseNumber;
            if (component.connector && component.connector.connectorNumber)
                connectorNumber = component.connector.connectorNumber;

            const collection = await getMongodbCollection('Orders');

            let countUpSessionsDoc = await collection.findOne({
                docType: 'countUpSessions',
                componentID: req.body.componentID
            });
            context.log('Existing posSession = ' + JSON.stringify(countUpSessionsDoc));
            if (countUpSessionsDoc) {
                await collection.updateOne({ _id: countUpSessionsDoc._id, docType: 'countUpSessions', partitionKey: countUpSessionsDoc._id },
                    { $set: Object.assign({},{ sessionStateCode: 'started' },{ updatedDate: new Date() }) });
                context.log('POS session is updated');
            } else {
                const posSession = await this.createCountUpSession(req, pointOfService, component, evseNumber, connectorNumber, ocpp16TransID);
                const insertedPosSession = await collection.insertOne(posSession);
                if (insertedPosSession && insertedPosSession.ops)
                    countUpSessionsDoc = insertedPosSession.ops[0];
            }

            context.log('Newly created pos session = ' + JSON.stringify(countUpSessionsDoc));
            
            const log = Object.assign({}, countUpSessionsDoc, { posSessionID: countUpSessionsDoc._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);

            if (countUpSessionsDoc.salesChannel && countUpSessionsDoc.salesChannel.salesChannelTypeCode === 'pos') {
                let product;
               
                const productID = countUpSessionsDoc.productID;

                const salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${countUpSessionsDoc.salesChannel.salesChannelID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });

                if (productID)
                    product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${productID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PRODUCT_API_KEY
                        }
                    });
                if (product) {
                    if (salesChannelPointOfService.preAuthorizationAmount)
                        product.salesPrice = Number(salesChannelPointOfService.preAuthorizationAmount);
                    else
                        product.salesPrice = 1;
                    const cartproduct = this.createCartProduct(product);
                    response = await request.patch(`${process.env.PRODUCT_API_URL}/api/v1/add-to-cart/${countUpSessionsDoc.salesChannel.salesChannelID}`, {
                        body: { product: cartproduct },
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PRODUCT_API_KEY
                        }
                    });
                }
                const iotReqBody = {};
                iotReqBody.payload = {
                    'statusCode': 'acceoted'
                };
                iotReqBody.pointOfService = salesChannelPointOfService;
                iotReqBody.deviceAzureID = salesChannelPointOfService.deviceAzureID;
                iotReqBody.methodName = 'countUpSession';
                context.log('IOT Req body = ' + JSON.stringify(iotReqBody));

                if (req.body.buildTestCode) {
                    context.log('Build test, not sending to Azure IoT Hub');
                } else {
                    context.log('Sending to Azure IoT Hub');
                    response = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/perform-iot-action`, {
                        json: true,
                        body: iotReqBody,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                }
            }

            resultBody =  {
                posSessionID: countUpSessionsDoc._id,
                description: 'Successfully start count up session.'
            };
        } else {
            context.log('Start Session Denied');

            const collection = await getMongodbCollection('Orders');

            const countUpSessionsDoc = await collection.findOne({
                docType: 'countUpSessions',
                componentID: req.body.componentID
            });

            const salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${countUpSessionsDoc.salesChannel.salesChannelID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });

            const iotReqBody = {};
            iotReqBody.payload = {
                'statusCode': 'denied'
            };
            iotReqBody.pointOfService = salesChannelPointOfService;
            iotReqBody.deviceAzureID = salesChannelPointOfService.deviceAzureID;
            iotReqBody.methodName = 'countUpSession';
            context.log('IOT Req body = ' + JSON.stringify(iotReqBody));
            response = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/perform-iot-action`, {
                json: true,
                body: iotReqBody,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });
            
        }
        context.log('Response = ' + JSON.stringify(response));
        resultBody.description = 'Successfully start count up session.';

        context.res = {
            body: resultBody
        };
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
    }
};


exports.createCountUpSession = async (req, pointOfService, component, evseNumber, connectorNumber, ocpp16TransID) => {
    const countUpSessions = {};
    countUpSessions._id = uuid.v4();
    countUpSessions.docType = 'countUpSessions';
    countUpSessions.partitionKey = countUpSessions._id;
    countUpSessions.merchantID = pointOfService.merchantID;
    countUpSessions.merchantName = pointOfService.merchantName;
    countUpSessions.pointOfServiceID = component.pointOfServiceID;
    countUpSessions.pointOfServiceName = pointOfService.pointOfServiceName;
    countUpSessions.componentID = req.body.componentID;
    countUpSessions.componentName = component.componentName;
    countUpSessions.iconImageURL = component.iconImageURL;
    countUpSessions.sessionReferenceID = ocpp16TransID;
    countUpSessions.sessionType = req.body.sessionType;
    countUpSessions.sessionStartDate = new Date();
    countUpSessions.siteID = component.siteID;
    countUpSessions.siteName = component.siteName;
    countUpSessions.sessionStopDate = '';
    countUpSessions.sessionExpiryDate = moment().add(3, 'minute')
        .toDate();
    countUpSessions.sessionStateUpdatedDate = new Date();
    countUpSessions.statusCode = 'starting';
    countUpSessions.sessionStateCode = 'pending';
    countUpSessions.sequenceNumber = 1;
    countUpSessions.startingFunction = 'start-count-up-session';
    countUpSessions.customerID = '';
    countUpSessions.currency = pointOfService.currency;
    countUpSessions.salesChannel = {
        salesChannelName: req.body.salesChannelName,
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
            countUpSessions.salesPrice = product.salesPrice;
            countUpSessions.pricePerUnit = product.salesPrice;
            countUpSessions.priceType = product.priceType;
            countUpSessions.unitCode = product.unitCode;
            countUpSessions.vatPercent = product.vatPercent;
            countUpSessions.vatClass = product.vatClass;
            countUpSessions.priceGroupID = product.priceGroupID;
            countUpSessions.priceGroupName = product.priceGroupName;
        }
    }
    countUpSessions.connectorNumber = connectorNumber;
    countUpSessions.evseNumber = evseNumber;
    countUpSessions.createdDate = new Date();
    countUpSessions.updatedDate = new Date();
    return countUpSessions;
};

exports.createCartProduct = (product) => {
    const cartProduct = {
        productID: product._id,
        productEAN: product.productEAN,
        productGCN: product.productGCN,
        productName: product.productName,
        productDescription: product.productDescription,
        productTypeID: product.productTypeID,
        productTypeCode: product.productTypeCode,
        productTypeName: product.productTypeName,
        productTypeIconURL: product.productTypeIconURL,
        productCategoryID: product.productCategories ? product.productCategories[0].productCategoryID : '',
        productCategoryName: product.productCategories ? product.productCategories[0].productCategoryName : '',
        productCategoryIconURL: product.productCategories ? product.productCategories[0].productCategoryIconURL : '',
        conditions: product.conditions,
        imageURL: product.imageURL,
        voucherType: product.voucherType,
        isEnabledForSale: product.isEnabledForSale,
        issuer: product.issuer,
        salesPrice: product.salesPrice,
        amount: product.salesPrice,
        vatPercent: product.vatPercent,
        vatAmount: product.vatAmount,
        currency: product.currency,
        salesPeriodStart: product.validPeriod ? product.validPeriod.salesPeriodStart : '',
        salesPeriodEnd: product.validPeriod ? product.validPeriod.salesPeriodEnd : ''
    };
    return cartProduct;
};