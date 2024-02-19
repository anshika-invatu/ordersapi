'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const uuid = require('uuid');
const utils = require('../utils');
const Promise = require('bluebird');
const { CustomLogs } = utils;
const moment = require('moment');
const logger = require('../utils/logger.js');
const retailTransactionUtils = require('../utils/retail-transaction-pos');
const posSessionLink = require('../utils/pos-session-link');

//From POS Device

module.exports = async (context, mySbMsg) => {
    context.log('JavaScript ServiceBus topic trigger function processed message', mySbMsg);
    CustomLogs(`incoming message is ${mySbMsg}`, context);
    try {
        const collection = await getMongodbCollection('Orders');
        let checkoutSession;
        if (mySbMsg && !mySbMsg.payment) {
            mySbMsg.payment = mySbMsg;
        }
        if (mySbMsg.payment && mySbMsg.payment.merchant_tx_id) {
            checkoutSession = await collection.findOne({
                paymentProviderReference: mySbMsg.payment.merchant_tx_id,
                docType: 'checkoutSession'
            });
        }
        if (!checkoutSession) {
            context.log('checkoutSession doc does not exist');
            const logObj = {};
            logObj.massage = `checkoutSession does not exist in db for ${mySbMsg.payment.merchant_tx_id}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }
        if (!mySbMsg.payment.state || (mySbMsg.payment.state.toUpperCase() !== 'APPROVED' && mySbMsg.payment.state.toUpperCase() !== 'CONFIRMATION')) {
            context.log('incoming massage status is not APPROVED/CONFIRMATION');
            const logObj = {};
            logObj.massage = `incoming massage status is not PAID for ${mySbMsg.payment.merchant_tx_id}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }
        const pointOfService = await request.get(`${process.env.DEVICE_API_URL}/api/${process.env.DEVICE_API_VERSION}/point-of-service/${checkoutSession.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.DEVICE_API_KEY
            }
        });
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
        const iotReqBody = {};
        if (mySbMsg.payment.state.toUpperCase() === 'CONFIRMATION') {
            iotReqBody.payload = {
                'checkoutSessionID': checkoutSession._id,
                'status': 'CONFIRMATION',
                'reasons': mySbMsg.payment.state,
                'moduleCode': 'payWithBlueCode',
                'moduleInstance': 1
           };
            iotReqBody.pointOfService = pointOfService;
            iotReqBody.deviceAzureID = pointOfService.deviceAzureID;
            iotReqBody.methodName = 'PaymentResponse';
    
            const logObj = {};
            logObj.massage = `send req to device api to perform action for ${mySbMsg.payment.merchant_tx_id}`;
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
                logObj.massage = `action not performed succesfully by device api for ${mySbMsg.payment.merchant_tx_id}`;
                CustomLogs(logObj, context);
                return Promise.resolve();
            }
            return Promise.resolve();
        }
        iotReqBody.payload = {
            'checkoutSessionID': checkoutSession._id,
            'status': mySbMsg.payment.state,
            'reasons': mySbMsg.payment.state,
            'moduleCode': 'payWithBlueCode',
            'moduleInstance': 1
       };
        iotReqBody.deviceAzureID = pointOfService.deviceAzureID;
        iotReqBody.pointOfService = pointOfService;
        iotReqBody.methodName = 'PaymentResponse';

        const logObj = {};
        logObj.massage = `send req to device api to perform action for ${mySbMsg.payment.merchant_tx_id}`;
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
            logObj.massage = `action not performed succesfully by device api for ${mySbMsg.payment.merchant_tx_id}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }

        const paymentTransaction = await createPaymentTransaction(pointOfService, checkoutSession);

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
            if (checkoutSession && checkoutSession.passID) {
                pendingOrder.passID = checkoutSession.passID;
            }
            if (pointOfService && pointOfService.webShops && pointOfService.webShops.length && pointOfService.webShops.length > 0) {
                pendingOrder.webShopID = pointOfService.webShops[0].webShopID;
                pendingOrder.webShopName = pointOfService.webShops[0].webShopName;
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
                logObj.massage = `send order to topic for ${mySbMsg.payment.merchant_tx_id}`;
                CustomLogs(logObj, context);
            }
        }
        if (checkoutSession.receiverMobilePhone) {
            const wallet = await getWallet(checkoutSession);

            checkoutSession.walletID = wallet._id;
            checkoutSession.functionName = 'bluecode-order-processor';

            const logObjs = {};
            logObjs.checkoutSession = checkoutSession;
            logObjs.checkoutSessionID = mySbMsg.payeePaymentReference;
            CustomLogs(logObjs, context);
        }
        let customerInfoMasked;
        if (checkoutSession.receiverMobilePhone) {
            customerInfoMasked = checkoutSession.receiverMobilePhone.replace(/.(?=.{4})/g, '');
            customerInfoMasked = `******${customerInfoMasked}`;
        }
        const retailTransaction = await retailTransactionUtils.createRetailTransActions(checkoutSession, customerInfoMasked);
        if (!retailTransaction) {
            const logObj = {};
            logObj.massage = `retail transaction not create succesfully for ${mySbMsg.payment.merchant_tx_id}`;
            CustomLogs(logObj, context);
            return Promise.resolve();
        }

        const log = {};
        log.retailTransactionID = retailTransaction.ops[0]._id;
        log.massage = `retail transaction create succesfully for ${mySbMsg.payment.merchant_tx_id} with id ${retailTransaction.ops[0]._id}`;
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
            logObj.massage = `checkoutSession updated for ${mySbMsg.payment.merchant_tx_id}`;
            CustomLogs(logObj, context);
            context.log('checkoutSession updated');
        } else {
            const logObj = {};
            logObj.massage = `checkoutSession does not updated for ${mySbMsg.payment.merchant_tx_id}`;
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

    async function createPaymentTransaction (pointOfService, checkoutSession) {
        // Create Payment Transaction document
        const body = {
            _id: uuid.v4(),
            transactionDate: new Date(),
            transactionStatus: 'Captured',
            amountPaid: Number(mySbMsg.payment.total_amount),
            amountRefunded: 0,
            currency: mySbMsg.payment.currency,
            pointOfServiceID: pointOfService._id,
            pointOfServiceName: pointOfService.pointOfServiceName,
            paymentProvider: 'bluecode',
            paymentProviderReference: mySbMsg.payment.merchant_tx_id,
            sellerMerchantID: pointOfService.merchantID,
            paymentType: 'bluecode',
            mySbMsg,
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
            logObj.massage = `wallet(${checkoutSession.receiverMobilePhone}) already exist for ${mySbMsg.payment.merchant_tx_id}`;
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
            logObj.massage = `new wallet(${checkoutSession.receiverMobilePhone}) create for ${mySbMsg.payment.merchant_tx_id}`;
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