'use strict';

const utils = require('../utils');
const stripe = require('stripe')(process.env.STRIPE_API_KEY);

module.exports = async (context, req) => {
    try {
        let result;
        if (req.body.pspName && req.body.pspName.toLowerCase() === 'stripe') {
            result = await stripe.charges.create({
                amount: Number(req.body.walletAmount) * 100,
                currency: req.body.currency,
                description: req.body.walletDescription,
                source: req.body.stripeToken,
                receipt_email: req.body.email
            });
        }
        context.res = {
            body: result
        };
        
    } catch (error) {
        utils.handleError(context, error);
    }
};
