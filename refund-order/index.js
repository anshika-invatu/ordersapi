'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const uuid = require('uuid');
const utils = require('../utils');
const Promise = require('bluebird');
const errors = require('../errors');
const Swish = require('../utils/swish-payment');
const request = require('request-promise');
const logger = require('../utils/logger.js');

//Please refer bac-240, 312, 325, 381(Swish refund), 433 for this endpoint related details

module.exports = async (context, req) => {
    if (!req.body) {
        utils.setContextResError(
            context,
            new errors.EmptyRequestBodyError(
                'You\'ve requested to refund order but the request body seems to be empty. Kindly pass request body in application/json format',
                400
            )
        );
        return Promise.resolve();
    }
    if (!req.body.orderID) {
        utils.setContextResError(
            context,
            new errors.FieldValidationError(
                'Please provide orderID in request body.',
                400
            )
        );
        return Promise.resolve();
    }

    const allProducts = [];
    let orderCollection, orderDoc, allVouchers, vourityMerchant, paymentTransactionDoc;
    const executionStart = new Date();
    return utils.validateUUIDField(context, `${req.body.orderID}`, 'The orderID field specified in the request body does not match the UUID v4 format.')
        .then(() => request.get(`${process.env.MERCHANT_API_URL}/api/${process.env.MERCHANT_API_VERSION}/merchants/${process.env.VOURITY_MERCHANT_ID}`, {
            headers: {
                'x-functions-key': process.env.MERCHANT_API_KEY
            },
            json: true
        }))
        .then(result => {
            if (result) {
                vourityMerchant = result;
            }
            return getMongodbCollection('Orders');
        })
        .then(collection => {
            orderCollection = collection;
            return collection.findOne({
                _id: req.body.orderID,
                partitionKey: req.body.orderID
            });
        })
        .then(order => {
            if (order) {
                orderDoc = order;
                if (order.transactionStatus === 'Refunded') {
                    return Promise.reject(
                        new errors.RefundNotAllowed(
                            'This Order is already refunded.',
                            403
                        )
                    );
                }
                return request.get(`${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/transactions/${order.transactionID}`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
            } else {
                return Promise.reject(
                    new errors.OrderNotFoundError(
                        'The order id specified in the request doesn\'t exist.',
                        404
                    )
                );
            }
        })
        .then(paymentTransaction => {
            if (paymentTransaction) {
                paymentTransactionDoc = paymentTransaction;
                const dt1 = new Date(paymentTransaction.createdDate);
                const dt2 = new Date();
                const diff = utils.date(dt1, dt2);
                if (diff > 14) {
                    return Promise.reject(
                        new errors.RefundExpired(
                            'This transaction date is expired, transaction not allow the refund',
                            403
                        )
                    );
                }
                const url = `${process.env.VOUCHER_API_URL}/api/${process.env.VOUCHER_API_VERSION}/order/${req.body.orderID}/vouchers`;
                return request.get(url, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.VOUCHER_API_KEY
                    }
                });
            }
        })
        .then(vouchers => {
            if (orderDoc.issueVouchers !== false && (!vouchers && !vouchers.length)) {
                if (orderDoc.deliveryStatus !== 'Pending') {
                    return Promise.reject(
                        new errors.RefundNotAllowed(
                            'This Order is already refunded.',
                            403
                        )
                    );
                }
            } else if (vouchers && Array.isArray(vouchers)) {
                allVouchers = vouchers;
                let isAbleToRefund = true;
                vouchers.forEach(element => {
                    if (element.isRedeemed === true || element.redemptionCounter > 0) {
                        isAbleToRefund = false;
                    }
                });
                if (!isAbleToRefund) {
                    return Promise.reject(
                        new errors.RefundNotAllowed(
                            'Vouchers has been used already, so refund is not allowed.',
                            403
                        )
                    );
                }
            } else {
                return Promise.reject(
                    new errors.RefundNotAllowed(
                        'Vouchers has been used already, so refund is not allowed.',
                        403
                    )
                );
            }
            if (!paymentTransactionDoc || !paymentTransactionDoc.swishCallBackResult || !paymentTransactionDoc.swishCallBackResult.paymentReference) {
                return Promise.reject(
                    new errors.PaymentTransactionError(
                        'PaymentTransaction doc or PaymentProviderReference in PaymentTransactionDoc is not available.',
                        404
                    )
                );
            }
            if (paymentTransactionDoc.paymentType && (paymentTransactionDoc.paymentType).toLowerCase() === 'creditcard') {
                const url = `${process.env.PAYMENTS_API_URL}/api/${process.env.PAYMENTS_API_VERSION}/refund-payment-transactions`;
                return request.post(url, {
                    body: {
                        paymentTransactionID: orderDoc.transactionID,
                        reasonForRefund: req.body.reasonForRefund
                    },
                    json: true,
                    headers: {
                        'x-functions-key': process.env.PAYMENTS_API_KEY
                    }
                });
            } else if (paymentTransactionDoc.paymentType && (paymentTransactionDoc.paymentType).toLowerCase() === 'swish') {
                if (paymentTransactionDoc.paymentSource === 'Infrasec') {
                    const infrasecRefund = {};
                    infrasecRefund._id = uuid.v4();
                    infrasecRefund.docType = 'infrasecRefund';
                    infrasecRefund.partitionKey = infrasecRefund._id;
                    infrasecRefund.merchantID = orderDoc.sellerMerchantID;
                    infrasecRefund.merchantName = orderDoc.sellerMerchantName;
                    infrasecRefund.orderID = orderDoc._id;
                    infrasecRefund.swishTransactionId = paymentTransactionDoc.swishCallBackResult.paymentReference;
                    infrasecRefund.refundAmount = paymentTransactionDoc.amountPaid;
                    infrasecRefund.createdDate = new Date();
                    infrasecRefund.updatedDate = new Date();
                    utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INFRASEC_REFUND, infrasecRefund);
                    return true;
                } else {
                    const isTesting = process.env.IS_TESTING;
                    req.body.cancelBody = {
                        callbackUrl: process.env.CALLBACK_URL,
                        payerAlias: paymentTransactionDoc.swishCallBackResult.payerAlias.toString(),
                        amount: paymentTransactionDoc.amountRefunded.toString(),
                        currency: req.body.currency,
                        message: req.body.reasonForRefund,
                        originalPaymentReference: paymentTransactionDoc.swishCallBackResult.paymentReference,
                    };
                    req.instructionUUID = paymentTransactionDoc.swishCallBackResult.payeePaymentReference;
                    return Swish.swishPayment(req, context, isTesting, paymentTransactionDoc.paymentID)
                        .then(result => {
                            logger.logInfo('refundeorder: refund call ok, refundid=' + result.id);
                            paymentTransactionDoc.pspType = 'swish';
                            let paymentResult;
                            if (result && result.location)
                                paymentResult = 'approved';
                            else
                                paymentResult = 'denied';
                            utils.createPaymentLogs(paymentTransactionDoc, result, 'refund', paymentTransactionDoc.amountRefunded, paymentResult);
                            return result.donePromise;
                        });
                }
            }
            
        })
        .then(async result => {
            if (result) {
                const merchantPricePlan = await request.get(process.env.MERCHANT_API_URL + `/api/${process.env.MERCHANT_API_VERSION}/merchants/${orderDoc.sellerMerchantID}/merchant-priceplan`, {
                    json: true,
                    headers: {
                        'x-functions-key': process.env.MERCHANT_API_KEY
                    }
                });
                let totalAmount, feePerTransactionPercent, feePerTransactionAmount;
                if (merchantPricePlan) {
                    if (merchantPricePlan.serviceFeePrices) {
                        if (paymentTransactionDoc && paymentTransactionDoc.paymentType) {
                            merchantPricePlan.serviceFeePrices.forEach(element => {
                                if (element.paymentType && (element.paymentType).toLowerCase() === (paymentTransactionDoc.paymentType).toLowerCase()) {
                                    feePerTransactionPercent = element.feePerTransactionPercent;
                                    feePerTransactionAmount = element.feePerTransactionAmount;
                                }
                            });
                        }
                    }
                    if (!feePerTransactionPercent && !feePerTransactionAmount && merchantPricePlan.fees) {
                        feePerTransactionPercent = merchantPricePlan.fees.feePerTransactionPercent;
                        feePerTransactionAmount = merchantPricePlan.fees.feePerTransactionAmount;
                    }
                    if (feePerTransactionPercent && !feePerTransactionAmount) {
                        totalAmount = (orderDoc.amountPaid * feePerTransactionPercent) / 100;
                    }
                    if (feePerTransactionAmount && !feePerTransactionPercent) {
                        totalAmount = feePerTransactionAmount;
                    }
                    if (feePerTransactionPercent && feePerTransactionAmount) {
                        totalAmount = ((orderDoc.amountPaid * feePerTransactionPercent) / 100) + feePerTransactionAmount;
                    }
                }
                
                const invoiceItem = {};
                invoiceItem._id = uuid.v4();
                invoiceItem.docType = 'refundInvoiceItem';
                invoiceItem.partitionKey = orderDoc.sellerMerchantID;
                invoiceItem.merchantID = orderDoc.sellerMerchantID;
                invoiceItem.currency = orderDoc.currency;
                invoiceItem.totalAmount = totalAmount;
                invoiceItem.description = 'Invoice item for refund';
                invoiceItem.quantity = 1;
                invoiceItem.refundedDate = new Date();
                invoiceItem.createdDate = new Date();
                invoiceItem.updatedDate = new Date();
                await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_REFUND_INVOICE_ITEM, invoiceItem);
                return orderCollection.updateOne({
                    _id: req.body.orderID,
                    partitionKey: req.body.orderID,
                    docType: 'order'
                }, {
                    $set: Object.assign(
                        {},
                        req.body,
                        {
                            transactionStatus: 'Refunded',
                            orderStatus: 'Refunded',
                            updatedDate: new Date()
                        }
                    )
                });
            }
        })
        .then(result => {
            if (result) {
                const allReq = [];
                if (!allVouchers || !Array.isArray(allVouchers)) {
                    allVouchers = [];
                }
                allVouchers.forEach(element => {
                    allReq.push(request.patch(`${process.env.VOUCHER_API_URL}/api/${process.env.VOUCHER_API_VERSION}/vouchers/${element._id}`, {
                        body: {
                            isRedeemed: true,
                            isCanceled: true,
                            'validPeriod.validToDate': new Date(),
                            updatedDate: new Date()
                        },
                        json: true,
                        headers: {
                            'x-functions-key': process.env.VOUCHER_API_KEY
                        }
                    }));
                });
                return Promise.all(allReq);
            }
        })
        .then(result => {
            if (result) {
                if (orderDoc.products && Array.isArray(orderDoc.products)) {
                    const allReq = [];
                    orderDoc.products.forEach(product => {
                        allProducts.push(product);
                        allReq.push(request.get(`${process.env.PRODUCT_API_URL}/api/${process.env.PRODUCT_API_VERSION}/products/${product.productID}`, {
                            json: true,
                            headers: {
                                'x-functions-key': process.env.PRODUCT_API_KEY
                            }
                        }));
                    });
                    return Promise.all(allReq);
                }
            }
        })
        .then(async products => {
            if (products && Array.isArray(products)) {
                products.forEach(product => {
                    const clearingTransaction = {};
                    clearingTransaction._id = uuid.v4();
                    clearingTransaction.docType = 'clearingTransaction';
                    clearingTransaction.transactionStatus = 'pending';
                    clearingTransaction.currency = product.currency;
                    clearingTransaction.partitionKey = clearingTransaction._id;
                    clearingTransaction.transactionDate = new Date();
                    clearingTransaction.trigger = 'refund';
                    clearingTransaction.category = 'costs';
                    clearingTransaction.vatPercent = orderDoc.vatPercent;
                    clearingTransaction.vatAmount = Number(Number(orderDoc.vatAmount).toFixed(2));
                    clearingTransaction.isMultiFunctionVoucher = product.isMultiFunctionVoucher;
                    allProducts.forEach(element => {
                        if (element.productID === product._id) {
                            clearingTransaction.vatClass = element.vatClass;
                            clearingTransaction.productClass = element.productClass;
                            clearingTransaction.productClassName = element.productClassName;
                            clearingTransaction.clearingAmount = element.salesPrice;
                        }
                    });
                    if (product.isMultiFunctionVoucher === true) {
                        clearingTransaction.senderMerchantID = process.env.VOURITY_MERCHANT_ID;
                        clearingTransaction.senderMerchantName = vourityMerchant.merchantName;
                        clearingTransaction.receiverMerchantID = process.env.VOURITY_MERCHANT_ID;
                        clearingTransaction.receiverMerchantName = vourityMerchant.merchantName;
                    } else {
                        clearingTransaction.senderMerchantID = process.env.VOURITY_MERCHANT_ID;
                        clearingTransaction.senderMerchantName = vourityMerchant.merchantName;
                        clearingTransaction.receiverMerchantID = process.env.VOURITY_MERCHANT_ID;
                        clearingTransaction.receiverMerchantName = vourityMerchant.merchantName;
                    }
                    clearingTransaction.createdDate = new Date();
                    clearingTransaction.updatedDate = new Date();
                    clearingTransaction.references = {
                        orderID: orderDoc._id,
                        productID: product._id
                    };
                    if (orderDoc.issueVouchers === false) {
                        clearingTransaction.productClass = 'VendingRefund',
                        clearingTransaction.productClassName = 'Vending Refund';
                        clearingTransaction.trigger = 'refund';
                    }
                    utils.sendMessageToAzureBusQueue(process.env.AZURE_BUS_QUEUE_CLEARING_TRANSACTIONS, clearingTransaction);
                    if (orderDoc.sellerMerchantID !== product.issuer.merchantID) {
                        orderDoc.products.forEach(orderProduct => {
                            if (orderProduct.productID === product._id && orderProduct.reseller) { // clearing doc for reseller
                                const secondClearingTransaction = {};
                                secondClearingTransaction._id = uuid.v4();
                                secondClearingTransaction.docType = 'clearingTransaction';
                                secondClearingTransaction.transactionStatus = 'pending';
                                secondClearingTransaction.senderMerchantID = orderProduct.reseller.merchantID;
                                secondClearingTransaction.senderMerchantName = orderProduct.reseller.merchantName;
                                secondClearingTransaction.receiverMerchantID = process.env.VOURITY_MERCHANT_ID;
                                secondClearingTransaction.receiverMerchantName = vourityMerchant.merchantName;
                                secondClearingTransaction.clearingAmount = Number(Number(orderProduct.reseller.resellerAmount).toFixed(2));
                                secondClearingTransaction.vatClass = orderProduct.reseller.vatClass;
                                secondClearingTransaction.productClass = orderProduct.reseller.productClass;
                                secondClearingTransaction.productClassName = orderProduct.reseller.productClassName;
                                secondClearingTransaction.currency = orderProduct.reseller.currency;
                                secondClearingTransaction.partitionKey = clearingTransaction._id;
                                secondClearingTransaction.transactionDate = new Date();
                                secondClearingTransaction.trigger = 'refund';
                                secondClearingTransaction.fromBalanceAccountID = orderProduct.reseller.balanceAccountID;
                                secondClearingTransaction.senderBalanceAccountName = orderProduct.reseller.balanceAccountName;
                                if (vourityMerchant.balanceAccounts && Array.isArray(vourityMerchant.balanceAccounts)) {
                                    vourityMerchant.balanceAccounts.forEach(balanceAccount => {
                                        if (balanceAccount.balanceCurrency === orderProduct.reseller.currency) {
                                            secondClearingTransaction.toBalanceAccountID = balanceAccount.balanceAccountID;
                                            secondClearingTransaction.receiverBalanceAccountName = balanceAccount.balanceAccountName;
                                        }
                                    });
                                }
                                secondClearingTransaction.vatAmount = Number(Number(secondClearingTransaction.clearingAmount - (secondClearingTransaction.clearingAmount / ((orderProduct.reseller.vatPercent / 100) + 1))).toFixed(2));
                                secondClearingTransaction.isMultiFunctionVoucher = product.isMultiFunctionVoucher;
                                secondClearingTransaction.senderService = 'Orders API';
                                secondClearingTransaction.comment = 'Refund of reseller commission';
                                secondClearingTransaction.createdDate = new Date();
                                secondClearingTransaction.updatedDate = new Date();
                                secondClearingTransaction.references = {
                                    orderID: orderDoc._id,
                                    productID: product._id
                                };
                                utils.sendMessageToAzureBusQueue(process.env.AZURE_BUS_QUEUE_CLEARING_TRANSACTIONS, secondClearingTransaction);
                            }
                        });
                    }
                });
                orderDoc.transactionStatus = 'Refunded';
                orderDoc.orderStatus = 'Refunded';
                utils.sendMessageToAzureBusQueue(process.env.AZURE_BUS_TOPIC_ORDER_NEW, orderDoc);
                const logMessage = {};
                logMessage.responseTime = `${(new Date() - executionStart)} ms`; // duration in ms
                logMessage.result = 'Refund order call completed successfully';
                utils.logInfo(logMessage);
                context.res = {
                    body: {
                        description: 'Successfully refund payment transaction'
                    }
                };
            }
        })
        .catch(error => utils.handleError(context, error));
};
