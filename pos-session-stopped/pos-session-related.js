'use strict';

const utils = require('../utils');
const uuid = require('uuid');
const moment = require('moment');
const request = require('request-promise');
const sortObjectsArray = require('sort-objects-array');


exports.deletedPosSession = async (collection, req, context) => {
    const posSessionOld = await collection.findOne({
        posSessionReferenceID: req.body.posSessionReferenceID,
        pointOfServiceID: req.body.pointOfServiceID,
        docType: 'posSessionsOld'
    });
    context.log('Check 3');
    context.log('posSessionOld 3 = ' + JSON.stringify(posSessionOld));
    try {
        const refundResult = await utils.createRefund(posSessionOld, collection, context, 'autoRefund');
        if (refundResult) {
            const updatedPosSession = await collection.updateOne({
                _id: posSessionOld._id,
                partitionKey: posSessionOld.partitionKey,
                docType: 'posSessionsOld'
            }, {
                $set: {
                    paymentStatusCode: 'refunded'
                }
            });
            context.log(updatedPosSession.matchedCount);

            const updatedRetailTransaction = await collection.updateOne({
                _id: posSessionOld.retailTransactionID,
                partitionKey: posSessionOld.retailTransactionID,
                $or: [{ 'docType': 'retailTransactionPending' }, { 'docType': 'retailTransaction' }]
            }, {
                $set: {
                    retailTransactionStatusCode: 'canceled'
                }
            });
            context.log(updatedRetailTransaction.matchedCount);
        }
    } catch (error) {
        context.log(error);
    }
};

