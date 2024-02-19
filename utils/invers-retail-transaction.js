'use strict';


const uuid = require('uuid');
const retailTransactionUtils = require('../utils/retail-transaction-pos');
const { getMongodbCollection } = require('../db/mongodb');



exports.createRetailTransActions = async (oldRetailTransaction, refundAmount) => {
    const pointOfService = await retailTransactionUtils.getPointOfService(oldRetailTransaction.pointOfServiceID);
    const pspTypes = await retailTransactionUtils.getPspTypes();

    const retailTransaction = {};
    retailTransaction._id = uuid.v4();
    retailTransaction.partitionKey = retailTransaction._id;
    retailTransaction.docType = 'retailTransaction';
    retailTransaction.retailTransactionDate = new Date();
    retailTransaction.retailTransactionStatusCode = 'Refunded';
    retailTransaction.retailTransactionStatusText = 'Refunded';
    retailTransaction.retailTransactionTypeCode = 'Refunded';
    retailTransaction.pspType = oldRetailTransaction.pspType;
    if (pspTypes && pspTypes.pspTypes) {
        pspTypes.pspTypes.forEach(element => {
            if (element.pspType.toLowerCase() === oldRetailTransaction.pspType.toLowerCase()) {
                retailTransaction.pspTypeName = element.pspTypeName;
                retailTransaction.pspTypeIconURL = element.pspTypeIconURL;
            }
        });
    }
    if (oldRetailTransaction.walletID)
        retailTransaction.walletID = oldRetailTransaction.walletID;
    retailTransaction.lineItems = new Array({
        lineItemTypeCode: 'Refunded',
        seqNo: 1,
        amount: refundAmount
    });
    
    retailTransaction.debitTotal = refundAmount;
    if (retailTransaction.debitTotal)
        retailTransaction.debitTotal = Number(retailTransaction.debitTotal.toFixed(2));
    retailTransaction.creditTotal = 0;
    retailTransaction.amountDiff = retailTransaction.debitTotal - retailTransaction.creditTotal;
    if (retailTransaction.amountDiff)
        retailTransaction.amountDiff = Number(retailTransaction.amountDiff.toFixed(2));
    let merchant, businessUnit;
    if (pointOfService) {
        merchant = await retailTransactionUtils.getMerchants(pointOfService.merchantID);
        businessUnit = await retailTransactionUtils.getBusinessUnit(pointOfService.businessUnitID);
        retailTransaction.merchantID = pointOfService.merchantID;
        retailTransaction.businessUnitID = pointOfService.businessUnitID;
        retailTransaction.pointOfServiceID = oldRetailTransaction.pointOfServiceID;
        retailTransaction.pointOfServiceName = oldRetailTransaction.pointOfServiceName;
        if (pointOfService.accessControl) {
            retailTransaction.siteID = pointOfService.accessControl.siteID;
            retailTransaction.siteName = pointOfService.accessControl.siteName;
            retailTransaction.zoneID = pointOfService.accessControl.zoneID;
            retailTransaction.zoneName = pointOfService.accessControl.zoneName;
        }
    }
    if (merchant) {
        retailTransaction.merchantName = merchant.merchantName;
        retailTransaction.merchantCompanyRegistrationNumber = merchant.merchantCompanyRegistrationNumber;
        retailTransaction.merchantVatNumber = merchant.merchantVatNumber;
        retailTransaction.merchantLogoImageURL = merchant.merchantLogoImageURL;
    }
    if (businessUnit && Array.isArray(businessUnit) && businessUnit.length > 0) {
        businessUnit = businessUnit[0];
        retailTransaction.businessUnitName = businessUnit.businessUnitName;
        retailTransaction.companyRegistrationNumber = businessUnit.companyRegistrationNumber;
        retailTransaction.vatNumber = businessUnit.vatNumber;
    }
    let vatPercents = 0, count = 0;
    if (oldRetailTransaction.lineItems && Array.isArray(oldRetailTransaction.lineItems)) {
        oldRetailTransaction.lineItems.forEach(element => {
            if (element.lineItemTypeCode === 'sales') {
                vatPercents = vatPercents + element.vatPercent;
                count ++;
            }
        });
    }
    const vatPercent = vatPercents / count;
    const vatAmount = Number((refundAmount - (refundAmount / ((vatPercent / 100) + 1))).toFixed(2));
    retailTransaction.totalAmountInclVat = Number((-1 * refundAmount).toFixed(2));
    retailTransaction.totalVatAmount = Number((-1 * vatAmount).toFixed(2));
    retailTransaction.currency = oldRetailTransaction.currency;
    retailTransaction.createdDate = new Date();
    retailTransaction.updatedDate = new Date();
    const collection = await getMongodbCollection('Orders');
    const response = await collection.insertOne(retailTransaction);
    return response;
};