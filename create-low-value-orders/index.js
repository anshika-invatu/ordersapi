'use strict';


const utils = require('../utils');
const uuid = require('uuid');
const moment = require('moment');
const { getMongodbCollection } = require('../db/mongodb');

module.exports = async (context, req) => {
    try {
        const lowValueOrderDocs = [];
        if (req.body.receiversList && Array.isArray(req.body.receiversList)) {
            const sendDate = moment(req.body.sendDate).format('YYYY-MM-DD');
            const lowValueOrderPartitionKey = `LOWVALUEORDER-${sendDate}`;
            req.body.receiversList.forEach(element => {
                const lowValueOrder = {
                    _id: uuid.v4(),
                    docType: 'lowValueOrder',
                    partitionKey: lowValueOrderPartitionKey,
                    orderDate: new Date(),
                    productID: req.body.productID,
                    webshopID: req.body.webshopID,
                    isSent: false,
                    _ts: new Date(),
                    ttl: 60 * 60 * 24 * 30,
                    createdDate: new Date(),
                    updatedDate: new Date()
                };
                if (element.mobilePhone) {
                    lowValueOrder.receiverMobilePhone = element.mobilePhone;
                }
                if (element.email) {
                    lowValueOrder.receiverEmail = element.email;
                }
                lowValueOrderDocs.push(lowValueOrder);
            });
        }
        const collection = await getMongodbCollection('Orders');
        const lowValueOrders = await collection.insertMany(lowValueOrderDocs);
        if (lowValueOrders && lowValueOrders.ops) {
            const order = lowValueOrders.ops;
            context.res = {
                body: order
            };
        }
    } catch (error) {
        utils.handleError(context, error);
        return;
    }
    return;
};