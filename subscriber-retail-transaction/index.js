'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const uuid = require('uuid');
const moment = require('moment');
const utils = require('../utils');
const Promise = require('bluebird');
const { CustomLogs } = utils;

// BASE-177
module.exports = async (context, mySbMsg) => {
    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);
    if (mySbMsg && mySbMsg.docType !== 'retailTransaction') {
        context.log('DocType is not retailTransaction');
        CustomLogs(`docType is not retailTransaction ${mySbMsg.docType}`, context);
        return Promise.resolve();
    }
    try {
        const collection = await getMongodbCollection('Orders');
        const receipts = {};
        receipts._id = uuid.v4();
        receipts.docType = 'receipts';
        receipts.partitionKey = receipts._id;
        const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${mySbMsg.merchantID}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        });
        const businessUnit = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/business-units/${mySbMsg.businessUnitID}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        });
        context.log('Business unit = ' + JSON.stringify(businessUnit));
        receipts.merchantID = mySbMsg.merchantID;
        receipts.merchantName = mySbMsg.merchantName;
        receipts.merchantCompanyRegistrationNumber = merchant.companyRegistrationNumber;
        receipts.merchantVatNumber = merchant.vatNumber;
        if (businessUnit.logoImageURL)
            receipts.merchantLogoImageURL = businessUnit.logoImageURL;
        else
            receipts.merchantLogoImageURL = merchant.logoImageURL;
        //receipts.merchantLogoImageURL = merchant.logoImageURL;
        if (businessUnit.companyRegistrationNumber) {
            receipts.merchantCompanyRegistrationNumber = businessUnit.companyRegistrationNumber;
        }
        if (mySbMsg.shipID) {
            receipts.shipID = mySbMsg.shipID;
        }
        if (mySbMsg.shipLocationID) {
            receipts.shipLocationID = mySbMsg.shipLocationID;
        }
        if (mySbMsg.shipVATNumber) {
            receipts.shipVATNumber = mySbMsg.shipVATNumber;
        }
        if (mySbMsg.shipVATNumber && (mySbMsg.shipVATNumber !== 'NA')) {
            receipts.merchantCompanyRegistrationNumber = mySbMsg.shipVATNumber;
            receipts.merchantVatNumber = mySbMsg.shipVATNumber;
        }
        if (mySbMsg.customerID) {
            receipts.customerID = mySbMsg.customerID;
        }
        receipts.businessUnitID = mySbMsg.businessUnitID;
        receipts.businessUnitName = businessUnit[0].businessUnitName;
        receipts.pointOfServiceID = mySbMsg.pointOfServiceID;
        receipts.pointOfServiceName = mySbMsg.pointOfServiceName;
        receipts.orderID = mySbMsg.orderID;
        receipts.orderCounter = 0;
        receipts.retailTransactionID = mySbMsg._id;
        receipts.retailTransactionDate = mySbMsg.retailTransactionDate;
        receipts.receiptDate = new Date();
        receipts.receiptType = 'new';
        const receiptSequenceNumber = await this.getSequenceNumber(mySbMsg.merchantID);
        if (receiptSequenceNumber) {
            if (receiptSequenceNumber.sequenceNumber === 9999999999 || receiptSequenceNumber.sequenceNumber > 9999999999) {
                receiptSequenceNumber.sequenceNumber = 1;
            }
            receipts.receiptSequenceNumber = receiptSequenceNumber.sequenceNumber;
        }
        receipts.countryCode = merchant.countryCode;
        receipts.email = merchant.email;
        receipts.phone = merchant.phone;
        receipts.merchantAddress = businessUnit[0].invoiceAddress;
        receipts.merchantMainAddress = merchant.invoiceAddress;
        receipts.businessUnitAddress = businessUnit[0].invoiceAddress;
        receipts.salesChannel = {
            salesChannelName: mySbMsg.pointOfServiceName,
            pointOfServiceID: mySbMsg.pointOfServiceID,
            pointOfServiceName: mySbMsg.pointOfServiceName,
            webShopID: mySbMsg.webShopID,
            webShopTitle: mySbMsg.webShopTitle
        };
        if (receipts.salesChannel.webShopID)
            receipts.salesChannel.salesChannelTypeCode = 'webshop';
        else
            receipts.salesChannel.salesChannelTypeCode = 'pos';
        receipts.currency = mySbMsg.currency;
        receipts.totalAmountInclVat = mySbMsg.totalAmountInclVat;
        receipts.totalVatAmount = mySbMsg.totalVatAmount;
        receipts.vatSummary = mySbMsg.vatSummary;
        if (mySbMsg.posSessionID) {
            context.log('posSessionID is = ' + mySbMsg.posSessionID);
            const posSession = await collection.findOne({ posSessionID: mySbMsg.posSessionID, docType: 'posSessionsOld' });
            if (posSession)
                context.log('posSession id = ' + posSession._id);
            let { usageTotalVolume, usageTotalTimeMinutes } = await this.calculateValues(posSession, context);
            context.log('usageTotalVolume = ' + usageTotalVolume + ', usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
            if (!usageTotalTimeMinutes)
                usageTotalTimeMinutes = 0;
            if (!usageTotalVolume)
                usageTotalVolume = 0;
            receipts.usageTotalVolume = usageTotalVolume;
            receipts.usageTotalUnit = 'kWh',
            receipts.usageTotalTimeMinutes = usageTotalTimeMinutes;
        }
        if (mySbMsg.checkoutSessionDoc.paymentTransactionResponse) {
            receipts.cardPan = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.cardPan;
            receipts.cardScheme = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.cardScheme;
            //receipts.authorisationCode = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.authorisationCode;
            receipts.authorisationCode = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.bankAuthCode;
            receipts.emvAid = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.emvAid;
            receipts.emvTvr = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.emvTvr;
            receipts.emvTsi = mySbMsg.checkoutSessionDoc.paymentTransactionResponse.emvTsi;
        }
        if (mySbMsg.customerInfoMasked)
            receipts.customerInfoMasked = mySbMsg.customerInfoMasked;
        else
            receipts.customerInfoMasked = '-';
        receipts.lineItems = [];
        mySbMsg.lineItems.forEach(element => {
            if (element.lineItemTypeCode !== 'payment' && element.lineItemTypeCode !== 'vat') {
                receipts.lineItems.push(element);
            }
        });
        receipts.receiptURL = `${process.env.RECEIPT_LINK}/receipt/${receipts._id}`;
        receipts.payments = [{
            amount: mySbMsg.totalAmountInclVat,
            pspType: mySbMsg.pspType,
            transactionData: mySbMsg.checkoutSessionDoc.paymentTransactionResponse
        }];
        let customer;
        if (mySbMsg.customerID)
            try {
                customer = await request.get(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/customers/${mySbMsg.customerID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.CUSTOMER_API_KEY
                    }
                });
            } catch (error) {
                context.log(error);
            }
        if (customer)
            receipts.customer = {
                socialSecurityNumber: customer.socialSecurityNumber,
                email: customer.email,
                phone: customer.mobilePhone
            };
        receipts.texts = merchant.receiptTexts;
        receipts.usageStartValue = mySbMsg.usageStartValue;
        receipts.usageStopValue = mySbMsg.usageStopValue;
        if (mySbMsg.usageStartDate) {
            receipts.usageStartDate = mySbMsg.usageStartDate;
        }
        if (mySbMsg.usageStopDate) {
            receipts.usageStopDate = mySbMsg.usageStopDate;
        }
        const insertedReceipt = await collection.insertOne(receipts);
        if (insertedReceipt && insertedReceipt.ops) {
            await this.updateSequenceNumber(receipts.receiptSequenceNumber + 1, mySbMsg.merchantID);
            context.log(insertedReceipt.ops[0]);
            let pointOfService;
            if (mySbMsg.pointOfServiceID)
                pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${mySbMsg.pointOfServiceID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.DEVICE_API_KEY
                    }
                });
            if (!pointOfService) {
                if (customer && customer.mobilePhone) {
                    context.log('send sms message to topic');
                    await this.sendSms(customer.mobilePhone, receipts._id, merchant._id, context);
                }
                if (customer && customer.email) {
                    context.log('send email message to topic');
                    await this.sendEmail(customer.email, receipts._id, context);
                }
            }
            if (customer && pointOfService && pointOfService.cartSettings) {
                if (customer.mobilePhone && pointOfService.cartSettings.sendReceiptBySMS === true) {
                    context.log('send sms message to topic');
                    await this.sendSms(customer.mobilePhone, receipts._id, merchant._id, context);
                }
                if (customer.email && pointOfService.cartSettings.sendReceiptByEmail === true) {
                    context.log('send email message to topic');
                    await this.sendEmail(customer.email, receipts._id, context);
                }
            }
            if (pointOfService) {
                if (pointOfService.printSettings && Array.isArray(pointOfService.printSettings)) {
                    for (let i = 0; i < pointOfService.printSettings.length; i++) {
                        const element = pointOfService.printSettings[i];
                        if (element.printThis === 'receipts') {
                            const samplePrintData = await collection.findOne({ docType: 'printDataTemplate', merchantID: mySbMsg.merchantID, printType: 'receipts' });
                            if (!samplePrintData) {
                                context.log('printDataTemplate not exist');
                                return Promise.resolve();
                            }
                            const printDataDoc = {
                                msgType: 'printData',
                                toPointOfServiceID: element.printOnPointOfServiceID,
                                toPointOfServiceName: element.printOnPointOfServiceName,
                                printItems: samplePrintData.printItems
                            };

                            const printData = await this.setValuesInprintData(printDataDoc, receipts);

                            context.log(printData);
                            await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_PRINT_THIS, printData);
                        }
                    }
                }
            }
        }

    } catch (error) {
        context.log(error);
    }
    return Promise.resolve();
};

