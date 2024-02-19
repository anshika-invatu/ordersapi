'use strict';

const { getMongodbCollection } = require('../db/mongodb');
const request = require('request-promise');
const moment = require('moment');




module.exports = async function (context) {
    try {
        const collection = await getMongodbCollection('Orders');
        const previousMonthStartDate = moment().subtract(1, 'months')
            .startOf('months')
            .format('YYYY-MM-DD');
        const previousMonthEndDate = moment().subtract(1, 'months')
            .endOf('months')
            .format('YYYY-MM-DD');
        const retailTransactions = await collection.aggregate([
            { $match: { docType: 'retailTransaction', retailTransactionDate: {
                $gte: new Date(previousMonthStartDate),
                $lte: new Date(previousMonthEndDate)
            }}},
            { '$group': { _id: '$currency', count: { $sum: 1 }, totalAmountInclVat: { $sum: '$totalAmountInclVat' }}}
        ]).toArray();
        context.log(retailTransactions);
        let emailBody = `Monthly sales summaery created: ${moment().format('YYYY-MM-DD')}
        Report time period: ${previousMonthStartDate} to ${previousMonthEndDate}`;
        for (let i = 0; i < retailTransactions.length; i++) {
            const element = retailTransactions[i];
            emailBody = emailBody + `
            ${element._id}, ${element.count} transactions with total amount ${element.totalAmountInclVat}`;
        }

        const body = {
            messageSubject: `Vourity Retail Transactions Report ${moment().format('YYYY-MM-DD')}`,
            emailBody: emailBody
        };
        await request.post(`${process.env.NOTIFICATION_SERVICE_API_URL}/api/${process.env.NOTIFICATION_SERVICE_API_VERSION}/retail-trans-statistics-sender`, {
            body: body,
            json: true,
            headers: {
                'x-functions-key': process.env.NOTIFICATION_SERVICE_API_KEY
            }
        });
    } catch (error) {
        context.log(error);
    }
    
};