exports.usageRecords = async (posSession, req, context) => {
    let usageTotalVolume = 0, usageTotalTimeMinutes = 0, sameUnitusageTotalVolume = 0;
    const usageRecords = [];
    posSession.usageRecords.forEach(usageRecord => {
        let usageTotalTimeMinute;
        if (!usageRecord.usageStopValue && req.body.usageStopValue)
            usageRecord.usageStopValue = req.body.usageStopValue;
        if (!usageRecord.usageStopDate && req.body.usageStopDate)
            usageRecord.usageStopDate = new Date(req.body.usageStopDate);
        if (usageRecord.usageStopValue !== undefined && usageRecord.usageStartValue !== undefined) {
            usageTotalVolume = usageTotalVolume + (usageRecord.usageStopValue - usageRecord.usageStartValue);
            usageRecord.usageTotalVolume = usageTotalVolume;
        }
        if (usageRecord.usageStopDate && usageRecord.usageStartDate) {
            usageTotalTimeMinute = new Date(usageRecord.usageStopDate) - new Date(usageRecord.usageStartDate);
            context.log('usageTotalTimeMinute = ' + usageTotalTimeMinute);
            usageTotalTimeMinutes = usageTotalTimeMinutes + (usageTotalTimeMinute / (60 * 1000));
            context.log('usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
        }
        if (usageRecord.usageTotalVolume > 0 && req.body.unitCode && req.body.unitCode.toLowerCase() === 'wh')
            usageRecord.usageTotalVolume = usageRecord.usageTotalVolume / 1000;

        if (posSession.priceType === 'pricePerUnit' && usageRecord.usageTotalVolume !== undefined)
            sameUnitusageTotalVolume = sameUnitusageTotalVolume + usageRecord.usageTotalVolume;

        usageRecord.usageTotalTimeMinutes = Number((usageTotalTimeMinute / (60 * 1000)).toFixed(1));

        usageRecord.usageTotalVolume = (usageRecord.usageStopValue - usageRecord.usageStartValue);

        usageRecord.usageTotalVolume = Number(usageRecord.usageTotalVolume.toFixed(1));
        usageRecord.unitCode = req.body.unitCode;
        if (isNaN(usageRecord.usageTotalVolume))
            usageRecord.usageTotalVolume = 0;
        usageRecords.push(usageRecord);
    });
    let startDate, endDate;
    const startAndEndDateArray = [];

    if (posSession && posSession.statusRecords) {
        sortObjectsArray(posSession.statusRecords, 'statusDate');
        for (let i = 0; i < posSession.statusRecords.length; i++) {
            const statusRecord = posSession.statusRecords[i];
            if (statusRecord.status && (statusRecord.status.toLowerCase() === 'charging')) {
                const startDateNew = moment(statusRecord.statusDate).toDate();
                //startAndEndDateArray.push({ startDate: startDateNew });
                for (let j = i; j < posSession.statusRecords.length; j++) {
                    const element = posSession.statusRecords[j];
                    if (element.status && (element.status.toLowerCase() === 'suspendedevse' || element.status.toLowerCase() === 'suspendedev')) {
                        const endDateNew = moment(element.statusDate).toDate();
                        startAndEndDateArray.push({ startDate: startDateNew, endDate: endDateNew });
                        break;
                    }
                }
            }
        }
    }
    let usageChargingTime = 0;
    for (let i = 0; i < startAndEndDateArray.length; i++) {
        const element = startAndEndDateArray[i];
        usageChargingTime = usageChargingTime + (element.endDate - element.startDate);
        usageChargingTime = Number((usageChargingTime / (1000 * 60)).toFixed(2));
    }
    if (!usageChargingTime) {
        if (!startDate)
            startDate = moment(posSession.createdDate).toDate();
        if (!endDate)
            endDate = moment(posSession.sessionStopDate).toDate();
        context.log('startDate = ' + startDate);
        context.log('endDate = ' + endDate);

        usageChargingTime = ((endDate - startDate) / (1000 * 60)).toFixed(2);
    }
    
    usageTotalTimeMinutes = usageTotalTimeMinutes.toFixed(2);
    let usageParkingTimeMinutes = (Number(usageTotalTimeMinutes) - Number(usageChargingTime)).toFixed(2);
    if (usageParkingTimeMinutes < 0)
        usageParkingTimeMinutes = 0;

    return {
        usageRecords,
        usageTotalVolume: Math.round(usageTotalVolume * 100) / 100,
        usageTotalTimeMinutes: Math.round(usageTotalTimeMinutes * 100) / 100,
        sameUnitusageTotalVolume,
        usageParkingTimeMinutes
    };
};

exports.deleteSession = async (collection, posSession) => {
    const updatedPosSessionDoc = await collection.findOne({ _id: posSession._id, partitionKey: posSession.partitionKey, docType: 'posSessions' });
    const log = Object.assign({}, updatedPosSessionDoc, { posSessionID: updatedPosSessionDoc._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
    await collection.insertOne(log);
    await collection.updateOne({ _id: updatedPosSessionDoc._id, partitionKey: updatedPosSessionDoc.partitionKey, docType: 'posSessions' },
        { $set: { posSessionID: updatedPosSessionDoc._id, docType: 'posSessionsOld', updatedDate: new Date() }});
};

exports.updateAccountingTrans = async (totalAmountInclVat, totalVatAmount, usageTotalVolume, usageTotalTimeMinutes, usageParkingTimeMinutes, newRetailTransaction, retailTransaction, context) => {
    totalAmountInclVat = Number(Number(totalAmountInclVat).toFixed(2));
    context.log(totalAmountInclVat);
    totalVatAmount = Number(Number(totalVatAmount).toFixed(2));
    context.log(totalVatAmount);
    usageTotalVolume = Number(Number(usageTotalVolume).toFixed(2));
    context.log(usageTotalVolume);
    usageTotalTimeMinutes = Number(Number(usageTotalTimeMinutes).toFixed(2));
    context.log(usageTotalTimeMinutes);
    const updateacc = await request.patch(`${process.env.BILLING_SERVICE_API_URL}/api/${process.env.BILLING_SERVICE_VERSION}/account-transaction/${retailTransaction.accountTransactionID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.BILLING_SERVICE_API_KEY
        },
        body: {
            amount: totalAmountInclVat,
            vatAmount: newRetailTransaction.totalVatAmount,
            vatClass: retailTransaction.vatSummary ? retailTransaction.vatSummary[0].vatClass : '',
            vatPercent: retailTransaction.vatSummary ? retailTransaction.vatSummary[0].vatPercent : '',
            usageTotalVolume: usageTotalVolume,
            usageTotalUnit: 'kWh',
            usageTotalTimeMinutes: usageTotalTimeMinutes,
            usageParkingTimeMinutes: usageParkingTimeMinutes
        }
    });
    context.log(updateacc);
};

exports.autoRefunded = async (pointOfService, collection, posSession, totalAmountInclVat, posSessionOld, context) => {
    if (pointOfService && pointOfService.autoRefundRules && pointOfService.autoRefundRules.unitCode
        && pointOfService.autoRefundRules.unitCode.toLowerCase() === 'kwh'
        && pointOfService.autoRefundRules.usageLimit >= totalAmountInclVat) {
        try {
            const refund = await utils.createRefund(posSessionOld, collection, context, 'autoRefundedLowUsage');
            if (refund) {
                const isUpdated = await collection.updateOne({ _id: posSession._id, partitionKey: posSession._id },
                    {
                        $set: {
                            status: 'refunded',
                            sessionStateCode: 'autoRefundedLowUsage'
                        }
                    });
                context.log(isUpdated.matchedCount);
            }
        } catch (error) {
            context.log(error);
        }
    }
};

exports.getPointOfService = async (req, posSession, context) => {
    let pointOfService, quickShop;
    try {
        if (posSession.salesChannel)
            if (posSession.salesChannel.salesChannelTypeCode === 'quickshop')
                quickShop = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/quickshop/${posSession.salesChannel.salesChannelID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.MERCHANT_API_KEY
                    }
                });
        pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${posSession.salesChannel.salesChannelID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
    } catch (error) {
        context.log(error);
    }
    if (!pointOfService && !quickShop)
        try {
            pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${req.body.salesChannelID}`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.DEVICE_API_KEY
                }
            });
        } catch (error) {
            context.log(error);
        }
    return { pointOfService, quickShop };
};