exports.setValuesInprintData = async (printDataDoc, receipts) => {

    const printData = Object.assign({}, printDataDoc);
    let index = 0;
    for (let x = 0; x < printDataDoc.printItems.length; x++) {
        const printItem = printData.printItems[x];
        delete printItem.item;
        for (const key in printItem) {
            if (Object.hasOwnProperty.call(printItem, key)) {
                const val = printItem[key];
                if (typeof val === 'string' && val.includes('{') && val.includes('}') && val.includes('lineItems')) {
                    index = 0;
                    for (let r = 0; r < receipts.lineItems.length; r++) {
                        const oneElement = receipts.lineItems[r];
                        if (oneElement.lineItemTypeCode === 'sales') {
                            if (oneElement.lineText && oneElement.lineText.length > 20)
                                oneElement.lineText = oneElement.lineText.substring(0, 20);
                            const keyText = `${oneElement.lineText}${Array(20 - oneElement.lineText.length).fill('\xa0')
                                .join('')} ${oneElement.quantity}${Array(7 - oneElement.quantity.toString().length).fill('\xa0')
                                .join('')}${oneElement.pricePerUnit}${Array(7 - oneElement.pricePerUnit.toString().length).fill('\xa0')
                                .join('')}${oneElement.amount}`;
                            const insertedItem = Object.assign({}, printItem, {
                                [key]: keyText
                            });
                            const lineFeed = {
                                type: 'lineFeed'
                            };
                            const insertedIndex = x + index;
                            if (r > 0)
                                printData.printItems.splice(insertedIndex, 0, insertedItem, lineFeed);
                            else
                                printItem[key] = keyText;
                            index = index + 2;
                        }
                    }
                } else if (typeof val === 'string' && val.includes('{') && val.includes('}') && val.includes('vatSummary')) {
                    index = 0;
                    for (let v = 0; v < receipts.vatSummary.length; v++) {
                        const oneVat = receipts.vatSummary[v];
                        const keyText = `${oneVat.vatPercent}%    ${oneVat.vatAmount}`;
                        const insertedItem = Object.assign({}, printItem, {
                            [key]: keyText
                        });
                        const lineFeed = {
                            type: 'lineFeed'
                        };
                        const insertedIndex = x + index;
                        if (v > 0)
                            printData.printItems.splice(insertedIndex, 0, insertedItem, lineFeed);
                        else
                            printItem[key] = keyText;
                        index = index + 2;
                    }
                } else if (typeof val === 'string' && val.includes('{') && val.includes('}')) {
                    let variable = printItem[key].replace('{', '');
                    variable = variable.replace('}', '');
                    const variableArr = variable.split('.');
                    let acctualVal, receiptVal;
                    for (let y = 0; y < variableArr.length; y++) {
                        if (y === 0) {
                            receiptVal = receipts[variableArr[y]];
                            acctualVal = receiptVal;
                        } else if (receiptVal) {
                            acctualVal = '';
                            let innerObj;
                            if (Array.isArray(receiptVal)) {
                                receiptVal.forEach(eleObj => {
                                    innerObj = eleObj;
                                });
                            } else
                                innerObj = receiptVal;
                            for (const eleKey in innerObj) {
                                if (eleKey === variableArr[y])
                                    acctualVal = innerObj[eleKey];
                            }
                            receiptVal = acctualVal;
                        }
                    }
                    if (val.includes('receiptDate') && acctualVal)
                        acctualVal = moment(acctualVal).format('YYYY-MM-DD HH:mm:ss');
                    if (!isNaN(acctualVal))
                        acctualVal = acctualVal.toString();
                    printItem[key] = acctualVal;
                    if (key === 'receiptURL')
                        printItem[key] = `${process.env.RECEIPT_LINK}/receipt/${receipts._id}`;
                }
            }
        }
    }
    return printData;
};

