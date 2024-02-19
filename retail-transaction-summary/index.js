'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const request = require('request-promise');

//Please refer the story BASE-294 for more details

module.exports = async (context, req) => {
    
    try {
        context.log(JSON.stringify(req.body));
        const collection = await getMongodbCollection('Orders');

        const query = {
            docType: 'retailTransaction',
            merchantID: req.body.merchantID
        };
        if (req.body.currency) {
            query.currency = req.body.currency;
        }
        if (req.body.pointOfServiceID) {
            query.pointOfServiceID = req.body.pointOfServiceID;
        }
        if (req.body.businessUnitID) {
            query.businessUnitID = req.body.businessUnitID;
        }
        if (req.body.siteID) {
            query.siteID = req.body.siteID;
        }
        if (req.body.zoneID) {
            query.zoneID = req.body.zoneID;
        }
        if (req.body.customerID) {
            query.customerID = req.body.customerID;
        }
        if (req.body.status) {
            query.retailTransactionStatusCode = req.body.status;
        }
        if (req.body.paymentType) {
            query.pspType = req.body.paymentType;
        }
        if (req.body.transactionID) {
            query._id = req.body.transactionID;
            query.partitionKey = req.body.transactionID;
        }
        if (req.body.itemText) {
            query.itemText = new RegExp(req.body.itemText);
        }
        if (req.body.customerInfoMasked) {
            query.customerInfoMasked = { '$regex': new RegExp('.*' + req.body.customerInfoMasked + '.*', 'i') };
        }
        if (req.body.fromDate && req.body.toDate) {
            let fromDate = new Date(req.body.fromDate);
            fromDate = fromDate.setHours(0, 0, 1);
            let toDate = new Date(req.body.toDate);
            toDate = toDate.setHours(23, 59, 59);
            query.retailTransactionDate = {
                $gte: fromDate,
                $lte: toDate
            };
        }
        context.log(JSON.stringify(query));

        const retailTransactions = await collection.find(query).toArray();
        
        context.log(retailTransactions.length);
        let retailTransactionSummary;

        if (retailTransactions)
            retailTransactionSummary = await this.createRetailTransactionSummary(req.body, retailTransactions);

        context.res = {
            body: retailTransactionSummary
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.createRetailTransactionSummary = async (body, retailTransactions) => {

    const retailTransactionSummary = {};

    if (retailTransactions && Array.isArray(retailTransactions)) {

        const vatClasses = [], paymentTypeCodes = [], productTypeCodes = [],
            productCategoryIDs = [], lineItemTypeCodes = [];

        for (let i = 0; i < retailTransactions.length; i++) {

            const retailTransaction = retailTransactions[i];
            if (retailTransaction.lineItems && retailTransaction.lineItems.length) {
                if (i === 0) {
                    
                    if (body.businessUnitID) {
                        retailTransactionSummary.businessUnitID = retailTransaction.businessUnitID;
                        retailTransactionSummary.businessUnitName = retailTransaction.businessUnitName;
                    }
                    if (body.pointOfServiceID) {
                        retailTransactionSummary.pointOfServiceID = retailTransaction.pointOfServiceID;
                        retailTransactionSummary.pointOfServiceName = retailTransaction.pointOfServiceName;
                        retailTransactionSummary.siteID = retailTransaction.siteID;
                        retailTransactionSummary.siteName = retailTransaction.siteName;
                        retailTransactionSummary.zoneID = retailTransaction.zoneID;
                        retailTransactionSummary.zoneName = retailTransaction.zoneName;
                    }
                    retailTransactionSummary.reportStartDate = new Date(body.fromDate);
                    retailTransactionSummary.reportEndDate = new Date(body.toDate);
                    retailTransactionSummary.numberOfRetailTransactions = retailTransactions.length;
                    retailTransactionSummary.totalAmountInclVat = 0;
                    retailTransactionSummary.totalVatAmount = 0;
                    retailTransactionSummary.vatSummary = [];
                    retailTransactionSummary.paymentTypeSummary = [];
                    retailTransactionSummary.productTypeSummary = [];
                    retailTransactionSummary.productCategorySummary = [];
                    retailTransactionSummary.lineItemSummary = [];
                    retailTransactionSummary.retailTransactions = [];
                }
                if (paymentTypeCodes.includes(retailTransaction.pspType)) {
                    const existedEle = retailTransactionSummary.paymentTypeSummary.find(x => x.paymentTypeCode === retailTransaction.pspType);
                    existedEle.amount = Number(retailTransaction.totalAmountInclVat ? retailTransaction.totalAmountInclVat : 0) + Number(existedEle.amount);
                    existedEle.vatAmount = Number(retailTransaction.totalVatAmount ? retailTransaction.totalVatAmount : 0) + Number(existedEle.vatAmount);
                    existedEle.netAmount = existedEle.amount - existedEle.vatAmount;
                    existedEle.transactions = existedEle.transactions + 1;
                    existedEle.amount = Number(existedEle.amount.toFixed(2));
                    existedEle.vatAmount = Number(existedEle.vatAmount.toFixed(2));
                    existedEle.netAmount = Number(existedEle.netAmount.toFixed(2));
                } else {
                    retailTransaction.totalAmountInclVat = retailTransaction.totalAmountInclVat ? Number(retailTransaction.totalAmountInclVat.toFixed(2)) : 0;
                    retailTransaction.totalVatAmount = retailTransaction.totalVatAmount ? Number(retailTransaction.totalVatAmount.toFixed(2)) : 0;
                    retailTransaction.netAmount = retailTransaction.totalAmountInclVat - retailTransaction.totalVatAmount;
                    retailTransactionSummary.paymentTypeSummary.push({
                        paymentTypeCode: retailTransaction.pspType,
                        amount: retailTransaction.totalAmountInclVat ? retailTransaction.totalAmountInclVat : 0,
                        vatAmount: retailTransaction.totalVatAmount ? retailTransaction.totalVatAmount : 0,
                        netAmount: retailTransaction.netAmount ? retailTransaction.netAmount : 0,
                        transactions: 1,
                        paymentTypeName: retailTransaction.pspName
                    });
                    paymentTypeCodes.push(retailTransaction.pspType);
                }
                if (retailTransaction.vatSummary)
                    for (let j = 0; j < retailTransaction.vatSummary.length; j++) {
                        const element = retailTransaction.vatSummary[j];
                        if (vatClasses.includes(element.vatClass)) {
                            const existedEle = retailTransactionSummary.vatSummary.find(x => x.vatClass === element.vatClass);
                            existedEle.vatAmount = element.vatAmount ? Number((element.vatAmount + existedEle.vatAmount).toFixed(2)) : 0;
                        } else {
                            element.vatAmount = element.vatAmount ? Number(element.vatAmount.toFixed(2)) : 0;
                            retailTransactionSummary.vatSummary.push(element);
                            vatClasses.push(element.vatClass);
                        }

                    }

                let netAmountCalc = retailTransaction.totalAmountInclVat - retailTransaction.totalVatAmount;
                netAmountCalc = Number(netAmountCalc.toFixed(2));
                retailTransactionSummary.retailTransactions.push({
                    retailTransactionID: retailTransaction._id,
                    createdDate: retailTransaction.createdDate,
                    amount: retailTransaction.totalAmountInclVat,
                    vatAmount: retailTransaction.totalVatAmount,
                    netAmount: netAmountCalc,
                    itemText: retailTransaction.itemText,
                    authorisationCode: retailTransaction.authorisationCode,
                    customerInfoMasked: retailTransaction.customerInfoMasked
                });

                if (retailTransaction.lineItems) {
                    for (let j = 0; j < retailTransaction.lineItems.length; j++) {
                        const element = retailTransaction.lineItems[j];
                    
                        if (element.lineItemTypeCode === 'sales' && element.sales) {
                            if (productTypeCodes.includes(element.sales.productTypeCode)) {
                                const existedEle = retailTransactionSummary.productTypeSummary.find(x => x.productTypeCode === element.sales.productTypeCode);
                                existedEle.amount = Number(element.amount ? element.amount : 0) + Number(existedEle.amount);
                                existedEle.transactions = existedEle.transactions + 1;
                                existedEle.amount = Number(existedEle.amount.toFixed(2));
                            } else {
                                element.amount = element.amount ? Number(element.amount.toFixed(2)) : 0;
                                retailTransactionSummary.productTypeSummary.push({
                                    productTypeCode: element.sales.productTypeCode,
                                    amount: element.amount ? element.amount : 0,
                                    transactions: 1,
                                    productTypeName: element.sales.productTypeName
                                });
                                productTypeCodes.push(element.sales.productTypeCode);
                            }
                        }
                        if (element.lineItemTypeCode === 'sales' && element.sales) {
                            if (productCategoryIDs.includes(element.sales.productCategoryID)) {
                                const existedEle = retailTransactionSummary.productCategorySummary.find(x => x.productCategoryID === element.sales.productCategoryID);
                                existedEle.amount = Number(element.amount ? element.amount : 0) + Number(existedEle.amount);
                                existedEle.transactions = existedEle.transactions + 1;
                                existedEle.amount = Number(existedEle.amount.toFixed(2));
                            } else {
                                element.amount = element.amount ? Number(element.amount.toFixed(2)) : 0;
                                retailTransactionSummary.productCategorySummary.push({
                                    productCategoryID: element.sales.productCategoryID,
                                    amount: element.amount ? element.amount : 0,
                                    transactions: 1,
                                    productCategoryName: element.sales.productCategoryName
                                });
                                productCategoryIDs.push(element.sales.productCategoryID);
                            }
                        }
                        if (lineItemTypeCodes.includes(element.lineItemTypeCode)) {
                            const existedEle = retailTransactionSummary.lineItemSummary.find(x => x.lineItemTypeCode === element.lineItemTypeCode);
                            existedEle.amount = Number(element.amount ? element.amount : 0) + Number(existedEle.amount);
                            existedEle.transactions = existedEle.transactions + 1;
                            existedEle.amount = Number(existedEle.amount.toFixed(2));
                        } else {
                            element.amount = element.amount ? Number(element.amount.toFixed(2)) : 0;
                            retailTransactionSummary.lineItemSummary.push({
                                lineItemTypeCode: element.lineItemTypeCode,
                                amount: element.amount ? element.amount : 0,
                                transactions: 1,
                                lineItemTypeName: element.lineText
                            });
                            lineItemTypeCodes.push(element.lineItemTypeCode);
                        }
                    }
                }
                if (retailTransaction.currency)
                    retailTransactionSummary.currency = retailTransaction.currency;
                retailTransactionSummary.totalAmountInclVat = retailTransactionSummary.totalAmountInclVat + (Number(retailTransaction.totalAmountInclVat) ? Number(retailTransaction.totalAmountInclVat) : 0);
                retailTransactionSummary.totalVatAmount = retailTransactionSummary.totalVatAmount + (Number(retailTransaction.totalVatAmount) ? Number(retailTransaction.totalVatAmount) : 0);
                retailTransactionSummary.netAmount = retailTransactionSummary.totalAmountInclVat - retailTransactionSummary.totalVatAmount;
                retailTransactionSummary.totalVatAmount = Number(retailTransactionSummary.totalVatAmount.toFixed(2));
                retailTransactionSummary.totalAmountInclVat = Number(retailTransactionSummary.totalAmountInclVat.toFixed(2));
                retailTransactionSummary.netAmount = Number(retailTransactionSummary.netAmount.toFixed(2));
            }
        }
        const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${body.merchantID}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        });
        if (merchant) {
            retailTransactionSummary.merchantID = merchant._id;
            retailTransactionSummary.merchantName = merchant.merchantName;
            retailTransactionSummary.merchantCompanyRegistrationNumber = merchant.merchantCompanyRegistrationNumber;
            retailTransactionSummary.merchantVatNumber = merchant.merchantVatNumber;
            retailTransactionSummary.merchantLogoImageURL = merchant.merchantLogoImageURL;
        }
    }
    return retailTransactionSummary;
};
