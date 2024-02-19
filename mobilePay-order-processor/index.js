'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const uuid = require('uuid');
const utils = require('../utils');
const Promise = require('bluebird');
const { CustomLogs } = utils;
const moment = require('moment');
const btoa = require('btoa');
const logger = require('../utils/logger.js');
const retailTransactionUtils = require('../utils/retail-transaction-pos');
const posSessionLink = require('../utils/pos-session-link');

//From POS Device  BASE-325

module.exports = async (context, mySbMsg) => {
    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);
    try {
        const paymentProviderAccounts = await request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/payment-provider-accounts/${mySbMsg.paymentProviderAccountID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        let integratorClientId, clientSecret;
        if (paymentProviderAccounts && paymentProviderAccounts.settings) {
            if (paymentProviderAccounts.settings.integratorClientId)
                integratorClientId = paymentProviderAccounts.settings.integratorClientId;
            if (paymentProviderAccounts.settings.clientSecret)
                clientSecret = paymentProviderAccounts.settings.clientSecret;
        }
        const auth = 'Basic ' + btoa(`${integratorClientId}:${clientSecret}`);
        context.log(auth);
        const merchant = await request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${mySbMsg.merchantID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            }
        });
        const authentication = await request.post(`${process.env.MOBILE_PAY_URL}/integrator-authentication/connect/token`, {
            form: {
                grant_type: 'client_credentials',
                merchant_vat: merchant.vatNumber
            },
            json: true,
            headers: {
                'authorization': auth,
                'content-type': 'application/x-www-form-urlencoded',
                'x-ibm-client-id': integratorClientId

            }
        });
        context.log(authentication);

        const statusRes = await this.statusCheck(mySbMsg.paymentID, authentication, integratorClientId, merchant, context);

        if (!statusRes || statusRes.status !== 'Reserved') {
            context.log('msg status not corrected = ' + statusRes.status);
            return Promise.resolve();
        }
        const collection = await getMongodbCollection('Orders');
        const checkoutSession = await collection.findOne({
            paymentID: mySbMsg.paymentID,
            docType: 'checkoutSession'
        });
        if (!checkoutSession) {
            context.log('checkoutSession doc does not exist');
            const logObj = {};
            logObj.massage = `checkoutSession does not exist in db for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }
        const result = await request.post(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/mobilePay-capture`, {
            json: true,
            body: {
                paymentID: checkoutSession.paymentID,
                amount: statusRes.amount,
                paymentProviderAccountID: checkoutSession.paymentProviderAccountID,
                marchantVat: merchant.vatNumber
            },
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        });
        context.log(result);
        const res = await collection.updateOne({
            _id: checkoutSession._id,
            partitionKey: checkoutSession.partitionKey
        },{
            $set: {
                paymentStatus: statusRes.status
            }
        });
        context.log(res.matchedCount);

        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${checkoutSession.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        const iotReqBody = {};
        iotReqBody.payload = {
            'checkoutSessionID': checkoutSession._id,
            'status': 'PAID',
            'reasons': statusRes.status,
            'moduleCode': 'payWithMobilePay',
            'moduleInstance': 1
       };
        iotReqBody.deviceAzureID = pointOfService.deviceAzureID;
        iotReqBody.pointOfService = pointOfService;
        iotReqBody.methodName = 'PaymentResponse';

        const logObj = {};
        logObj.massage = `send req to device api to perform action for ${mySbMsg.paymentID}`;
        CustomLogs(logObj, context);

        const iot = await request.post(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/perform-iot-action`, {
            json: true,
            body: iotReqBody,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
        if (!iot) {
            const logObj = {};
            logObj.massage = `action not performed succesfully by device api for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            //return Promise.resolve();
        }
        let vatAmount = 0, amount = 0; const products = [];
        if (checkoutSession.products && Array.isArray(checkoutSession.products)) {
            for (let i = 0; i < checkoutSession.products.length; i++) {
                const product = await request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${checkoutSession.products[i].productID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PRODUCT_API_KEY
                    }
                });
                if (product.productTypeCode &&
                    (product.productTypeCode.toLowerCase() === 'giftcard'
                    || product.productTypeCode.toLowerCase() === 'ticket'
                    || product.productTypeCode.toLowerCase() === ' membership'
                    || product.productTypeCode.toLowerCase() === 'coupon'
                    || product.productTypeCode.toLowerCase() === ' pass')) {
                    product.vatAmount = Number(Number(product.vatAmount).toFixed(2));
                    product.salesPrice = Number(Number(product.salesPrice).toFixed(2));
                    vatAmount += product.vatAmount;
                    amount += product.salesPrice;
                    products.push(checkoutSession.products[i]);
                }
            }
        }
        
        const paymentTransaction = await createPaymentTransaction(pointOfService, checkoutSession, statusRes);

        if (!checkoutSession.receiverMobilePhone) {
            const logObj = {};
            logObj.massage = `phone number does not exist in checkoutsession doc with mobilePay payment type for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
        }
        if (paymentTransaction && pointOfService.cartSettings && pointOfService.cartSettings.issueVouchers === true) {
            const orderID = uuid.v4();
            const pendingOrder = {
                _id: orderID,
                docType: 'order',
                orderDate: new Date(),
                orderStatus: 'Pending',
                transactionID: paymentTransaction._id,
                transactionStatus: paymentTransaction.transactionStatus,
                amountPaid: Number(Number(amount).toFixed(2)),
                vatAmount: Number(Number(vatAmount).toFixed(2)),
                currency: pointOfService.currency,
                pointOfServiceID: pointOfService._id,
                pointOfServiceName: pointOfService.pointOfServiceName,
                products: products,
                customerEmail: checkoutSession.customerEmail,
                receiverEmail: checkoutSession.receiverEmail,
                receiverMobilePhone: checkoutSession.receiverMobilePhone,
                createdDate: new Date(),
                updatedDate: new Date(),
                partitionKey: orderID,
                sellerMerchantID: pointOfService.merchantID
            };
            if (pointOfService && pointOfService.webShops && pointOfService.webShops.length && pointOfService.webShops.length > 0) {
                pendingOrder.webShopID = pointOfService.webShops[0].webShopID;
                pendingOrder.webShopName = pointOfService.webShops[0].webShopName;
            }
            if (checkoutSession && checkoutSession.passID) {
                pendingOrder.passID = checkoutSession.passID;
            }
            if (checkoutSession)
                pendingOrder.customerID = checkoutSession.customerID;
            if (pendingOrder.receiverMobilePhone && !pendingOrder.receiverMobilePhone.includes('+'))
                pendingOrder.receiverMobilePhone = '+' + pendingOrder.receiverMobilePhone;
            context.log('Creating Order Doc');
        
            const order = await collection.insertOne(pendingOrder);
        
            if (order && order.ops) {
                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_ORDER_NEW, order.ops[0]);
                const logObj = {};
                logObj.massage = `send order to topic for ${mySbMsg.paymentID}`;
                CustomLogs(logObj, context);
            }
        }
        let customerInfoMasked;
        if (checkoutSession.receiverMobilePhone) {
            const wallet = await getWallet(checkoutSession);

            checkoutSession.walletID = wallet._id;
            checkoutSession.functionName = 'mobilePay-order-processor';

            const logObjs = {};
            logObjs.checkoutSession = checkoutSession;
            logObjs.paymentID = mySbMsg.paymentID;
            CustomLogs(logObjs, context);

            customerInfoMasked = checkoutSession.receiverMobilePhone.replace(/.(?=.{4})/g, '');
            customerInfoMasked = `******${customerInfoMasked}`;
        }

        
        const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, customerInfoMasked, context);
        if (!retailTransaction) {
            const logObj = {};
            logObj.massage = `retail transaction not create succesfully for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }

        const log = {};
        log.retailTransactionID = retailTransaction.ops[0]._id;
        log.massage = `retail transaction create succesfully for ${mySbMsg.paymentID} with id ${retailTransaction.ops[0]._id}`;
        CustomLogs(log, context);
        context.log(retailTransaction.ops[0]._id);
        if (checkoutSession.posSessionID)
            posSessionLink.linkedPosSession(checkoutSession, checkoutSession.posSessionID, retailTransaction.ops[0], 'paid', context);
        const updatedCheckoutSession = await collection.updateOne({
            _id: checkoutSession._id,
            docType: 'checkoutSession',
            partitionKey: checkoutSession.partitionKey
        },
        {
            $set: {
                docType: 'checkoutSessionCompleted',
                _ts: new Date(),
                ttl: 60 * 60 * 24 * 3,
                updatedDate: new Date()
            }
        });
        if (updatedCheckoutSession && updatedCheckoutSession.matchedCount) {
            const logObj = {};
            logObj.massage = `checkoutSession updated for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            context.log('checkoutSession updated');
        } else {
            const logObj = {};
            logObj.massage = `checkoutSession does not updated for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }
        return Promise.resolve();
    } catch (error) {
        context.log(error);
        const logObj = {};
        logObj.error = error;
        CustomLogs(logObj, context);
        return Promise.resolve();
    }

    async function createPaymentTransaction (pointOfService, checkoutSession, statusRes) {
        // Create Payment Transaction document
        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            amountPaid: Number(checkoutSession.totalAmountInclVat),
            amountRefunded: 0,
            currency: pointOfService.currency,
            pointOfServiceID: pointOfService._id,
            pointOfServiceName: pointOfService.pointOfServiceName,
            paymentProvider: 'mobilePay',
            //paymentProviderReference: mySbMsg.paymentReference,
            sellerMerchantID: pointOfService.merchantID,
            paymentType: 'mobilePay',
            statusRes,
            products: checkoutSession.products
        };
        if (!body.amountRefunded) {
            body.amountRefunded = body.amountPaid;
        }
        const url = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions`;

        const options = {
            json: true,
            body,
            headers: {
                'x-functions-key': process.env.PAYMENTS_API_KEY
            }
        };

        logger.logInfo('Creating paymentTransaction');

        return request.post(url, options);
    }

    async function getWallet (checkoutSession) {
        let wallet = await request.get(`${process.env.WALLET_API_URL}/api/${process.env.WALLET_API_VERSION}/users/${checkoutSession.receiverMobilePhone}/wallet`, {
            json: true,
            headers: {
                'x-functions-key': process.env.WALLET_API_KEY
            }
        });
        if (wallet) {
            const logObj = {};
            logObj.massage = `wallet(${checkoutSession.receiverMobilePhone}) already exist for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
        }
        if (!wallet) {
            const body = {
                _id: uuid.v4(),
                docType: 'wallets',
                walletName: 'My Wallet',
                walletDescription: '',
                isEnabled: true,
                isLocked: false,
                validFromDate: new Date(),
                validToDate: moment()
                    .add(20, 'years')
                    .toDate(),
                sendNotifications: {
                    viaEmail: true,
                    viaSMS: false,
                    onVoucherRedeemed: true,
                    onVoucherViewed: true,
                    onVoucherTransfered: false,
                    onPassTransfered: true
                },
                walletAmount: 0,
                currency: 'VOC'
            };
            if (checkoutSession.receiverMobilePhone) {
                body.mobilePhone = checkoutSession.receiverMobilePhone;
            }
            const logObj = {};
            logObj.massage = `new wallet(${checkoutSession.receiverMobilePhone}) create for ${mySbMsg.paymentID}`;
            CustomLogs(logObj, context);
            wallet = await request.post(process.env.WALLET_API_URL + `/api/${process.env.WALLET_API_VERSION}/wallets`, {
                body: body,
                json: true,
                headers: {
                    'x-functions-key': process.env.WALLET_API_KEY
                }
            });
            return wallet;
        }
        return wallet;
    }
};