exports.updatedRetailTransActions = async (collection, oldRetailTransaction, amount, posSession, quantity, context, isPlanetError, resultReasonText) => {
    context.log('running updating function');
    let vatPercents = 0, vatAmount = 0, count = 0, vatCounts = 0;
    let feeTransactionPercent = 0, feeTransactionAmount = 0, totalTransactionFee = 0;
    let shipID = 'NA';
    let shipLocationID = 'NA';
    let shipVATNumber = 'NA';
    amount = amount ? Number(amount.toFixed(2)) : amount;
    quantity = quantity ? Number(quantity.toFixed(2)) : quantity;
    posSession.pricePerUnit = posSession.pricePerUnit ? Number(posSession.pricePerUnit.toFixed(2)) : posSession.pricePerUnit;
    if (oldRetailTransaction.lineItems && Array.isArray(oldRetailTransaction.lineItems)) {
        oldRetailTransaction.lineItems.forEach(element => {
            if (element.lineItemTypeCode === 'sales') {
                vatPercents = vatPercents + element.vatPercent;
                count++;
            }
        });
        context.log(vatPercents);
        context.log(count);
        let vatPercent = vatPercents ? vatPercents / count : 0;
        context.log(vatPercent);
        if (!vatPercent) {
            oldRetailTransaction.lineItems.forEach(element => {
                if (element.lineItemTypeCode === 'vat') {
                    vatPercents = vatPercents + element.vatPercent;
                    vatCounts++;
                }
            });
            context.log(vatPercents);
            context.log(vatCounts);
            vatPercent = vatPercents ? vatPercents / vatCounts : 0;
            context.log(vatPercent);
        }

        vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
        oldRetailTransaction.lineItems.forEach(element => {
            if (element.lineItemTypeCode === 'sales') {
                element.quantity = quantity;
                element.pricePerUnit = posSession.pricePerUnit;
                element.amount = amount;
                element.credit = amount;
                element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
                element.amountExclVat = Number((amount - element.vatAmount).toFixed(2));
            }
            if (element.lineItemTypeCode === 'payment') {
                element.amount = amount;
                element.debit = amount;
            }
            if (element.lineItemTypeCode === 'vat') {
                element.amount = amount;
                element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
                element.amountExclVat = Number((amount - element.vatAmount).toFixed(2));
                element.credit = Number((amount - element.vatAmount).toFixed(2));
            }
        });
        oldRetailTransaction.vatSummary.forEach(element => {
            element.vatAmount = Number((amount - (amount / ((vatPercent / 100) + 1))).toFixed(2));
        });
    }
    
    //Calculate transaction fee
    if (posSession.fees && posSession.fees.feePerTransactionPercent) {
        feeTransactionPercent = Number((amount * (posSession.fees.feePerTransactionPercent / 100)).toFixed(2));
    }
    if (posSession.fees && posSession.fees.feePerTransactionAmount) {
        feeTransactionAmount = posSession.fees.feePerTransactionAmount;
    }
    totalTransactionFee = feeTransactionPercent + feeTransactionAmount;

    if (posSession.shipID) {
        shipID = posSession.shipID;
    }
    if (posSession.shipLocationID) {
        shipLocationID = posSession.shipLocationID;
    }
    if (posSession.shipVATNumber) {
        shipVATNumber = posSession.shipVATNumber;
    }

    let authorisationCode = '';
    if (oldRetailTransaction.checkoutSessionDoc && oldRetailTransaction.checkoutSessionDoc.paymentTransactionResponse && oldRetailTransaction.checkoutSessionDoc.paymentTransactionResponse.bankAuthCode) {
        authorisationCode = oldRetailTransaction.checkoutSessionDoc.paymentTransactionResponse.bankAuthCode;
    }

    context.log('updating retailTransactionPending');
    const updatedParams = {
        docType: 'retailTransaction',
        totalAmountInclVat: amount,
        totalVatAmount: vatAmount,
        retailTransactionStatusCode: 'paid',
        retailTransactionStatusText: 'paid',
        rental: posSession.rental,
        lineItems: oldRetailTransaction.lineItems,
        vatSummary: oldRetailTransaction.vatSummary,
        totalTransactionFee: totalTransactionFee,
        shipID: shipID,
        shipLocationID: shipLocationID,
        shipVATNumber: shipVATNumber,
        authorisationCode: authorisationCode,
        componentID: posSession.componentID,
        componentName: posSession.componentName,
        updatedDate: new Date()
    };
    if (isPlanetError === true) {
        updatedParams.retailTransactionStatusCode = 'failed';
        updatedParams.retailTransactionStatusText = 'failed';
        updatedParams.resultReasonText = resultReasonText;
    }
    let nusageStartValue = 0, nusageStopValue = 0, nusageTotalVolume = 0, nusageTotalTimeMinutes = 0;
    let nusageStartDate = new Date(), nusageStopDate = new Date();
    if (posSession.usageRecords && Array.isArray(posSession.usageRecords) && posSession.usageRecords[0]) {
        context.log('Found usage records');
        updatedParams.usageStartValue = posSession.usageRecords[0].usageStartValue;
        updatedParams.usageStopValue = posSession.usageRecords[0].usageStopValue;
        updatedParams.usageTotalVolume = posSession.usageRecords[0].usageTotalVolume;
        updatedParams.usageTotalTimeMinutes = posSession.usageRecords[0].usageTotalTimeMinutes;
        updatedParams.usageStartDate = posSession.usageRecords[0].usageStartDate;
        updatedParams.usageStopDate = posSession.usageRecords[0].usageStopDate;
        oldRetailTransaction.usageTotalVolume = posSession.usageRecords[0].usageTotalVolume;
        oldRetailTransaction.usageTotalTimeMinutes = posSession.usageRecords[0].usageTotalTimeMinutes;
        nusageStartValue = posSession.usageRecords[0].usageStartValue;
        nusageStopValue = posSession.usageRecords[0].usageStopValue;
        nusageTotalVolume = posSession.usageRecords[0].usageTotalVolume;
        nusageTotalTimeMinutes = posSession.usageRecords[0].usageTotalTimeMinutes;
        nusageStartDate = posSession.usageRecords[0].usageStartDate;
        nusageStopDate = posSession.usageRecords[0].usageStopDate;
    }

    const updatedResult = await collection.updateOne({
        _id: oldRetailTransaction._id,
        partitionKey: oldRetailTransaction._id
    }, {
        $set: updatedParams
    });
    if (updatedResult && updatedResult.matchedCount)
        context.log('retail transaction doc updated');
    //context.log(updatedResult);
    context.log('updatedResult = ' + JSON.stringify(updatedResult));
    const newRetailTransaction = Object.assign({}, oldRetailTransaction, {
        docType: 'retailTransaction',
        totalAmountInclVat: amount,
        totalVatAmount: vatAmount,
        retailTransactionStatusCode: 'paid',
        retailTransactionStatusText: 'paid',
        lineItems: oldRetailTransaction.lineItems,
        vatSummary: oldRetailTransaction.vatSummary,
        totalTransactionFee: totalTransactionFee,
        shipID: shipID,
        shipLocationID: shipLocationID,
        shipVATNumber: shipVATNumber,
        usageStartValue: nusageStartValue,
        usageStopValue: nusageStopValue,
        usageTotalVolume: nusageTotalVolume,
        usageTotalTimeMinutes: nusageTotalTimeMinutes,
        usageStartDate: nusageStartDate,
        usageStopDate: nusageStopDate,
        authorisationCode: authorisationCode,
        updatedDate: new Date()
    });
    if (newRetailTransaction)
        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_RETAIL_TRANSACTIONS, newRetailTransaction);
    return newRetailTransaction;
};

