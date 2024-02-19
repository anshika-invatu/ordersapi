'use strict';

const uuid = require('uuid');
const helpers = require('../spec/helpers');
const request = require('request-promise');
const crypto = require('crypto');
const Promise = require('bluebird');
const randomString = crypto.randomBytes(3).toString('hex');
const email = `test.${randomString}@vourity.com`;
const randomString2 = crypto.randomBytes(3).toString('hex');
const email2 = `test.${randomString2}@vourity.com`;
const { getMongodbCollection } = require('../db/mongodb');
const expect = require('chai').expect;
const merchantID = uuid.v4();
const webshopID = uuid.v4();
const productID = uuid.v4();

const requestBody = {
    merchantID: merchantID,
    webshopID: webshopID,
    productID: productID,
    sendDate: new Date('2019-10-22'),
    receiversList: [{
        email: email,
        mobilePhone: '+9123456987'
    },
    {
        email: email2,
        mobilePhone: '+9189345698'
    }]
};
describe('create-low-value-orders', () => {

    it('should save orderdoc', async () => {
        const result = await request.post(helpers.API_URL + '/api/v1/low-value-orders', {
            body: requestBody,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        });
        expect(result).not.to.be.null;
        expect(result[0].webshopID).to.eql(webshopID);
        expect(result[1].webshopID).to.eql(webshopID);
        expect(result[0].productID).to.eql(productID);
        expect(result[1].productID).to.eql(productID);
        expect(result[0].receiverEmail).to.eql(email);
        expect(result[1].receiverEmail).to.eql(email2);
        expect(result[0].docType).to.eql('lowValueOrder');
        expect(result[1].docType).to.eql('lowValueOrder');
        expect(result[0].receiverMobilePhone).to.eql('+9123456987');
        expect(result[1].receiverMobilePhone).to.eql('+9189345698');

        const collection = await getMongodbCollection('Orders');
        const allReq = [];
        if (result && Array.isArray(result)) {
            result.forEach(element => {
                allReq.push(collection.deleteOne({ _id: element._id, partitionKey: element.partitionKey, docType: 'lowValueOrder' }));
            });
            await Promise.all(allReq);
        }
    });
});