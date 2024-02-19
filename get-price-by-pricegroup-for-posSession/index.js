'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const sunCalc = require('suncalc');
const request = require('request-promise');
const moment = require('moment');



module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The price-group specified id in the request does not match the UUID v4 format.');
        
        await utils.validateUUIDField(context, req.params.posSessionID, 'The pos-session id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const priceGroup = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/price-group/${req.params.id}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });

        const posSession = await collection.findOne({
            _id: req.params.posSessionID,
            docType: 'posSessions',
            partitionKey: req.params.posSessionID

        });
        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSession.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        let condition;
        const result = [];
        if (priceGroup && priceGroup.priceRules) {
            
            for (const priceRuleObjName in priceGroup.priceRules) {
                if (Object.hasOwnProperty.call(priceGroup.priceRules, priceRuleObjName)) {
                    const priceRule = priceGroup.priceRules[priceRuleObjName];
                    condition = await this.checkCondition(priceRule, posSession, pointOfService, context);
                    if (condition) {
                        result.push(Object.assign({}, condition, {
                            salesFees: priceGroup.salesFees,
                            publicPriceInfo: priceGroup.publicPriceInfo,
                            resellerCommissions: priceGroup.resellerCommissions
                        }));
                        context.log(condition);
                    }
                }
            }
        }

        context.res = {
            body: result
        };
        
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.checkCondition = async (priceRule, posSession, pointOfService, context) => {
    context.log('checking conditions');
    let hasExpired;
    if (priceRule.validFromDate && priceRule.validToDate) {
        hasExpired = !moment
            .utc()
            .isBetween(priceRule.validFromDate, priceRule.validToDate);
    }
    let conditionNumber = 0;
    const keyOperator = priceRule.and ? 'and' : 'or';

    if (!hasExpired && priceRule[keyOperator]) {
        for (let i = 0; i < priceRule[keyOperator].length; i++) {
            const cond = priceRule[keyOperator][i];
            if (cond.condition.toLowerCase() === 'dayofweek' ||
            cond.condition.toLowerCase() === 'isweekend' ||
            cond.condition.toLowerCase() === 'isweekday') {
                const currentUtcWeekDay = moment.utc().format('dd');
                if (cond.value.includes(currentUtcWeekDay)) {
                    conditionNumber += 1;
                }
            }
            if (cond.condition.toLowerCase() === 'timeofday') {
                const currentUtcTime = moment.utc().format('hh:mm');
                if (cond.operator && ((cond.operator.toLowerCase() === 'equals' && cond.value.includes(currentUtcTime)) ||
                ((cond.operator.toLowerCase() === 'greaterthan' || cond.operator.toLowerCase() === 'after') && cond.value < currentUtcTime) ||
                ((cond.operator.toLowerCase() === 'lessthan' || cond.operator.toLowerCase() === 'before') && cond.value > currentUtcTime))) {
                    conditionNumber += 1;
                }
            }
            if (cond.condition.toLowerCase() === 'date') {
                const currentUtcTime = moment.utc().toDate();
                if (cond.operator && ((cond.operator.toLowerCase() === 'equals' && cond.value.includes(currentUtcTime)) ||
                ((cond.operator.toLowerCase() === 'greaterthan' || cond.operator.toLowerCase() === 'after') && cond.value < currentUtcTime) ||
                ((cond.operator.toLowerCase() === 'lessthan' || cond.operator.toLowerCase() === 'before') && cond.value > currentUtcTime))) {
                    conditionNumber += 1;
                }
            }
            if (cond.condition.accessTokenType && posSession && posSession.pspType === 'accessToken' &&
            cond.condition.value === posSession.accessTokenType) {
                conditionNumber += 1;
            }
            if (cond.condition.accessTokenRole && posSession && posSession.pspType === 'accessToken' &&
            cond.condition.value === posSession.accessTokenRole) {
                conditionNumber += 1;
            }
            if (cond.condition.customerType && posSession && posSession.customerID &&
            cond.condition.value === posSession.customerType) {
                conditionNumber += 1;
            }
            if (cond.condition.isCustomer && posSession && posSession.customerID) {
                conditionNumber += 1;
            }
            if (cond.condition.isAccessToken && posSession && posSession.pspType === 'accessToken') {
                conditionNumber += 1;
            }
            if (cond.condition.product && posSession && posSession.productID && posSession.productID === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.creditcardBIN && posSession && posSession.creditcardBIN && posSession.creditcardBIN === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.productCategory && posSession && posSession.productID && posSession.productCategory === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.usageAmount && posSession && posSession.usageAmount && posSession.usageTotalVolume === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.usageTime && posSession && posSession.usageTime && posSession.usageTotalTimeMinutes === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.connectedToCharger && posSession && posSession.connectedToCharger && posSession.connectedToCharger === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.connectedToChargerButNotCharging && posSession && posSession.connectedToChargerButNotCharging && posSession.connectedToChargerButNotChargingMinutes === cond.condition.value) {
                conditionNumber += 1;
            }
            if (cond.condition.sunset && posSession && posSession.pointOfServiceID && pointOfService && pointOfService.location && pointOfService.location[0].latitude && pointOfService.location[0].longitude) {
                // get today's sunlight times for London
                const times = sunCalc.getTimes(new Date(posSession.sessionStartDate), pointOfService.location[0].latitude, pointOfService.location[0].longitude);

                // format sunset time from the Date object
                const sunsetStr = times.sunset.getHours() + ':' + times.sunrise.getMinutes();
                if (cond.condition.value.includes(sunsetStr)) {
                    conditionNumber += 1;
                }
            }
            if (cond.condition.sunrise && posSession && posSession.pointOfServiceID && pointOfService && pointOfService.location && pointOfService.location[0].latitude && pointOfService.location[0].longitude) {
                // get today's sunlight times for London
                const times = sunCalc.getTimes(new Date(posSession.sessionStartDate), pointOfService.location[0].latitude, pointOfService.location[0].longitude);

                // format sunrise time from the Date object
                const sunriseStr = times.sunrise.getHours() + ':' + times.sunrise.getMinutes();
                if (cond.condition.value.includes(sunriseStr)) {
                    conditionNumber += 1;
                }
            }
        }
        if (conditionNumber === priceRule[keyOperator].length && keyOperator === 'and') {
            return { salesPrice: priceRule.price.salesPrice,
                priceType: priceRule.price.priceType,
                unitCode: priceRule.price.unitCode,
                vatPercent: priceRule.price.vatPercent,
                vatClass: priceRule.price.vatClass,
                priceRule: priceRule };
        } else if (keyOperator === 'or') {
            return { salesPrice: priceRule.price.salesPrice,
                priceType: priceRule.price.priceType,
                unitCode: priceRule.price.unitCode,
                vatPercent: priceRule.price.vatPercent,
                vatClass: priceRule.price.vatClass,
                priceRule: priceRule };
        }
    }
};