exports.updateSequenceNumber = async (updatedSequenceNumber, merchantID) => {

    const collection = await getMongodbCollection('Orders');
    const result = await collection.updateOne({
        partitionKey: merchantID,
        docType: 'receiptSequenceNumber'
    }, {
        $set: {
            sequenceNumber: updatedSequenceNumber,
            updatedDate: new Date()
        }
    });
    return result;

};

exports.getSequenceNumber = async (merchantID) => {

    const collection = await getMongodbCollection('Orders');
    let result = await collection.findOne({ docType: 'receiptSequenceNumber', partitionKey: merchantID });
    if (!result) {
        const sequenceNumber = await collection.insertOne({
            _id: uuid.v4(),
            docType: 'receiptSequenceNumber',
            partitionKey: merchantID,
            sequenceNumber: 1,
            merchantID: merchantID,
            createdDate: new Date(),
            updatedDate: new Date()
        });
        result = sequenceNumber.ops[0];
    }
    return result;

};

exports.sendSms = (mobilePhone, receiptID, merchantID, context) => {
    const notificationDoc = {};
    notificationDoc._id = uuid.v4();
    notificationDoc.docType = 'notification';
    notificationDoc.receiver = {};
    notificationDoc.receiver.receiverPhone = mobilePhone;
    notificationDoc.templateFields = {
        receiptURL: `${process.env.RECEIPT_LINK}/receipt/${receiptID}`
    };
    notificationDoc.template = 'receipt';
    notificationDoc.merchantID = merchantID;
    notificationDoc.notificationType = 'sms';
    notificationDoc.countryCode = 'SE';
    notificationDoc.createdDate = new Date();
    notificationDoc.updatedDate = new Date();
    notificationDoc.sentDate = new Date();
    context.log('send sms to topic');
    context.log(notificationDoc);
    utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_NOTIFICATION_SMS, notificationDoc);
};

