'use strict';


const uuid = require('uuid');
const utils = require('.');
const request = require('request-promise');
const { getMongodbCollection } = require('../db/mongodb');



exports.createRetailTransActions = async (checkoutSession, customerInfoMasked, context, reqData) => {

    const products = await this.getProducts(checkoutSession.products);
    const pointOfService = await this.getPointOfService(checkoutSession.pointOfServiceID);

    const pspTypes = await this.getPspTypes();

    let sequenceNumber;
    if (pointOfService)
        sequenceNumber = await this.getSequenceNumber(pointOfService.merchantID);
    
    const retailTransaction = {};
    retailTransaction._id = uuid.v4();
    retailTransaction.partitionKey = retailTransaction._id;
    retailTransaction.docType = 'retailTransaction';
    retailTransaction.retailTransactionDate = new Date();
    retailTransaction.retailTransactionStatusCode = 'Paid';
    retailTransaction.retailTransactionStatusText = 'Paid';
    if (checkoutSession.transactionResult) {
        retailTransaction.retailTransactionStatusCode = 'failed';
        retailTransaction.retailTransactionStatusText = 'failed';
    }
    retailTransaction.retailTransactionTypeCode = 'sale';
    retailTransaction.checkoutSessionID = checkoutSession._id;
    if (checkoutSession.requesterLocationId)
        retailTransaction.requesterLocationId = checkoutSession.requesterLocationId;
    if (checkoutSession.requesterTransRefNum)
        retailTransaction.requesterTransRefNum = checkoutSession.requesterTransRefNum;
    if (checkoutSession.requesterStationID)
        retailTransaction.requesterStationID = checkoutSession.requesterStationID;
    if (checkoutSession.SCATransRef)
        retailTransaction.SCATransRef = checkoutSession.SCATransRef;
    if (checkoutSession.token)
        retailTransaction.token = checkoutSession.token;
    if (checkoutSession.transactionType)
        retailTransaction.transactionType = checkoutSession.transactionType;
    if (checkoutSession.acquirer_tx_id)
        retailTransaction.acquirer_tx_id = checkoutSession.acquirer_tx_id;
    if (checkoutSession.end_to_end_id)
        retailTransaction.end_to_end_id = checkoutSession.end_to_end_id;
    retailTransaction.checkoutSessionDoc = Object.assign({}, checkoutSession);
    if (reqData && reqData.sessionID)
        retailTransaction.sessionID = reqData.sessionID;
    if (checkoutSession.accountTransactionID)
        retailTransaction.accountTransactionID = checkoutSession.accountTransactionID;
    if (checkoutSession.paymentTransactionResponse)
        retailTransaction.paymentId = checkoutSession.paymentTransactionResponse.paymentId;
    if (checkoutSession.paymentTransactionResponse && checkoutSession.paymentTransactionResponse.bankAuthCode)
        retailTransaction.authorisationCode = checkoutSession.paymentTransactionResponse.bankAuthCode;
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

            lineItem.quantity = product.quantity;
            lineItem.pricePerUnit = product.salesPrice;
            if (oneFullProduct && Array.isArray(oneFullProduct) && oneFullProduct.length > 0) {
                oneFullProduct = oneFullProduct[0];
                lineItem.productClass = oneFullProduct.productClass;
                lineItem.productClassName = oneFullProduct.productClassName;
                if (diffVatClasses.includes(oneFullProduct.vatClass)) {
                    oneFullProduct.productsWithDiffVatClassVatAmount = oneFullProduct.productsWithDiffVatClassVatAmount + product.vatAmount;
                    if (oneFullProduct.productsWithDiffVatClassVatAmount)
                        oneFullProduct.productsWithDiffVatClassVatAmount = Number(oneFullProduct.productsWithDiffVatClassVatAmount.toFixed(2));
                    oneFullProduct.productsWithDiffVatClassAmount = oneFullProduct.productsWithDiffVatClassAmount + (product.salesPrice * product.quantity);
                    if (oneFullProduct.productsWithDiffVatClassAmount)
                        oneFullProduct.productsWithDiffVatClassAmount = Number(oneFullProduct.productsWithDiffVatClassAmount.toFixed);
                } else {
                    oneFullProduct.productsWithDiffVatClassVatAmount = product.vatAmount;
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
                if (pointOfService && pointOfService.accessControl && pointOfService.accessControl.components &&
                    Array.isArray(pointOfService.accessControl.components)) {
                    pointOfService.accessControl.components.forEach(component => {
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
                        lineItem.usageRecord = {
                            componentID: component.componentID,
                            componentName: componentName,
                            usageStartDate: new Date(),
                            usageStopDate: new Date(),
                            unitCode: oneFullProduct.unitCode,
                            binID: product.binID
                        };
                    });
                }
            }
            lineItem.amount = (product.salesPrice * product.quantity);
            if (lineItem.amount)
                lineItem.amount = Number(lineItem.amount.toFixed(2));
            totalAmountInclVat = totalAmountInclVat + (product.salesPrice * product.quantity);
            if (totalAmountInclVat)
                totalAmountInclVat = Number(totalAmountInclVat.toFixed(2));
            lineItem.debit = 0;
            lineItem.credit = (product.salesPrice * product.quantity) - product.vatAmount;
            if (lineItem.credit)
                lineItem.credit = Number(lineItem.credit.toFixed(2));
            lineItem.vatAmount = product.vatAmount;
            if (lineItem.vatAmount)
                lineItem.vatAmount = Number(lineItem.vatAmount.toFixed(2));
            totalVatAmount = totalVatAmount + lineItem.vatAmount;
            if (totalVatAmount)
                totalVatAmount = Number(totalVatAmount.toFixed(2));
            lineItem.amountExclVat = (product.salesPrice * product.quantity) - product.vatAmount;
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
    let merchant, businessUnit;
    if (pointOfService) {
        retailTransaction.merchantID = pointOfService.merchantID;
        merchant = await this.getMerchants(pointOfService.merchantID);
        businessUnit = await this.getBusinessUnit(pointOfService.businessUnitID);
        retailTransaction.businessUnitID = pointOfService.businessUnitID;
        retailTransaction.pointOfServiceID = checkoutSession.pointOfServiceID;
        retailTransaction.pointOfServiceName = checkoutSession.pointOfServiceName;
        if (pointOfService.accessControl) {
            retailTransaction.siteID = pointOfService.accessControl.siteID;
            retailTransaction.siteName = pointOfService.accessControl.siteName;
            retailTransaction.zoneID = pointOfService.accessControl.zoneID;
            retailTransaction.zoneName = pointOfService.accessControl.zoneName;
        }
        retailTransaction.salesChannelName = pointOfService.pointOfServiceName;
        retailTransaction.salesChannelTypeCode = 'pos';
    }
    
    if (merchant) {
        retailTransaction.merchantName = merchant.merchantName;
        retailTransaction.merchantCompanyRegistrationNumber = merchant.merchantCompanyRegistrationNumber;
        retailTransaction.merchantVatNumber = merchant.vatNumber;
        retailTransaction.merchantLogoImageURL = merchant.merchantLogoImageURL;
    }
    if (businessUnit && Array.isArray(businessUnit) && businessUnit.length > 0) {
        businessUnit = businessUnit[0];
        retailTransaction.businessUnitName = businessUnit.businessUnitName;
        retailTransaction.companyRegistrationNumber = businessUnit.companyRegistrationNumber;
        retailTransaction.vatNumber = businessUnit.vatNumber;
    }
    
    if (sequenceNumber) {
        if (sequenceNumber.sequenceNumber === 9999999999) {
            sequenceNumber.sequenceNumber = 1;
        }
        retailTransaction.sequenceNumber = sequenceNumber.sequenceNumber;
    }
    retailTransaction.totalAmountInclVat = Number(totalAmountInclVat.toFixed(2));
    retailTransaction.totalVatAmount = Number(totalVatAmount.toFixed(2));
    retailTransaction.currency = checkoutSession.currency;
    retailTransaction.customerID = checkoutSession.customerID;
    retailTransaction.customerName = checkoutSession.customerName;
    if (!retailTransaction.customerID) {
        const customer = await this.linkedCustomer(checkoutSession, retailTransaction.currency, retailTransaction.merchantID, context);
        if (customer)
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

        await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_RETAIL_TRANSACTIONS, response.ops[0]);

        if (pointOfService)
            await this.updateSequenceNumber(retailTransaction.sequenceNumber + 1, pointOfService.merchantID);

        try {
            let zreport = await this.getOldZreport(checkoutSession.pointOfServiceID);
            if (!zreport) {
                const insertedDoc = await this.createZreport(pointOfService, merchant);
                zreport  = insertedDoc ? insertedDoc.ops[0] : undefined;
            }
            if (zreport) {
                const updatedZreport = await this.updateZreport(response.ops[0], zreport);
                if (context)
                    context.log(updatedZreport);
            }
        } catch (error) {
            if (context)
                context.log('error with zreport ' + error);
        }
    }
    return response;
};


