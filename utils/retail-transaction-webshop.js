'use strict';


const uuid = require('uuid');
const utils = require('../utils');
const { getMongodbCollection } = require('../db/mongodb');
const apisCallUtils = require('./retail-transaction-pos');



exports.createRetailTransActions = async (checkoutSession, customerInfoMasked, context, reqData) => {

    const products = await apisCallUtils.getProducts(checkoutSession.products);
    let webShop, quickShop, sequenceNumber, pointOfService;
    if (checkoutSession.quickShopID) {
        quickShop = await apisCallUtils.getWebShop(checkoutSession.webShopID, checkoutSession.quickShopID);
        if (quickShop && quickShop.evCharging) {
            pointOfService = await apisCallUtils.getPointOfService(quickShop.evCharging.pointOfServiceID);
        }
    }
    if (checkoutSession.webShopID)
        webShop = await apisCallUtils.getWebShop(checkoutSession.webShopID, checkoutSession.quickShopID);

    const pspTypes = await apisCallUtils.getPspTypes();

    if (webShop)
        sequenceNumber = await apisCallUtils.getSequenceNumber(webShop.ownerMerchantID);

    const retailTransaction = {};
    retailTransaction._id = uuid.v4();
    retailTransaction.partitionKey = retailTransaction._id;
    retailTransaction.docType = 'retailTransaction';
    retailTransaction.retailTransactionDate = new Date();
    retailTransaction.retailTransactionStatusCode = 'Paid';
    retailTransaction.retailTransactionStatusText = 'Paid';
    if (reqData && reqData.shop === 'quickshop') {
        retailTransaction.retailTransactionStatusCode = 'pending';
        retailTransaction.retailTransactionStatusText = 'pending';
    }
    if (pointOfService) {
        retailTransaction.pointOfServiceID = pointOfService._id;
        retailTransaction.businessUnitID = pointOfService.businessUnitID;
    }
    if (pointOfService.businessUnitID) {
        let businessUnit = await apisCallUtils.getBusinessUnit(pointOfService.businessUnitID);
        if (businessUnit && Array.isArray(businessUnit) && businessUnit.length > 0) {
            businessUnit = businessUnit[0];
            retailTransaction.businessUnitName = businessUnit.businessUnitName;
            retailTransaction.companyRegistrationNumber = businessUnit.companyRegistrationNumber;
            retailTransaction.vatNumber = businessUnit.vatNumber;
        }
    }
    retailTransaction.retailTransactionTypeCode = 'sale';
    retailTransaction.checkoutSessionID = checkoutSession._id;
    if (checkoutSession.acquirer_tx_id)
        retailTransaction.acquirer_tx_id = checkoutSession.acquirer_tx_id;
    if (checkoutSession.end_to_end_id)
        retailTransaction.end_to_end_id = checkoutSession.end_to_end_id;
    retailTransaction.checkoutSessionDoc = Object.assign({}, checkoutSession);
    if (reqData && reqData.sessionID)
        retailTransaction.sessionID = reqData.sessionID;
    if (checkoutSession.paymentTransactionResponse)
        retailTransaction.paymentId = checkoutSession.paymentTransactionResponse.paymentId;
    retailTransaction.paymentProviderAccountID = checkoutSession.paymentProviderAccountID;
    retailTransaction.pspType = checkoutSession.pspType;
    if (customerInfoMasked)
        retailTransaction.customerInfoMasked = customerInfoMasked;
    if (context)
        context.log('retailTransaction.customerInfoMasked = ' + retailTransaction.customerInfoMasked);
    if (pspTypes && pspTypes.pspTypes && checkoutSession.pspType) {
        pspTypes.pspTypes.forEach(element => {
            if (element.pspType.toLowerCase() === checkoutSession.pspType.toLowerCase()) {
                retailTransaction.pspTypeName = element.pspTypeName;
                retailTransaction.pspTypeIconURL = element.pspTypeIconURL;
            }
        });
    }
    if (checkoutSession.walletID)
        retailTransaction.walletID = checkoutSession.walletID;
    retailTransaction.lineItems = new Array();
    let totalAmountInclVat = 0, totalVatAmount = 0, totalAmountExclVat = 0;
    if (checkoutSession.products && checkoutSession.products.length && checkoutSession.products.length > 0) {
        retailTransaction.itemText = products[0].productName;
        const productsWithDiffVatClass = [];
        let seqNo = 1;
        let amount = 0;
        checkoutSession.products.forEach(product => {
            const diffVatClasses = [];
            let oneFullProduct = products.filter(x => x._id === product.productID);
            const lineItem = {};
            lineItem.lineItemTypeCode = 'sales';
            lineItem.seqNo = seqNo;
            lineItem.lineText = product.productName;
            if (product.amount)
                product.salesPrice = product.amount;
            lineItem.quantity = product.quantity;
            lineItem.pricePerUnit = product.pricePerUnit ? product.pricePerUnit : product.salesPrice;
            if (oneFullProduct && Array.isArray(oneFullProduct) && oneFullProduct.length > 0) {
                oneFullProduct = oneFullProduct[0];
                if (!product.vatAmount)
                    product.vatAmount = Number((product.salesPrice - (product.salesPrice / ((oneFullProduct.vatPercent / 100) + 1))).toFixed(2));
                lineItem.productClass = oneFullProduct.productClass;
                lineItem.productClassName = oneFullProduct.productClassName;
                if (diffVatClasses.includes(oneFullProduct.vatClass)) {
                    oneFullProduct.productsWithDiffVatClassVatAmount = oneFullProduct.productsWithDiffVatClassVatAmount + (product.vatAmount * product.quantity);
                    if (oneFullProduct.productsWithDiffVatClassVatAmount)
                        oneFullProduct.productsWithDiffVatClassVatAmount = Number(oneFullProduct.productsWithDiffVatClassVatAmount.toFixed(2));
                    oneFullProduct.productsWithDiffVatClassAmount = oneFullProduct.productsWithDiffVatClassAmount + (product.salesPrice * product.quantity);
                    if (oneFullProduct.productsWithDiffVatClassAmount)
                        oneFullProduct.productsWithDiffVatClassAmount = Number(oneFullProduct.productsWithDiffVatClassAmount.toFixed);
                } else {
                    oneFullProduct.productsWithDiffVatClassVatAmount = (product.vatAmount * product.quantity);
                    if (oneFullProduct.productsWithDiffVatClassVatAmount)
                        oneFullProduct.productsWithDiffVatClassVatAmount = Number(oneFullProduct.productsWithDiffVatClassVatAmount.toFixed(2));
                    oneFullProduct.productsWithDiffVatClassAmount = (product.salesPrice * product.quantity);
                    if (oneFullProduct.productsWithDiffVatClassAmount)
                        oneFullProduct.productsWithDiffVatClassAmount = Number(oneFullProduct.productsWithDiffVatClassAmount.toFixed(2));
                    productsWithDiffVatClass.push(oneFullProduct);
                    diffVatClasses.push(oneFullProduct.vatClass);
                }
                lineItem.unitCode = oneFullProduct.unitCode;
                lineItem.unitSymbol = oneFullProduct.unitCode;
                lineItem.unitName = oneFullProduct.unitName;
                lineItem.vatClass = oneFullProduct.vatClass;
                lineItem.sales = {
                    productID: oneFullProduct._id,
                    productName: oneFullProduct.productName,
                    productImageURL: oneFullProduct.productImageURL,
                    productTypeID: oneFullProduct.productTypeID,
                    productTypeCode: oneFullProduct.productTypeCode,
                    productTypeName: oneFullProduct.productTypeName,
                    productTypeIconURL: oneFullProduct.productTypeIconURL,
                    productCategoryID: oneFullProduct.productCategoryID,
                    productCategoryName: oneFullProduct.productCategoryName,
                    productCategoryIconURL: oneFullProduct.productCategoryIconURL,
                    issuer: oneFullProduct.issuer,
                    priceType: oneFullProduct.priceType,
                    priceGroupID: oneFullProduct.priceGroupID,
                    priceGroupName: oneFullProduct.priceGroupName
                };
            }
            lineItem.amount = (product.salesPrice * product.quantity);
            if (lineItem.amount)
                lineItem.amount = Number(lineItem.amount.toFixed(2));
            totalAmountInclVat = totalAmountInclVat + (product.salesPrice * product.quantity);
            if (checkoutSession.totalAmountInclVat)
                totalAmountInclVat = checkoutSession.totalAmountInclVat;
            if (totalAmountInclVat)
                totalAmountInclVat = Number(Number(totalAmountInclVat).toFixed(2));
            lineItem.debit = 0;
            lineItem.credit = (product.salesPrice * product.quantity) - (product.vatAmount * product.quantity);
            if (lineItem.credit)
                lineItem.credit = Number(lineItem.credit.toFixed(2));
            lineItem.vatAmount = (product.vatAmount * product.quantity);
            if (lineItem.vatAmount)
                lineItem.vatAmount = Number(lineItem.vatAmount.toFixed(2));
            totalVatAmount = totalVatAmount + lineItem.vatAmount;
            if (totalVatAmount)
                totalVatAmount = Number(totalVatAmount.toFixed(2));
            lineItem.amountExclVat = (product.salesPrice * product.quantity) - (product.vatAmount * product.quantity);
            if (lineItem.amountExclVat)
                lineItem.amountExclVat = Number(lineItem.amountExclVat.toFixed(2));
            totalAmountExclVat = totalAmountExclVat + lineItem.amountExclVat;
            if (totalAmountExclVat)
                totalAmountExclVat = Number(totalAmountExclVat);
            lineItem.vatPercent = product.vatPercent,
            retailTransaction.lineItems.push(lineItem);
            seqNo++;
            amount = amount + (product.salesPrice * product.quantity);
            if (amount)
                amount = Number(amount.toFixed(2));
        });
        retailTransaction.lineItems.push({
            lineItemTypeCode: 'payment',
            seqNo: seqNo,
            lineText: checkoutSession.pspType,
            amount: amount,
            debit: amount,
            credit: 0,
            payment: {
                paymentTransactionID: uuid.v4(),
                paymentTransactionStatusCode: 'Successful',
                paymentTypeCode: checkoutSession.pspType,
                paymentProviderID: uuid.v4(),
                pspName: retailTransaction.pspTypeName,
                pspType: checkoutSession.pspType
            }
        });
        seqNo++;
        const sameVatClassWithDiffProduct = [];
        retailTransaction.vatSummary = new Array();
        productsWithDiffVatClass.forEach(element => {
            if (sameVatClassWithDiffProduct.includes(element.vatClass)) {
                let sameVatClassEle = retailTransaction.lineItems.filter(x => (x.vatClass === element.vatClass && x.lineItemTypeCode === 'vat'));
                sameVatClassEle = sameVatClassEle[0];
                sameVatClassEle.amount += element.productsWithDiffVatClassAmount;
                sameVatClassEle.vatAmount += element.productsWithDiffVatClassVatAmount;
                sameVatClassEle.amountExclVat += element.productsWithDiffVatClassAmount - element.productsWithDiffVatClassVatAmount;
                sameVatClassEle.credit += element.productsWithDiffVatClassVatAmount;
                let sameVatSumEle = retailTransaction.vatSummary.filter(x => x.vatClass === element.vatClass);
                sameVatSumEle = sameVatSumEle[0];
                sameVatSumEle.vatAmount += element.productsWithDiffVatClassVatAmount;
            } else {
                retailTransaction.lineItems.push({
                    lineItemTypeCode: 'vat',
                    seqNo: seqNo,
                    lineText: 'VAT',
                    vatClass: element.vatClass,
                    vatPercent: element.vatPercent,
                    amount: element.productsWithDiffVatClassAmount,
                    vatAmount: element.productsWithDiffVatClassVatAmount,
                    amountExclVat: element.productsWithDiffVatClassAmount - element.productsWithDiffVatClassVatAmount,
                    credit: element.productsWithDiffVatClassVatAmount,
                    debit: 0
                });
                seqNo++;
                retailTransaction.vatSummary.push({
                    vatClass: element.vatClass,
                    vatPercent: element.vatPercent,
                    vatAmount: element.productsWithDiffVatClassVatAmount
                });
                sameVatClassWithDiffProduct.push(element.vatClass);
            }
        });
        if (checkoutSession.discounts && Array.isArray(checkoutSession.discounts)) {
            checkoutSession.discounts.forEach(element => {
                if (element && element.discountCode) {
                    retailTransaction.lineItems.push({
                        lineItemTypeCode: 'discount',
                        seqNo: seqNo,
                        lineText: element.discountCode,
                        amount: checkoutSession.totalAmountInclVat - checkoutSession.totalAmountInclVatAfterDiscount,
                        vatAmount: checkoutSession.totalVatAmount - checkoutSession.totalVatAmountAfterDiscount,
                        amountExclVat: (checkoutSession.totalAmountInclVat - checkoutSession.totalAmountInclVatAfterDiscount) - (checkoutSession.totalVatAmount - checkoutSession.totalVatAmountAfterDiscount),
                        credit: 0,
                        debit: totalAmountExclVat - (checkoutSession.totalAmountInclVatAfterDiscount - checkoutSession.totalVatAmountAfterDiscount)
                    });
                }
            });
        }
    }
    let debitTotal = 0, creditTotal = 0;
    retailTransaction.lineItems.forEach(element => {
        if (element.debit) {
            debitTotal = debitTotal + element.debit;
        }
        if (element.credit) {
            creditTotal = creditTotal + element.credit;
        }
    });
    retailTransaction.debitTotal = Number(debitTotal.toFixed(2));
    retailTransaction.creditTotal = Number(creditTotal.toFixed(2));
    retailTransaction.amountDiff = Number((debitTotal - creditTotal).toFixed(2));
    if (retailTransaction.amountDiff !== 0) {
        retailTransaction.lineItems.push({
            lineItemTypeCode: 'rounding',
            credit: Math.round(creditTotal),
            debit: Math.round(debitTotal)
        });
    }
    let merchant;
    
    if (webShop) {
        retailTransaction.merchantID = webShop.ownerMerchantID;
        merchant = await apisCallUtils.getMerchants(webShop.ownerMerchantID);
        retailTransaction.webShopID = checkoutSession.webShopID;
        retailTransaction.webShopTitle = webShop.webShopTitle;
        retailTransaction.pointOfServiceName = webShop.webShopTitle;
        retailTransaction.salesChannelName = webShop.webShopTitle;
        retailTransaction.salesChannelTypeCode = 'webshop';
    } else if (quickShop) {
        retailTransaction.merchantID = quickShop.merchantID;
        merchant = await apisCallUtils.getMerchants(quickShop.merchantID);
        retailTransaction.quickShopID = checkoutSession.quickShopID;
        retailTransaction.quickShopTitle = quickShop.quickShopName;
        retailTransaction.pointOfServiceName = quickShop.quickShopName;
        retailTransaction.salesChannelName = quickShop.quickShopName;
        retailTransaction.salesChannelTypeCode = 'quickshop';
    }
    if (merchant) {
        retailTransaction.merchantName = merchant.merchantName;
        retailTransaction.merchantCompanyRegistrationNumber = merchant.merchantCompanyRegistrationNumber;
        retailTransaction.merchantVatNumber = merchant.vatNumber;
        retailTransaction.merchantLogoImageURL = merchant.merchantLogoImageURL;
    }
    
    if (sequenceNumber) {
        if (sequenceNumber.sequenceNumber === 9999999999) {
            sequenceNumber.sequenceNumber = 1;
        }
        retailTransaction.sequenceNumber = sequenceNumber.sequenceNumber;
    }
    retailTransaction.totalAmountInclVat = Number(Number(totalAmountInclVat).toFixed(2));
    retailTransaction.totalVatAmount = Number(totalVatAmount.toFixed(2));
    retailTransaction.currency = checkoutSession.currency;
    retailTransaction.customerID = checkoutSession.customerID;
    if (!retailTransaction.customerID) {
        const customer = await apisCallUtils.linkedCustomer(checkoutSession, retailTransaction.currency, retailTransaction.merchantID, context);
        retailTransaction.customerID = customer._id;
    }
    retailTransaction.createdDate = new Date();
    retailTransaction.updatedDate = new Date();
    const collection = await getMongodbCollection('Orders');
    if (checkoutSession.posSessionID) {
        const posSession = await collection.findOne({ _id: checkoutSession.posSessionID });
        retailTransaction.posSessionID = checkoutSession.posSessionID;
        retailTransaction.docType = 'retailTransactionPending';
        retailTransaction.componentID = posSession.componentID;
        retailTransaction.componentName = posSession.componentName;
    }
    const response = await collection.insertOne(retailTransaction);
    if (response && response.ops) {
        if (context)
            context.log(response.ops[0]);
        //if (!checkoutSession.posSessionID)
        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_RETAIL_TRANSACTIONS, response.ops[0]);
        if (webShop)
            await apisCallUtils.updateSequenceNumber(retailTransaction.sequenceNumber + 1, webShop.ownerMerchantID);
        return response.ops[0];
    }
};