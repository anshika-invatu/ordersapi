'use strict';

const utils = require('../utils/index');
const { getMongodbCollection } = require('../db/mongodb');
const Promise = require('bluebird');
const request = require('request-promise');
const { CustomLogs } = utils;

//Please refer the story bac-444 for more details

module.exports = async function (context) {

    try {
        const collection = await getMongodbCollection('Orders');

        const orderAutoRefund = await collection.find({
            docType: 'orderAutoRefund',
            autoRefundAfterDate: { $lt: new Date() }
        }).toArray();

        context.log(orderAutoRefund);
        CustomLogs(orderAutoRefund, context);

        if (!orderAutoRefund && orderAutoRefund.length) {
            CustomLogs('There is no orderAutoRefund doc in database', context);
            context.log('There is no orderAutoRefund doc in database');
            return Promise.resolve();
        }
        await Promise.map(orderAutoRefund, async element => {
            if (!element.orderID) {
                CustomLogs(`There is no orderID in the orderAutoRefund doc for orderAutoRefundID = ${element._id} in database`, context);
                context.log(`There is no orderID in the orderAutoRefund doc for orderAutoRefundID = ${element._id} in database`);
                return Promise.resolve();
            }
            const order = await collection.findOne({
                _id: element.orderID,
                partitionKey: element.orderID,
                docType: 'order'
            });
            if (!order) {
                CustomLogs(`There is no order doc with this orderID = ${element.orderID} in database`, context);
                context.log(`There is no order doc with this orderID = ${element.orderID} in database`);
                return Promise.resolve();
            }
            const allVouchers = await request.get(`${process.env.VOUCHER_API_URL}/api/v1/order/${element.orderID}/vouchers`, {
                json: true,
                headers: {
                    'x-functions-key': process.env.VOUCHER_API_KEY
                }
            });
            if (!allVouchers && !allVouchers.length) {
                CustomLogs(`There is no vouchers doc for this orderID = ${element.orderID} in database`, context);
                context.log(`There is no vouchers doc for this orderID = ${element.orderID} in database`);
            }
            CustomLogs(`There is ${allVouchers.length} vouchers exist for this orderID = ${element.orderID} in database`, context);
            context.log(`There is ${allVouchers.length} vouchers exist for this orderID = ${element.orderID} in database`);

            if (order.transactionStatus === 'Refunded') {
                CustomLogs(`order for orderID = ${order._id} already refunded`, context);
                context.log(`order for orderID = ${order._id} already refunded`);
                return Promise.resolve();
            }
            let isAnyVoucherRedeemed = false;
            await Promise.map(allVouchers, async voucher => {
                CustomLogs(`voucherID is = ${voucher._id} for orderID = ${order._id}`, context);
                context.log(`voucherID is = ${voucher._id} for orderID = ${order._id}`);
                if (voucher && voucher.isRedeemed) {
                    isAnyVoucherRedeemed = true;
                }
            });
            if (isAnyVoucherRedeemed) {
                CustomLogs(`any voucher is redeem for orderID = ${order._id}`, context);
                context.log(`any voucher is redeem for orderID = ${order._id}`);
                return Promise.resolve();
            }
            let refunded;
            try {
                refunded = await request.post(process.env.FUNCTION_URL + '/api/v1/refund-order', {
                    body: {
                        orderID: element.orderID,
                        reasonForRefund: 'duplicate'
                    },
                    json: true,
                    headers: {
                        'x-functions-key': process.env.X_FUNCTIONS_KEY
                    }
                });
            } catch (err) {
                CustomLogs(`order is not refunded of orderID = ${order._id}`, context);
                context.log(`order is not refunded of orderID = ${order._id}`);
                context.log(err);
            }
            if (refunded) {
                const deletedOrderAutoRefund = await collection.deleteOne({
                    docType: 'orderAutoRefund',
                    orderID: element.orderID,
                    partitionKey: element.orderID
                });
                if (deletedOrderAutoRefund) {
                    CustomLogs('deleted count = ' + deletedOrderAutoRefund.deletedCount + 'of the orderAutoRefundId = ' + element._id, context);
                    context.log('deleted count = ' + deletedOrderAutoRefund.deletedCount + 'of the orderAutoRefundId = ' + element._id);
                }
            }
        });
        
    } catch (error) {
        context.log(error);
    }
};