exports.linkedCustomer = async (checkoutSession, currency, merchantID, context) => {
    try {
        const email = checkoutSession.receiverEmail;
        let mobilePhone = checkoutSession.receiverMobilePhone;
        let customer;
        const searchBody = { merchantID: merchantID };
        if (email)
            searchBody.email = email;
        if (checkoutSession.fingerPrint)
            searchBody.fingerPrint = checkoutSession.fingerPrint;
        if (mobilePhone) {
            if (!mobilePhone.includes('+'))
                mobilePhone = '+' + mobilePhone;
            searchBody.mobilePhone = mobilePhone;
        }
        try {
            customer = await request.post(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/existed-customer`, {
                json: true,
                body: searchBody,
                headers: {
                    'x-functions-key': process.env.CUSTOMER_API_KEY
                }
            });
        } catch (error) {
            console.log(error);
        }
        if (customer) {
            const bodyVal = {};
            if (!customer.fingerPrint && checkoutSession.fingerPrint)
                bodyVal.fingerPrint = checkoutSession.fingerPrint;
            if ((!customer.email && email) || (customer.email && customer.email !== email))
                bodyVal.email = email;
            if ((!customer.mobilePhone && mobilePhone) || (customer.mobilePhone && customer.mobilePhone !== mobilePhone))
                bodyVal.mobilePhone = mobilePhone;
            if (Object.keys(bodyVal).length > 0) {
                const updatedCustomer = await request.patch(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/merchants/${merchantID}/customers/${customer._id}`, {
                    json: true,
                    body: bodyVal,
                    headers: {
                        'x-functions-key': process.env.CUSTOMER_API_KEY
                    }
                });
                context.log(updatedCustomer);
            }
        }
        if (!customer) {
            customer = {};
            customer._id = uuid.v4();
            customer.docType = 'customers';
            customer.partitionKey = customer._id;
            customer.merchantID = merchantID;
            customer.currency = currency;
            customer.isEnabled = true;
            customer.validFromDate = new Date();
            customer.email = email;
            customer.mobilePhone = mobilePhone;
            customer.fingerPrint = checkoutSession.fingerPrint;
            customer.createdDate  = new Date();
            customer.updatedDate = new Date();
            try {
                customer = await request.post(`${process.env.CUSTOMER_API_URL}/api/${process.env.CUSTOMER_API_VERSION}/customers`, {
                    json: true,
                    body: customer,
                    headers: {
                        'x-functions-key': process.env.CUSTOMER_API_KEY
                    }
                });
            } catch (error) {
                if (context)
                    context.log(error);
            }
        }
        return customer;
    } catch (error) {
        if (context)
            context.log(error);
    }
};

