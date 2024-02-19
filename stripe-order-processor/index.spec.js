'use strict';

//const utils = require('../utils');
const uuid = require('uuid');
//const Promise = require('bluebird');
//const expect = require('chai').expect;
const { getMongodbCollection } = require('../db/mongodb');
const sampleProduct = { ...require('../spec/sample-docs/Products'), _id: uuid.v4() };
sampleProduct.partitionKey = sampleProduct._id;
const sampleWebshop = { ...require('../spec/sample-docs/Webshop'), _id: uuid.v4(), ownerMerchantID: uuid.v4() };
const sampleCheckoutSession = { ...require('../spec/sample-docs/CheckoutSession'), _id: uuid.v4() };
const sampleCartProduct = { ...require('../spec/sample-docs/CartProduct'), _id: uuid.v4() };
sampleCheckoutSession.userSessionID = uuid.v4();
sampleCartProduct._id = sampleCheckoutSession.userSessionID;
sampleCartProduct.partitionKey = sampleCheckoutSession.userSessionID;
sampleCheckoutSession.partitionKey = sampleCheckoutSession.userSessionID;
sampleCheckoutSession.paymentProviderSessionID = 'cs_test_q8k4uvUfguduMfQGfSfDcHkaH5UR9me6ucxpsgQPP5wBkKRsR1sKFNZO';
const sampleEvent = { ...require('../spec/sample-docs/event') };
sampleCheckoutSession.products.salesPeriodStart = new Date();
sampleCheckoutSession.products.salesPeriodEnd = new Date();
sampleCheckoutSession.createdDate = new Date();
sampleCheckoutSession.updatedDate = new Date();

sampleWebshop.products = [
    {
        productID: sampleProduct,
        productEAN: '1234567890ADFFF',
        productGCN: '1234567890ADFFF234324',
        productName: 'The blue product',
        productDescription: 'Some description of the Product',
        conditions: 'Some text about special conditions in text about how to use the voucher',
        imageURL: 'https://media.vourity.com/blueburger.png',
        voucherType: 'giftvoucher',
        isEnabledForSale: true,
        issuer: {
            merchantID: uuid.v4(),
            merchantName: 'Vasamuseet'
        },
        location: {
            city: 'Stockholm',
            country: 'Sweden'
        },
        salesPrice: 123456789.00,
        vatPercent: 25.00,
        vatAmount: 2.35,
        currency: 'SEK',
        salesPeriodStart: '2017-10-16T00:00:00Z',
        salesPeriodEnd: '2017-10-16T00:00:00Z'
    }
];
sampleEvent.data.object.client_reference_id = sampleCheckoutSession.userSessionID;
sampleEvent.data.object.id = 'cs_test_q8k4uvUfguduMfQGfSfDcHkaH5UR9me6ucxpsgQPP5wBkKRsR1sKFNZO';

describe('stripe-order-processor', () => {

    before(async () => {
        sampleWebshop.partitionKey = sampleWebshop.ownerMerchantID;
        const collection = await getMongodbCollection('Merchants');
        await collection.insertOne(sampleWebshop);
        await collection.insertOne(sampleProduct);
        await collection.insertOne(sampleCartProduct);
        const orderCollection = await getMongodbCollection('Orders');
        await orderCollection.insertOne(sampleCheckoutSession);
    });

    it('should update product in webshop when all case pass', async () => {
        //const collection = await getMongodbCollection('Merchants');
       
        // try {
        //     await utils.sendMessageToAzureBus(process.env.AZURE_BUS_TOPIC_INBOX_STRIPE, sampleEvent);
        // } catch (err) {
        //     console.log(err);
        // }

        // await Promise.delay(50000);
        
        // const webshop = await collection.findOne({ _id: sampleWebshop._id, docType: 'webshop', partitionKey: sampleWebshop.ownerMerchantID });
        // expect(webshop).not.to.be.null;
        // expect(webshop.products).not.to.be.null;
        // const product = await collection.findOne({ _id: sampleProduct._id, partitionKey: sampleProduct._id, docType: 'products' });
        // expect(product).not.to.be.null;
        // const orderCollection = await getMongodbCollection('Orders');
        // const checkoutSession = await orderCollection.findOne({ _id: sampleCheckoutSession._id, partitionKey: sampleCheckoutSession.userSessionID, docType: 'checkoutSessionCompleted' });
        // expect(checkoutSession).not.to.be.null;
        
    });
    
    after(async () => {
        const collection = await getMongodbCollection('Merchants');
        await collection.deleteOne({ _id: sampleWebshop._id, docType: 'webshop', partitionKey: sampleWebshop.ownerMerchantID });
        await collection.deleteOne({ _id: sampleProduct._id, partitionKey: sampleProduct._id, docType: 'products' });
    });
});
