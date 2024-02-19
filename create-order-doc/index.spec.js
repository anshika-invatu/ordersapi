'use strict';

const uuid = require('uuid');
const orderID = uuid.v4();
const helpers = require('../spec/helpers');
const request = require('request-promise');
const { getMongodbCollection } = require('../db/mongodb');
const expect = require('chai').expect;

const pendingOrder = {
    _id: orderID,
    docType: 'order',
    orderDate: new Date(),
    orderStatus: 'pending',
    transactionID: uuid.v4(),
    transactionStatus: 'paid',
    amountPaid: 120,
    vatAmount: 100,
    currency: 'SEK',
    webShopID: uuid.v4(),
    webShopName: 'webShopName',
    customerEmail: 'abc@gmail.com',
    receiverEmail: 'abc@gmail.com',
    products: [{ 'productID': uuid.v4() }],
    createdDate: new Date(),
    updatedDate: new Date(),
    partitionKey: orderID,
    sellerMerchantID: uuid.v4()
};
describe('create-order-doc', () => {

    it('should save orderdoc', async () => {
        const order = await request.post(helpers.API_URL + '/api/v1/orders-doc', {
            body: pendingOrder,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(order).not.to.be.null;
        expect(order._id).to.equal(pendingOrder._id);
        const collection = await getMongodbCollection('Orders');
        await collection.deleteOne({ _id: pendingOrder._id, docType: 'order', partitionKey: pendingOrder._id });
    });
});