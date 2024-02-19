'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const errors = require('../errors');
const Promise = require('bluebird');


//Please refer the story BASE-360 for more details

module.exports = async (context, req) => {
    try {
        await utils.validateUUIDField(context, req.params.id, 'The _id specified in the request does not match the UUID v4 format.');

        const collection = await getMongodbCollection('Orders');

        const query = {};

        if (req.body.retailTransactionID) {
            query._id = req.body.retailTransactionID;
            query.docType = 'retailTransaction';
            query.partitionKey = req.body.retailTransactionID;
        }

        if (req.body.bookingID) {
            query._id = req.body.bookingID;
            query.docType = 'bookings';
            query.partitionKey = req.body.bookingID;
        }

        const doc = await collection.findOne(query);
        let retailTransaction;
        if (doc && doc.docType === 'bookings') {
            retailTransaction = await collection.findOne({
                _id: doc.retailTransactionID,
                docType: 'retailTransaction',
                partitionKey: doc.retailTransactionID
            });
        } else if (doc && doc.docType === 'retailTransaction') {
            retailTransaction = doc;
        }
        if (retailTransaction && retailTransaction.merchantID !== req.params.id) {
            utils.setContextResError(
                context,
                new errors.UserNotAuthenticatedError(
                    'This user not have authentication to send receipt.',
                    401
                )
            );
            return Promise.resolve();
        }
        const receipt = await collection.findOne({
            retailTransactionID: retailTransaction._id,
            docType: 'receipts'
        });
        if (!receipt) {
            utils.setContextResError(
                context,
                new errors.ReceiptNotFoundError(
                    'The Receipt doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        }
        let email, mobilePhone;
        if (req.body.email) email = req.body.email;
        else email = receipt.customer ? receipt.customer.email : '';

        if (req.body.mobilePhone) mobilePhone = req.body.mobilePhone;
        else mobilePhone = receipt.customer ? receipt.customer.mobilePhone : '';
        const messageText = await this.messageText(receipt.countryCode, receipt.merchantName, receipt._id);
        if (mobilePhone)
            await this.sendSms(mobilePhone, messageText, receipt.countryCode, receipt.merchantID);
        if (email)
            await this.sendEmail(email, receipt.countryCode, messageText);

        context.res = {
            body: {
                description: 'Successfully send receipt.'
            }
        };
    } catch (error) {
        utils.handleError(context, error);
    }
};

exports.sendSms = (mobilePhone, messageText, countryCode, merchantID) => {
    const notificationDoc = {};
    notificationDoc._id = uuid.v4();
    notificationDoc.docType = 'notification';
    notificationDoc.receiver = {};
    notificationDoc.receiver.receiverPhone = mobilePhone;
    notificationDoc.messageText = messageText;
    notificationDoc.merchantID = merchantID;
    notificationDoc.notificationType = 'sms';
    notificationDoc.countryCode = countryCode;
    notificationDoc.createdDate = new Date();
    notificationDoc.updatedDate = new Date();
    notificationDoc.sentDate = new Date();
    utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_NOTIFICATION_SMS, notificationDoc);
};

exports.sendEmail = (email, countryCode, messageText) => {
    const notificationDoc = {};
    notificationDoc._id = uuid.v4();
    notificationDoc.docType = 'notification';
    notificationDoc.receiver = {};
    notificationDoc.receiver.receiverMail = email;
    notificationDoc.messageText = messageText;
    notificationDoc.notificationType = 'email';
    notificationDoc.countryCode = countryCode;
    notificationDoc.createdDate = new Date();
    notificationDoc.updatedDate = new Date();
    notificationDoc.sentDate = new Date();
    notificationDoc.messageSubject = 'Receipt';
    utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_NOTIFICATION_EMAIL, notificationDoc);
};

exports.messageText = (countryCode, merchantName, receiptID) => {
    let message;
    if (countryCode === 'SE')
        message = `Här kommer länk till kvittot på ditt köp hos ${merchantName}: ${process.env.MESSAGE_LINK}/receipt/${receiptID}`;
    if (countryCode === 'EN')
        message = `Here you get the link to the receipt for your purchase at ${merchantName}: ${process.env.MESSAGE_LINK}/receipt/${receiptID}`;
    if (countryCode === 'DK')
        message = `Här kommer länk till kvittot på ditt köp hos ${merchantName}: ${process.env.MESSAGE_LINK}/receipt/${receiptID}`;
    if (countryCode === 'NO')
        message = `Här kommer länk till kvittot på ditt köp hos ${merchantName}: ${process.env.MESSAGE_LINK}/receipt/${receiptID}`;
    return message;
};
