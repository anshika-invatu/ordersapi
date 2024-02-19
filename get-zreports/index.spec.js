'use strict';

const expect = require('chai').expect;
const helpers = require('../spec/helpers');
const request = require('request-promise');
const uuid = require('uuid');
const merchantID = uuid.v4();
const moment = require('moment');
const sampleZReport = { ...require('../spec/sample-docs/ZReport'), _id: uuid.v4() };
const sampleZReport2 = { ...require('../spec/sample-docs/ZReport'), _id: uuid.v4() };
const collectionName = 'Orders';
const { getMongodbCollection } = require('../db/mongodb');
sampleZReport.pointOfServiceID = uuid.v4();
sampleZReport.partitionKey = sampleZReport.pointOfServiceID;
sampleZReport.merchantID = merchantID;
sampleZReport2.pointOfServiceID = uuid.v4();
sampleZReport2.partitionKey = sampleZReport.pointOfServiceID;
sampleZReport2.merchantID = merchantID;
const date = moment().subtract(6,'d')
    .format('YYYY-MM-DD');
sampleZReport.createdDate = new Date(date);
sampleZReport2.createdDate = new Date();


describe('Get ZReports', () => {
    before(async () => {
        const collection = await getMongodbCollection(collectionName);
        await collection.insertOne(sampleZReport);
        await collection.insertOne(sampleZReport2);
    });

    it('should get the document when all validation passes', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/zreports`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: { userMerchants: [merchantID]}
        });
        expect(result).not.to.be.null;
        expect(result).to.be.instanceOf(Array);

    });

    it('should get the document when all validation passes(with pointOfServiceID)', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/zreports?pointOfServiceID=${sampleZReport.pointOfServiceID}`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: { userMerchants: [merchantID]}
        });
        expect(result).not.to.be.null;
        expect(result).to.be.instanceOf(Array);
        expect(result).to.be.instanceOf(Array).and.have.lengthOf(1);
        expect(result[0]._id).to.eql(sampleZReport._id);

    });

    it('should get the document when all validation passes(with all params)', async () => {
        const result = await request.get(`${helpers.API_URL}/api/v1/zreports?pointOfServiceID=${sampleZReport.pointOfServiceID}
        &fromDate=2020-09-13&toDate=2020-09-15`, {
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            },
            body: { userMerchants: [merchantID]}
        });
        expect(result).not.to.be.null;
        expect(result).to.be.instanceOf(Array);

    });

    after(async () => {
        const walletCollection = await getMongodbCollection(collectionName);
        await walletCollection.deleteOne({ _id: sampleZReport._id, docType: 'zreport', partitionKey: sampleZReport.pointOfServiceID });
        await walletCollection.deleteOne({ _id: sampleZReport2._id, docType: 'zreport', partitionKey: sampleZReport2.pointOfServiceID });
    });
});