exports.getPriceFromCustomerAgreement = async (collection, posSession,amount, context, pricePerUnit) => {
    context.log('running getPriceFromCustomerAgreement function');
    const customerAgreements = await request.get(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/merchants/${posSession.merchantID}/customer-agreements/${posSession.customerID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.CUSTOMER_API_KEY
        }
    });
    context.log(customerAgreements);
    let updatedPrice;
    if (customerAgreements && customerAgreements.length) {
        for (let i = 0; i < customerAgreements.length; i++) {
            const customerAgreement = customerAgreements[i];
            if (customerAgreement.agreementPrices && Array.isArray(customerAgreement.agreementPrices)) {
                await customerAgreement.agreementPrices.forEach(async agreementPrice => {
                    if (agreementPrice.buyType === 'all' && agreementPrice.priceType === 'discount') {
                        context.log('getting discount');
                        if (agreementPrice.discountType === 'percentage') {
                            updatedPrice = (amount * agreementPrice.discountPercentage) / 100;
                            updatedPrice = amount - updatedPrice;
                        }
                        if (agreementPrice.discountType === 'fixedAmount') {
                            updatedPrice = amount - agreementPrice.discountAmount;
                        }
                        context.log(amount);
                        context.log('updated price = ' + updatedPrice);
                        
                       
                    } else if (agreementPrice.buyType === 'all' && agreementPrice.priceType === 'discountPerUnit') {
                        context.log('getting per unit discount');
                        if (agreementPrice.discountType === 'percentage') {
                            updatedPrice = (pricePerUnit * agreementPrice.discountPercentage) / 100;
                            updatedPrice = pricePerUnit - updatedPrice;
                        }
                        if (agreementPrice.discountType === 'fixedAmount') {
                            updatedPrice = pricePerUnit - agreementPrice.discountAmount;
                        }
                        context.log(pricePerUnit);
                        context.log('updated price = ' + updatedPrice);
                        
                       
                    }
                });
            }
            return { agreementPrices: customerAgreement.agreementPrices, updatedPrice, customerAgreement };
        }
    }
};

