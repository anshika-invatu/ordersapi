'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const utils = require('../utils');
const uuid = require('uuid');
const errors = require('../errors');

module.exports = async (context, req) => {
    try {
        if (!req.body) {
            utils.setContextResError(
                context,
                new errors.EmptyRequestBodyError(
                    'You\'ve requested to pos session event but the request body seems to be empty. Kindly specify the request body in application/json format',
                    400
                )
            );
            return Promise.resolve();
        }
        if ((!req.body.posSessionID && !req.body.pointOfServiceID && !req.body.posSessionReferenceID) || !req.body.eventCode) {
            utils.setContextResError(
                context,
                new errors.FieldValidationError(
                    'Please pass atleast one of them(posSessionID, pointOfServiceID or posSessionReferenceID) and eventCode.',
                    400
                )
            );
            return Promise.resolve();
        }

        const collection = await getMongodbCollection('Orders');
        context.log('req body = ' + JSON.stringify(req.body));
        const query = { docType: 'posSessions' };
        if (req.body.posSessionID)
            query._id = req.body.posSessionID;
        if (req.body.posSessionReferenceID)
            query.posSessionReferenceID = req.body.posSessionReferenceID;
        if (req.body.pointOfServiceID)
            query.pointOfServiceID = req.body.pointOfServiceID;
        if (req.body.pointOfServiceID && !req.body.posSessionID && !req.body.posSessionReferenceID) {
            query.sessionStateCode = 'pending';
        }
        context.log('Pos Session Query = ' + JSON.stringify(query));
        const posSessionDocs = await collection.find(query).sort({ createdDate: 1 })
            .toArray();

        let posSessionDoc;

        if (!posSessionDocs || posSessionDocs.length < 1) {
            utils.setContextResError(
                context,
                new errors.POSSessionNotFoundError(
                    'The pos session detail specified doesn\'t exist.',
                    404
                )
            );
            return Promise.resolve();
        } else if (posSessionDocs.length > 0) {
            posSessionDoc = posSessionDocs[0];
        }
        context.log('Pos Session Doc = ' + JSON.stringify(posSessionDoc));
        const posUpdated = await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
            { $set: { eventCode: req.body.eventCode, _ts: new Date(), ttl: 60 * 60 * 14, updatedDate: new Date() }});
        if (posUpdated && posUpdated.matchedCount)
            context.log('posSession updated');
        if (!req.body.pointOfServiceID)
            req.body.pointOfServiceID = posSessionDoc.pointOfServiceID;

        let result;


        if (req.body.eventCode === 'posStartSessionRequestAccepted' && posSessionDoc.salesChannel) {
            context.log('Start Session Accepted');
            await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                { $set: Object.assign({}, { sessionStateCode: 'starting' }, { updatedDate: new Date() }) });
        } else if (req.body.eventCode === 'posStartSessionRequestDenied' && posSessionDoc.salesChannel) {
            context.log('Start Session Denied');
            await collection.updateOne({ _id: posSessionDoc._id, docType: 'posSessions', partitionKey: posSessionDoc._id },
                { $set: Object.assign({}, { sessionStateCode: 'denied', docType: 'posSessionsOld' }, { updatedDate: new Date() }) });
        }

        if (result) {
            const updatedPosSession = await collection.findOne({ _id: posSessionDoc._id, partitionKey: posSessionDoc.partitionKey, $or: [{ 'docType': 'posSessions' }, { 'docType': 'posSessionsOld' }]});
            const log = Object.assign({}, updatedPosSession, { posSessionID: updatedPosSession._id, _id: uuid.v4(), docType: 'posSessionLog', updatedDate: new Date() });
            await collection.insertOne(log);

            context.res = {
                body: {
                    description: 'Successfully send pos session event.'
                }
            };
        }
    } catch (error) {
        context.log(error);
        utils.handleError(context, error);
    }
};

exports.createCartProduct = (product) => {
    const cartProduct = {
        productID: product._id,
        productEAN: product.productEAN,
        productGCN: product.productGCN,
        productName: product.productName,
        productDescription: product.productDescription,
        productTypeID: product.productTypeID,
        productTypeCode: product.productTypeCode,
        productTypeName: product.productTypeName,
        productTypeIconURL: product.productTypeIconURL,
        productCategoryID: product.productCategories ? product.productCategories[0].productCategoryID : '',
        productCategoryName: product.productCategories ? product.productCategories[0].productCategoryName : '',
        productCategoryIconURL: product.productCategories ? product.productCategories[0].productCategoryIconURL : '',
        conditions: product.conditions,
        imageURL: product.imageURL,
        voucherType: product.voucherType,
        isEnabledForSale: product.isEnabledForSale,
        issuer: product.issuer,
        salesPrice: product.salesPrice,
        amount: product.salesPrice,
        vatPercent: product.vatPercent,
        vatAmount: product.vatAmount,
        currency: product.currency,
        salesPeriodStart: product.validPeriod ? product.validPeriod.salesPeriodStart : '',
        salesPeriodEnd: product.validPeriod ? product.validPeriod.salesPeriodEnd : ''
    };
    return cartProduct;
};
