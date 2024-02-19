'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');


//BASE-645

module.exports = async function (context) {
    try {

        const collection = await getMongodbCollection('Orders');
        const posSessions = await collection.find({
            docType: 'posSessions',
        }).toArray();
        context.log('Found posSessions: ' + posSessions.length);
        for (let i = 0; i < posSessions.length; i++) {
            const posSession = posSessions[i];
            context.log('posSession ' + JSON.stringify(posSession));
            let value = 1, unit = 'kWh', measurmentDoc, product;
            try {
                measurmentDoc = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-session/${posSession._id}/top-measurment-data`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
                context.log('measurmentDoc ' + JSON.stringify(measurmentDoc));
            } catch (error) {
                context.log(error);
            }
            if (measurmentDoc && measurmentDoc.measurementValues && measurmentDoc.measurementValues.Energy_Active_Import_Register) {
                value = measurmentDoc.measurementValues.Energy_Active_Import_Register.value;
                unit = measurmentDoc.measurementValues.Energy_Active_Import_Register.unit;
                if (unit && (unit === 'Wh')) {
                    value = value / 1000;
                }
            }
            context.log('value = ' + value + ' and unit = ' + unit);
            try {
                product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${posSession.productID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PRODUCT_API_KEY
                    }
                });
            } catch (errorProd) {
                context.log(errorProd);
            }
            const productSalesPrice = product.salesPrice ? product.salesPrice : 1;
            context.log('Product ' + JSON.stringify(product));
            const soFarTimeMinutes = (((new Date() - new Date(posSession.createdDate)) / 1000) / 60).toFixed(1);
            const soFarCost = value * productSalesPrice;
            context.log('soFarTimeMinutes ' + soFarTimeMinutes);
            context.log('soFarCost ' + soFarCost);
            const posSessionUpdate = await collection.updateOne({
                _id: posSession._id,
                docType: 'posSessions',
                partitionKey: posSession.partitionKey
            },
            {
                $set: {
                    soFarUsageVolume: value,
                    soFarUsageUnit: 'kWh',
                    soFarTimeMinutes: soFarTimeMinutes,
                    soFarCost: soFarCost
                }
            });
            if (posSessionUpdate && posSessionUpdate.matchedCount) {
                context.log('posSession updated');
            }
            const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSession.salesChannel.salesChannelID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });
            if (posSession.pspType === 'planetpayment') {
                let soFarPreAuthAmount;
                if (posSession.soFarPreAuthAmount)
                    soFarPreAuthAmount = posSession.soFarPreAuthAmount;
                if (pointOfService && pointOfService.isTopupEnabled === true && pointOfService.preAuthorizationAmount && !posSession.soFarPreAuthAmount) {
                    soFarPreAuthAmount = pointOfService.preAuthorizationAmount;
                    const posSessionUpdate = await collection.updateOne({
                        _id: posSession._id,
                        docType: 'posSessions',
                        partitionKey: posSession.partitionKey
                    },
                    {
                        $set: {
                            soFarPreAuthAmount: soFarPreAuthAmount
                        }
                    });
                    if (posSessionUpdate && posSessionUpdate.matchedCount) {
                        context.log('posSession updated');
                    }
                }
                const soFarPreAuthAmount95per = soFarPreAuthAmount * 95 / 100;
                if (soFarCost > soFarPreAuthAmount95per || soFarCost === soFarPreAuthAmount95per) {
                    const checkoutSession = await collection.findOne({
                        posSessionID: posSession._id,
                        docType: 'checkoutSession'
                    });
                    const reqBody = {
                        amount: posSession.topupAmount,
                        posSessionID: posSession._id,
                        requesterTransRefNum: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterTransRefNum : '',
                        requesterLocationID: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.requesterLocationId : '',
                        SCATransRef: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.sCATransRef : '',
                        token: checkoutSession.paymentTransactionResponse ? checkoutSession.paymentTransactionResponse.token : '',
                        requesterStationID: 12
                    };
                    const topupResult = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/topup-planet-payment?paymentProviderAccountID=${pointOfService.paymentProviderAccounts.planet.paymentProviderAccountID}`, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PAYMENTS_API_KEY
                        },
                        body: reqBody
                    });
                    if (topupResult && topupResult.statusCode === 400) {
                        context.log(topupResult);
                        return Promise.resolve();
                    }
                    const posSessionUpdate = await collection.updateOne({
                        _id: posSession._id,
                        docType: 'posSessions',
                        partitionKey: posSession.partitionKey
                    },
                    {
                        $set: {
                            soFarPreAuthAmount: soFarPreAuthAmount + posSession.topupAmount
                        }
                    });
                    if (posSessionUpdate && posSessionUpdate.matchedCount) {
                        context.log('posSession updated');
                    }
                }
            } else if (posSession.pspType === 'swish' || posSession.pspType === 'stripe') {
                if (pointOfService && pointOfService.isTopupEnabled === true && pointOfService.topupAmount) {
                    const soFarPreAuthAmount = pointOfService.preAuthorizationAmount;
                    const soFarPreAuthAmount95per = soFarPreAuthAmount * 95 / 100;
                    if (posSession.soFarCost > soFarPreAuthAmount95per || posSession.soFarCost === soFarPreAuthAmount95per) {
                        const result = await request.post(`${process.env.ORDERS_API_URL}/api/${process.env.ORDERS_API_VERSION}/stop-pos-session`, {
                            body: { componentID: posSession.componentID, posSessionID: posSession._id },
                            json: true,
                            headers: {
                                'x-functions-key': process.env.ORDERS_API_KEY
                            }
                        });
                        context.log(result);
                    }
                }
            }
        }
        
        return Promise.resolve();
    } catch (error) {
        context.log(error);
        return Promise.resolve();
    }
};