exports.sendEmail = (email, receiptID, context) => {
    const notificationDoc = {};
    notificationDoc._id = uuid.v4();
    notificationDoc.docType = 'notification';
    notificationDoc.receiver = {};
    notificationDoc.receiver.receiverMail = email;
    notificationDoc.templateFields = {
        receiptURL: `${process.env.RECEIPT_LINK}/receipt/${receiptID}`
    };
    notificationDoc.template = 'receipt';
    notificationDoc.notificationType = 'email';
    notificationDoc.countryCode = 'SE';
    notificationDoc.createdDate = new Date();
    notificationDoc.updatedDate = new Date();
    notificationDoc.sentDate = new Date();
    notificationDoc.messageSubject = 'Receipt';
    context.log('send email to topic');
    context.log(notificationDoc);
    utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_NOTIFICATION_EMAIL, notificationDoc);
};

exports.calculateValues = async (posSession, context) => {
    let usageTotalVolume = 0, usageTotalTimeMinutes = 0;
    if (posSession.usageRecords)
        posSession.usageRecords.forEach(usageRecord => {
            let usageTotalTimeMinute;
            if (usageRecord.usageStopValue !== undefined && usageRecord.usageStartValue !== undefined)
                usageTotalVolume = usageTotalVolume + (usageRecord.usageStopValue - usageRecord.usageStartValue);
            if (usageRecord.usageStopDate && usageRecord.usageStartDate) {
                usageTotalTimeMinute = new Date(usageRecord.usageStopDate) - new Date(usageRecord.usageStartDate);
                context.log('usageTotalTimeMinute = ' + usageTotalTimeMinute);
                usageTotalTimeMinutes = usageTotalTimeMinutes + (usageTotalTimeMinute / (60 * 1000));
                context.log('usageTotalTimeMinutes = ' + usageTotalTimeMinutes);
            }
        });
    return { usageTotalVolume, usageTotalTimeMinutes };
};