exports.getProducts = async (products) => {

    const productsArray = [];
    if (products)
        for (let i = 0; i < products.length; i++) {
            if (products[i].productID) {
                let product;
                try {
                    const url = `${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${products[i].productID}`;
                    product = await request.get(url, {
                        json: true,
                        headers: {
                            'x-functions-key': process.env.PRODUCT_API_KEY
                        }
                    });
                    
                } catch (err) {
                    console.log(err);
                }
                productsArray.push(product);
            }
        }
    return productsArray;
};

exports.getCart = async (pointOfServiceID) => {

    const result = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/cart/${pointOfServiceID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        }
    });
    return result;
};

exports.getPointOfService = async (pointOfServiceID) => {

    return await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${pointOfServiceID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.DEVICE_API_KEY
        }
    }).catch(error => {
        console.log(error);
    });
   
};

exports.getWebShop = async (webShopID, quickShopID) => {
    if (webShopID)
        return await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/webshops/${webShopID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        }).catch(error => {
            console.log(error);
        });
    if (quickShopID)
        return await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/quickshop/${quickShopID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        }).catch(error => {
            console.log(error);
        });
};

exports.getPspTypes = async () => {

    const result = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/psp-types`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PAYMENTS_API_KEY
        }
    });
    return result;
};

exports.getMerchants = async (merchantID) => {
    try {
        const result = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${merchantID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        return result;
    } catch (error) {
        console.log(error);
    }
};

exports.getBusinessUnit = async (businessUnitID) => {

    const result = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/business-units/${businessUnitID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.MERCHANT_API_KEY
        }
    });
    return result;
};

exports.getSequenceNumber = async (merchantID) => {

    const collection = await getMongodbCollection('Orders');
    let result = await collection.findOne({ docType: 'sequenceNumber', partitionKey: merchantID });
    if (!result) {
        const sequenceNumber = await collection.insertOne({
            _id: uuid.v4(),
            docType: 'sequenceNumber',
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

exports.getZreport = async (pointOfServiceID) => {

    const collection = await getMongodbCollection('Orders');
    const query = { docType: 'zreport', partitionKey: pointOfServiceID, pointOfServiceID: pointOfServiceID, isOpen: true };
   
    let fromDate = new Date();
    fromDate = fromDate.setHours(0, 0, 1);
    let toDate = new Date();
    toDate = toDate.setHours(23, 59, 59);
    query.createdDate = {
        $gte: fromDate,
        $lte: toDate
    };
    const result = await collection.findOne(query);
    return result;

};

exports.getOldZreport = async (pointOfServiceID) => {

    const collection = await getMongodbCollection('Orders');
    const query = { docType: 'zreport', partitionKey: pointOfServiceID, pointOfServiceID: pointOfServiceID };
   
    const result = await collection.find(query)
        .limit(5)
        .sort({ createdDate: -1 })
        .toArray();
    let lastZreport;
    if (result && Array.isArray(result) && result.length > 0) {
        lastZreport = result[0];
    }
    return lastZreport;

};

exports.updateOldZreportStatus = async (pointOfService, posEvents, isManual, oldZreport) => {
    const collection = await getMongodbCollection('Orders');
    const setquery = {
        isOpen: false,
        reportEndDate: new Date(),
        updatedDate: new Date()
    };
    if (isManual) {
        setquery.closingUserID = pointOfService.userID;
        setquery.isClosedAutomatically = false;
    } else {
        setquery.isClosedAutomatically = true;
    }
    const result = await collection.updateOne({
        _id: oldZreport._id,
        partitionKey: oldZreport.partitionKey,
        docType: 'zreport'
    }, {
        $push: {
            posEvents: {
                eventSeqNo: posEvents.length + 1,
                eventText: 'POS Closed',
                eventDate: new Date()
            }
        },
        $set: setquery
    });
    return result;
};

exports.updateSequenceNumber = async (updatedSequenceNumber, merchantID) => {

    const collection = await getMongodbCollection('Orders');
    const result = await collection.updateOne({
        partitionKey: merchantID,
        docType: 'sequenceNumber'
    }, {
        $set: {
            sequenceNumber: updatedSequenceNumber,
            updatedDate: new Date()
        }
    });
    return result;

};

exports.createZreport = async (pointOfService, merchant, oldZreport) => {
    const zreport = {};
    zreport._id = uuid.v4();
    zreport.docType = 'zreport';
    zreport.partitionKey = pointOfService._id;
    zreport.isOpen = true;
    zreport.merchantID = pointOfService.merchantID;
    zreport.merchantName = merchant.merchantName;
    zreport.merchantCompanyRegistrationNumber = merchant.merchantCompanyRegistrationNumber;
    zreport.merchantVatNumber = merchant.merchantVatNumber;
    zreport.merchantVatNumber = merchant.merchantVatNumber;
    zreport.merchantLogoImageURL = merchant.merchantLogoImageURL;
    zreport.businessUnitID = pointOfService.businessUnitID;
    zreport.pointOfServiceID = pointOfService._id;
    zreport.pointOfServiceName = pointOfService.pointOfServiceName;
    if (pointOfService.accessControl) {
        zreport.siteID = pointOfService.accessControl.siteID;
        zreport.siteName = pointOfService.accessControl.siteName;
        zreport.zoneID = pointOfService.accessControl.zoneID;
        zreport.zoneName = pointOfService.accessControl.zoneName;
    }
    zreport.reportStartDate = new Date();
    zreport.numberOfRetailTransactions = 0;
    zreport.openingAmount = 0;
    zreport.totalAmountInclVat = 0;
    zreport.totalVatAmount = 0;
    zreport.currency = pointOfService.currency;
    if (pointOfService.isManual) {
        zreport.isOpenedAutomatically = false;
        zreport.openingUserID = pointOfService.userID;
    } else {
        zreport.isOpenedAutomatically = true;
    }
    zreport.vatSummary = new Array();
    zreport.lineItemSummary = new Array();
    zreport.retailTransactions = new Array();
    zreport.paymentTypeSummary = new Array();
    zreport.productTypeSummary = new Array();
    zreport.productCategorySummary = new Array();
    zreport.posEvents = new Array();
    zreport.posEvents.push({
        eventSeqNo: 1,
        eventText: 'POS Opened',
        eventDate: new Date()
    });
    const collection = await getMongodbCollection('Orders');
    if (oldZreport)
        zreport.reportNumber = oldZreport.reportNumber + 1;
    else
        zreport.reportNumber = 1;
    zreport.createdDate = new Date();
    zreport.updatedDate = new Date();

    const result = await collection.insertOne(zreport);
    return result;
};

exports.updateZreport = async (retailTransaction, zreport) => {
    try {

        let updatedZreport;
        if (retailTransaction.lineItems && Array.isArray(retailTransaction.lineItems)) {
            updatedZreport  = await this.updateZreportLineItems(retailTransaction, zreport);
        }

        const collection = await getMongodbCollection('Orders');

        const result = await collection.updateOne({
            _id: zreport._id,
            partitionKey: zreport.partitionKey,
            docType: 'zreport'
        }, {
            $set: {
                numberOfRetailTransactions: zreport.numberOfRetailTransactions + 1,
                totalAmountInclVat: zreport.totalAmountInclVat + retailTransaction.totalAmountInclVat,
                totalVatAmount: zreport.totalVatAmount + retailTransaction.totalVatAmount,
                vatSummary: updatedZreport.vatSummary,
                paymentTypeSummary: updatedZreport.paymentTypeSummary,
                productTypeSummary: updatedZreport.productTypeSummary,
                productCategorySummary: updatedZreport.productCategorySummary,
                retailTransactions: updatedZreport.retailTransactions,
                lineItemSummary: updatedZreport.lineItemSummary,
                updatedDate: new Date()
            }
        });
        return result;
    } catch (err) {
        console.log(err);
    }
};

exports.updateZreportLineItems = async (retailTransaction, zreport) => {

    const psp = await this.getPspTypesDoc();
    const allProductTypes = await this.getProductTypesDoc();

    for (let k = 0; k < retailTransaction.vatSummary.length; k++) {
        let isVatClassExist = false;
        for (let j = 0; j < zreport.vatSummary.length; j++) {
            if (zreport.vatSummary[j].vatClass === retailTransaction.vatSummary[k].vatClass) {
                zreport.vatSummary[j].vatAmount = zreport.vatSummary[j].vatAmount + retailTransaction.vatSummary[k].vatAmount;
                isVatClassExist = true;
            }
        }
        if (!isVatClassExist) {
            zreport.vatSummary.push(retailTransaction.vatSummary[k]);
        }
    }

    for (let k = 0; k < retailTransaction.lineItems.length; k++) {
       
        if (retailTransaction.lineItems[k].lineItemTypeCode === 'payment') {
            let isPaymentTypeCodeExist = false;
            for (let j = 0; j < zreport.paymentTypeSummary.length; j++) {
                if (retailTransaction.lineItems[k].payment && zreport.paymentTypeSummary[j].paymentTypeCode === retailTransaction.lineItems[k].payment.paymentTypeCode) {
                    zreport.paymentTypeSummary[j].amount = zreport.paymentTypeSummary[j].amount + retailTransaction.lineItems[k].amount;
                    zreport.paymentTypeSummary[j].transactions = zreport.paymentTypeSummary[j].transactions + 1;
                    isPaymentTypeCodeExist = true;
                }
            }
            if (!isPaymentTypeCodeExist) {
                const newObj =  {
                    paymentTypeCode: retailTransaction.lineItems[k].payment.paymentTypeCode,
                    amount: retailTransaction.lineItems[k].amount,
                    transactions: 1
                };
                
                if (psp && psp.pspTypes && Array.isArray(psp.pspTypes)) {
                    psp.pspTypes.forEach(onePspType => {
                        if (onePspType.pspType === retailTransaction.lineItems[k].payment.paymentTypeCode) {
                            newObj.paymentTypeName = onePspType.pspTypeName;
                        }
                    });
                }
                zreport.paymentTypeSummary.push(newObj);
            }
        }
        if (retailTransaction.lineItems[k].lineItemTypeCode === 'sales') {
            let isProductTypeCodeExist = false;
            for (let j = 0; j < zreport.productTypeSummary.length; j++) {
                if (zreport.productTypeSummary[j].productTypeCode === 'product') {
                    zreport.productTypeSummary[j].amount = zreport.productTypeSummary[j].amount + retailTransaction.lineItems[k].amount;
                    zreport.productTypeSummary[j].transactions = zreport.productTypeSummary[j].transactions + 1;
                    isProductTypeCodeExist = true;
                }
            }
            if (!isProductTypeCodeExist) {
                const newObj =  {
                    productTypeSummary: 'product',
                    amount: retailTransaction.lineItems[k].amount,
                    transactions: 1
                };
                
                if (allProductTypes && allProductTypes.productTypes && Array.isArray(allProductTypes.productTypes)) {
                    allProductTypes.productTypes.forEach(productType => {
                        if (productType.productTypeCode.toLowerCase() === 'product') {
                            newObj.productTypeName = productType.productTypeName;
                        }
                    });
                }
                zreport.productTypeSummary.push(newObj);
            }

            let product;
            if (retailTransaction.lineItems[k].sales)
                product = await this.getProduct(retailTransaction.lineItems[k].sales.productID);
            if (product && product.posCategorie) {
                let isProductCategoryIDExist = false;
                for (let j = 0; j < zreport.productCategorySummary.length; j++) {
                    if (zreport.productCategorySummary[j].productCategoryID === product.posCategorie.productCategoryID) {
                        zreport.productCategorySummary[j].amount = zreport.productCategorySummary[j].amount + product.posCategorie.amount;
                        zreport.productCategorySummary[j].transactions = zreport.productCategorySummary[j].transactions + 1;
                        isProductCategoryIDExist = true;
                    }
                }
                if (!isProductCategoryIDExist) {
                    const newObj =  {
                        productCategoryID: product.posCategorie.productCategoryID,
                        productCategoryName: product.posCategorie.productCategoryName,
                        transactions: 1,
                        amount: product.posCategorie.amount
                    };
                    zreport.productCategorySummary.push(newObj);
                }
            }
        }

        let isLineItemTypeCodeExist = false;
        for (let j = 0; j < zreport.lineItemSummary.length; j++) {
            if (zreport.lineItemSummary[j].lineItemTypeCode === retailTransaction.lineItems[k].lineItemTypeCode) {
                zreport.lineItemSummary[j].amount = zreport.lineItemSummary[j].amount + retailTransaction.lineItems[k].amount;
                zreport.lineItemSummary[j].transactions = zreport.lineItemSummary[j].transactions + 1;
                isLineItemTypeCodeExist = true;
            }
        }
        if (!isLineItemTypeCodeExist) {
            const newObj = {
                amount: retailTransaction.lineItems[k].amount,
                transactions: 1
            };
            zreport.lineItemSummary.push(newObj);
        }
        
        const newObj = {
            retailTransactionID: retailTransaction._id,
            lineItemTypeCode: retailTransaction.lineItems[k].lineItemTypeCode,
            lineText: retailTransaction.lineItems[k].lineText
        };
        zreport.retailTransactions.push(newObj);
    }

    return zreport;
};

exports.getPspTypesDoc = async () =>{
    return request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/pos-types`, {
        json: true,
        headers: {
            'x-functions-key': process.env.DEVICE_API_KEY
        }
    });
};

exports.getProductTypesDoc = async () => {
    return request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products-types`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        }
    });
};

exports.getProduct = async (productID) => {
    return request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${productID}`, {
        json: true,
        headers: {
            'x-functions-key': process.env.PRODUCT_API_KEY
        }
    });
};