exports.statusCheck = async (paymentID, authentication, integratorClientId, merchant, context) => {
    const paymentStatus = await request.get(`${process.env.MOBILE_PAY_URL}/pos/v10/payments/${paymentID}`, {
        json: true,
        headers: {
            'accept': 'application/json',
            'authorization': 'Bearer ' + authentication.access_token,
            'x-ibm-client-id': integratorClientId,
            'x-mobilepay-client-system-version': '2.1.1',
            'X-MobilePay-Merchant-VAT-Number': merchant.vatNumber

        }
    });
    context.log(paymentStatus);
    if (paymentStatus) {
        CustomLogs('paymentStatus body ' + JSON.stringify(paymentStatus), context);
        console.log('paymentStatus body ' + JSON.stringify(paymentStatus));
        if (paymentStatus.status === 'Reserved' || paymentStatus.status === 'CancelledByUser'
        || paymentStatus.status === 'CancelledByClient' || paymentStatus.status === 'CancelledByMobilePay'
        || paymentStatus.status === 'ExpiredAndCancelled' || paymentStatus.status === 'RejectedByMobilePayDueToAgeRestrictions') {
            return Object.assign(paymentStatus);
        } else if (paymentStatus.status === 'Initiated' || paymentStatus.status === 'Paired' || paymentStatus.status === 'IssuedToUser') {
            await Promise.delay(1000);
            await this.statusCheck(paymentID, authentication, integratorClientId, merchant, context);
        }
    }
};