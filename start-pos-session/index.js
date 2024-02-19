'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const request = require('request-promise');
const moment = require('moment');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to start pos session but the request body seems to be empty. Kindly specify the request body in application/json format',
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

        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${component.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });

        //BASE-491.
        let posStartSessionRequestAccepted = false;
        context.log('Component status = ' + JSON.stringify(component.statusCode));
        if (pointOfService.isEnabled === true && component.isEnabledForSale === true && component.statusCode &&
             component.statusCode.toUpperCase() !== 'OUTOFSERVICE' &&
             ((component.statusCode.toUpperCase() !== 'CHARGING' && component.paymentStatusCode !== 'waitingforpayment') ||
             (component.statusCode.toUpperCase() === 'CHARGING' && component.paymentStatusCode === 'waitingforpayment'))) {
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

            let posSessionDoc = await collection.findOne({
                docType: 'posSessions',
                componentID: req.body.componentID
            });
            context.log('Existing posSession = ' + JSON.stringify(posSessionDoc));
            if (posSessionDoc) {
                await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                    { $set: Object.assign({},{ componentID: component._id, componentName: componentName, updatedDate: new Date() }) });
                context.log('POS session is updated');
            } else {
                const posSession = await this.createPosSession(req, pointOfService, component, evseNumber, connectorNumber, ocpp16TransID, componentName);
                const insertedPosSession = await collection.insertOne(posSession);
                if (insertedPosSession && insertedPosSession.ops)
                    posSessionDoc = insertedPosSession.ops[0];
            }

            context.log('Newly created pos session = ' + JSON.stringify(posSessionDoc));
            
            const log = Object.assign({}, posSessionDoc, { posSessionID: posSessionDoc._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);

            if (req.body.salesChannelTypeCode === 'quickshop') {

                const quickshop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/quickshop/${req.body.salesChannelID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.MERCHANT_API_KEY
                    }
                });

                context.log('Session started from a QuickshopID ' + quickshop._id);

                if (!quickshop.preAuthorizationAmount) {
                    quickshop.preAuthorizationAmount = 10;
                    context.log('Quickshop is missing preAuthorizationAmount, setting default value');
                }

                if (posSessionDoc && quickshop.preAuthorizationAmount) {
                    await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                        { $set: Object.assign({},{ preAuthorizationAmount: quickshop.preAuthorizationAmount },{ updatedDate: new Date() }) });
                    context.log('POS session is updated with pre-auth amount for Quickshop');
                }
            }
            if (!req.body.salesChannelTypeCode)
                req.body.salesChannelTypeCode = posSessionDoc.salesChannel.salesChannelTypeCode;
            if (posSessionDoc.salesChannel && req.body.salesChannelTypeCode === 'pos') {
                let product;
               
                const productID = posSessionDoc.productID;

                let salesChannelPointOfService;
                if (posSessionDoc.accessToken && (posSessionDoc.accessToken === 'AUTOPILOT')) {
                    salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.salesChannelID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });

                    const isPosSessionUpdated = await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                        { $set: Object.assign({},{ salesChannel: { salesChannelTypeCode: 'pos', salesChannelID: req.body.salesChannelID, salesChannelName: salesChannelPointOfService.pointOfServiceName }}) });
                    if (isPosSessionUpdated && isPosSessionUpdated.matchedCount)
                        context.log(isPosSessionUpdated.matchedCount);
                    posSessionDoc.salesChannel.salesChannelID = req.body.salesChannelID;
                    posSessionDoc.salesChannel.salesChannelTypeCode = 'pos';
                    posSessionDoc.salesChannel.salesChannelName = salesChannelPointOfService.pointOfServiceName;
                } else {
                    salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSessionDoc.salesChannel.salesChannelID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                }

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
                    response = await request.patch(`${process.env.PRODUCT_API_URL}/api/v1/add-to-cart/${posSessionDoc.salesChannel.salesChannelID}`, {
                        body: { product: cartproduct },
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PRODUCT_API_KEY
                        }
                    });
                }
                const iotReqBody = {};
                iotReqBody.payload = {
                    'status': 'starting',
                    'posSessionID': posSessionDoc._id
                };
                iotReqBody.pointOfService = salesChannelPointOfService;
                iotReqBody.deviceAzureID = salesChannelPointOfService.deviceAzureID;
                iotReqBody.methodName = 'posStartSessionResponse';
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
                posSessionID: posSessionDoc._id,
                description: 'Successfully start pos session.'
            };
        } else {
            context.log('Start Session Denied');

            if (req.body.salesChannelTypeCode === 'pos') {

                const collection = await getMongodbCollection('Orders');

                const posSessionDoc = await collection.findOne({
                    docType: 'posSessions',
                    componentID: req.body.componentID
                });

                let salesChannelPointOfService;
                if (posSessionDoc.accessToken && (posSessionDoc.accessToken === 'AUTOPILOT')) {
                    salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.salesChannelID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                } else {
                    salesChannelPointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSessionDoc.salesChannel.salesChannelID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.DEVICE_API_KEY
                        }
                    });
                }

                const iotReqBody = {};
                iotReqBody.payload = {
                    'status': 'denied'
                };
                iotReqBody.pointOfService = salesChannelPointOfService;
                iotReqBody.deviceAzureID = salesChannelPointOfService.deviceAzureID;
                iotReqBody.methodName = 'posStartSessionResponse';
                context.log('IOT Req body = ' + JSON.stringify(iotReqBody));
                response = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/perform-iot-action`, {
                    json: true,
                    body: iotReqBody,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
            }
        }
        context.log('Response = ' + JSON.stringify(response));
        resultBody.description = 'Successfully start pos session.';

        context.res = {
            body: resultBody
        };
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
    }
};


exports.createPosSession = async (req, pointOfService, component, evseNumber, connectorNumber, ocpp16TransID, componentName) => {
    const posSessions = {};
    posSessions._id = uuid.v4();
    posSessions.docType = 'posSessions';
    posSessions.partitionKey = posSessions._id;
    posSessions.merchantID = pointOfService.merchantID;
    posSessions.merchantName = pointOfService.merchantName;
    posSessions.pointOfServiceID = component.pointOfServiceID;
    posSessions.pointOfServiceName = pointOfService.pointOfServiceName;
    posSessions.businessUnitID = pointOfService.businessUnitID;
    posSessions.componentID = req.body.componentID;
    posSessions.componentName = componentName;
    posSessions.iconImageURL = component.iconImageURL;
    posSessions.posSessionReferenceID = ocpp16TransID;
    posSessions.sessionType = req.body.sessionType;
    posSessions.sessionStartDate = new Date();
    posSessions.sessionStopDate = '';
    posSessions.sessionExpiryDate = moment().add(5, 'minute')
        .toDate();
    posSessions.sessionStateUpdatedDate = new Date();
    posSessions.siteID = component.siteID;
    posSessions.siteName = component.siteName;
    posSessions.sessionStateCode = 'pending';
    posSessions.startingFunction = 'start-pos-session';
    posSessions.customerID = '';
    posSessions.currency = pointOfService.currency;
    posSessions.rental = component.rental;
    posSessions.salesChannel = {
        salesChannelName: req.body.salesChannelName,
        salesChannelTypeCode: req.body.salesChannelTypeCode,
        salesChannelID: req.body.salesChannelID,
    };
    if (component.defaultProduct && component.defaultProduct.productID) {
        posSessions.productID = component.defaultProduct.productID;
        posSessions.productName = component.defaultProduct.productName;
        const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${component.defaultProduct.productID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (product) {
            posSessions.salesPrice = product.salesPrice;
            posSessions.pricePerUnit = product.salesPrice;
            posSessions.priceType = product.priceType;
            posSessions.unitCode = product.unitCode;
            posSessions.vatPercent = product.vatPercent;
            posSessions.vatClass = product.vatClass;
            posSessions.priceGroupID = product.priceGroupID;
            posSessions.priceGroupName = product.priceGroupName;
        }
    }
    posSessions.connectorNumber = connectorNumber;
    posSessions.evseNumber = evseNumber;
    posSessions.createdDate = new Date();
    posSessions.updatedDate = new Date();
    return posSessions;
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