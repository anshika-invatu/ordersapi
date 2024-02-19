'use strict';

const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const checkoutUtiles = require('../utils/checkout-session');
const request = require('request-promise');
const posSessionLink = require('../utils/pos-session-link');
const { CustomLogs } = utils;
const uuid = require('uuid');

//BASE-19.

module.exports = async (context, req) => {
    try {
        CustomLogs(req.body, context);
        await utils.validateUUIDField(context, `${req.body.userSessionID}`, 'The userSessionID specified in the request body does not match the UUID v4 format.');

        if (req.body.pspType.toLowerCase() === 'accesstoken' && !req.body.accessToken) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'kindly provide the accessToken with accessToken pspType.',
                    400
                )
            );
            return Promise.resolve();
        }
        if (!req.body || !req.body.userSessionID || !req.body.pspType || !req.body.orderDate || !req.body.moduleCode || !req.body.moduleInstance) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'kindly provide the userSessionID, pspType, orderDate, moduleCode and moduleInstance.',
                    400
                )
            );
            return Promise.resolve();
        }
        const cart = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/users/${req.body.userSessionID}/cart`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PRODUCT_API_KEY
            }
        });
        if (!cart) {
            utils.setContextResError(
                context,
                new errors.CartNotFoundError(
                    'cart does not exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        if (!cart.pointOfServiceID) {
            const logObj = {};
            logObj.massage = `pointOfServiceID does not exist in cart(${req.body.userSessionID})`;
            CustomLogs(logObj, context);
        }
        let pointOfService;
        if (cart && cart.pointOfServiceID) {
            pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${cart.pointOfServiceID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });
        }

        const posData = await createPosData(req, pointOfService);
        const posDataInserted = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-data`, {
            body: posData,
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        context.log(posDataInserted);

        if (pointOfService.isEnabled !== true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    'pointOfService is disable.',
                    403
                )
            );
            return Promise.resolve();
        }
        if (pointOfService.isOpenForSale !== true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    pointOfService.notOpenForSaleText,
                    403
                )
            );
            return Promise.resolve();
        }
        if (pointOfService.isInMaintenanceMode === true) {
            utils.setContextResError(
                context,
                new errors.PointOfServiceRelatedError(
                    pointOfService.maintenanceModeText,
                    403
                )
            );
            return Promise.resolve();
        }
        
        let result;
        if (req.body.pspType !== 'swish') {
            const logObj = {};
            logObj.massage = `pspType is not swish in cart(${req.body.userSessionID})`;
            CustomLogs(logObj, context);
        }
        if (req.body.pspType.toLowerCase() === 'swish') {
            CustomLogs(`send req for payment for cartID(${req.body.userSessionID})`, context);
            result = await checkoutUtiles.createCheckoutSession(req, pointOfService, cart, context);
        } else if (req.body.pspType.toLowerCase() === 'bluecode') {
            CustomLogs(`send req for payment for cartID(${req.body.userSessionID})`, context);
            result = await checkoutUtiles.blueCodeCreateCheckoutSession(req, pointOfService, cart, context);
        } else if (req.body.pspType.toLowerCase() === 'accesstoken') {
            CustomLogs(`send req for payment for accesstoken(${req.body.accessToken})`, context);
            result = await checkoutUtiles.accessTokenCreateCheckoutSession(req, pointOfService, cart, context);
        } else if (req.body.pspType.toLowerCase() === 'binance') {
            CustomLogs(`send req for payment for binance(${req.body.userSessionID})`, context);
            result = await checkoutUtiles.binanceCreateCheckoutSession(req, pointOfService, cart, context);
        } else if (req.body.pspType.toLowerCase() === 'vipps') {
            CustomLogs(`send req for payment for vipps(${req.body.userSessionID})`, context);
            result = await checkoutUtiles.vippsCreateCheckoutSession(req, pointOfService, cart, context);
        } else if (req.body.pspType.toLowerCase() === 'mobilepay') {
            CustomLogs(`send req for payment for mobilePay(${req.body.userSessionID})`, context);
            result = await checkoutUtiles.mobilePayCreateCheckoutSession(req, pointOfService, cart, context);
        }
        if (result && result.length && result[0] && result[0].errorCode) {
            if (req.body.posSessionID)
                posSessionLink.stopPosSession(req.body.posSessionID, context);
            utils.setContextResError(
                context,
                new errors.SwishPaymentError(
                    result[0].errorMessage,
                    result[0].errorCode
                )
            );
            return Promise.resolve();
        }
        if (result && result.responseInfo && result.responseInfo.responseCode) {
            utils.setContextResError(
                context,
                new errors.VippsPaymentError(
                    result.responseMessage,
                    result.responseCode
                )
            );
            return Promise.resolve();
        }
        if (cart.cartType === 'booking') {
            await request.patch(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/booking-status/${cart._id}`, {
                json: true,
                body: {
                    currency: pointOfService.currency
                },
                headers: {
                    'x-functions-key': process.env.CUSTOMER_API_KEY
                }
            });
        }

        context.res = {
            body: result
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

function createPosData (req, pointOfService) {
    const posData = {};
    posData._id = uuid.v4();
    posData.docType = 'posData';
    posData.partitionKey = pointOfService._id;
    posData.pointOfServiceID = pointOfService._id;
    posData.merchantID = pointOfService.merchantID;
    posData.eventCode = 'paymentRequest';
    posData.direction = 'received';
    posData.actionCode = req.body.moduleCode;
    posData.result = req.body.pspType;
    posData.connectorNumber = '';
    posData.payload = req.body;
    posData.status = '';
    posData.ttl = 8000000;
    posData.createdDate = new Date();
    posData.updatedDate = new Date();

    if (req.body.pspType.toLowerCase() === 'accesstoken' && req.body.accessToken) {
        posData.status = req.body.accessToken.substr(0, 14);
    }

    return posData;
}