exports.evalueateValues = async (req, posSession, values, context) => {
    let totalAmountInclVat = 0;
    var { usageTotalVolume, usageTotalTimeMinutes, sameUnitusageTotalVolume } = values;
    if (req.body.unitCode && req.body.unitCode && req.body.unitCode.toLowerCase() === 'wh')
        usageTotalVolume = usageTotalVolume / 1000;
    
    context.log('usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
    if (usageTotalVolume < 0)
        usageTotalVolume = 0;
    if (usageTotalTimeMinutes < 0 || usageTotalTimeMinutes > 99999)
        usageTotalTimeMinutes = 0;
    if (!posSession.pricePerUnit)
        posSession.pricePerUnit = posSession.salesPrice;
    if (posSession.priceType === 'fixedPrice')
        totalAmountInclVat = posSession.salesPrice;
    if (posSession.priceType === 'pricePerUnit')
        totalAmountInclVat = sameUnitusageTotalVolume * posSession.pricePerUnit;
    if (posSession.priceType === 'pricePerUnit' && posSession.unitCode === 'minutes')
        totalAmountInclVat = usageTotalTimeMinutes * posSession.pricePerUnit;
    if (posSession.priceType === 'priceGroup')
        totalAmountInclVat = posSession.salesPrice;
    if (posSession.priceType === 'freeOfCharge')
        totalAmountInclVat = 0;
    if (posSession.priceType === 'priceGroup' && posSession.priceGroupID) {
        const priceGroup = await request.post(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/price-by-price-group`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            body: {
                merchantID: posSession.merchantID,
                priceGroupID: posSession.priceGroupID,
                productID: posSession.productID,
                startDate: posSession.sessionStartDate
            }
        });
        totalAmountInclVat = priceGroup.salesPrice;
    }
    let totalVatAmount;
    if (totalAmountInclVat && posSession.vatPercent)
        totalVatAmount = Number((totalAmountInclVat - (totalAmountInclVat / ((posSession.vatPercent / 100) + 1))).toFixed(2));
    if (isNaN(usageTotalVolume))
        usageTotalVolume = 0;
    if (isNaN(usageTotalTimeMinutes))
        usageTotalTimeMinutes = 0;
    if (isNaN(totalAmountInclVat))
        totalAmountInclVat = 0;
    if (isNaN(totalVatAmount))
        totalVatAmount = 0;
    return { totalAmountInclVat, totalVatAmount, usageTotalVolume, usageTotalTimeMinutes };
};