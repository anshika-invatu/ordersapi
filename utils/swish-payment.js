const request = require('request');
//const utils = require('./');
const testKeyUtils = require('./ssl/test_key.js');
const testCertUtils = require('./ssl/test_cert.js');
//const testCaUtils = require('./ssl/test_ca');
const prodKeyUtils = require('./ssl/key_swish.vourity.com');
const prodCertUtils = require('./ssl/swish_certificate_202006050014');
//const { CustomLogs } = utils;
const Promise = require('bluebird');

exports.swishPayment = async (req, context, isTesting, swishPaymentID) => {
    context.log('swish process start');
    //CustomLogs(`req body for swish payment ${req}`, context);
    let options;
    if (swishPaymentID) {
        context.log('swish refund process start');
        //CustomLogs('req body for swish payment', context);
        options = await cancelRequestOptions(req, context, isTesting, swishPaymentID);
    } else {
        context.log('swish payment start');
        //CustomLogs('req body for cancel swish payment', context);
        options = await requestOptions(req, context, isTesting);
    }

    //CustomLogs(`options is ${options}`, context);

    context.log(options);
    return new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
            if (error) {
                context.log(error);
                return reject(error);
            } else {
                context.log(response);
                if (response.statusCode === 201) {
                    const result = {
                        location: response.headers['location'],
                        token: response.headers['paymentrequesttoken']
                    };
                    //CustomLogs(`location is ${result.location} and token is ${result.token}`, context);
                    return resolve(result);
                } else {
                    context.log(body);
                    //CustomLogs(`payment body is ${body}`, context);
                    return resolve(body);
                }
            }
        });
    });
};

async function requestOptions (req, context, isTesting) {

    const testConfig = {
        payeeAlias: process.env.SWISH_TEST_NUMBER,
        host: process.env.TESTING_SWISH_HOST,
        qrHost: process.env.SWISH_QR_HOST,
        cert: new Buffer(testCertUtils.cert, 'base64').toString('ascii'),
        key: new Buffer(testKeyUtils.key, 'base64').toString('ascii'),
        //ca: new Buffer(testCaUtils.ca, 'base64').toString('ascii'),
        passphrase: 'swish'
    };

    const prodConfig = {
        payeeAlias: req.payeeAlias,
        host: process.env.SWISH_HOST,
        qrHost: process.env.SWISH_QR_HOST,
        cert: new Buffer(prodCertUtils.cert, 'base64').toString('ascii'),
        key: new Buffer(prodKeyUtils.key, 'base64').toString('ascii'),
        passphrase: process.env.NEW_SWISH_PASSPHRASE
    };
    let config;
    if (isTesting) {
        config = testConfig;
    } else {
        config = prodConfig;
    }
    context.log(config.toString());
    const json = {
        payeePaymentReference: req.payeePaymentReference,
        callbackUrl: process.env.CALLBACK_URL,
        payeeAlias: config.payeeAlias.toString(),
        amount: req.amount.toString(),
        currency: req.currency,
        message: req.message
    };
    if (req.mobilePhone)
        json.payerAlias = req.mobilePhone;
    const options = {
        method: 'PUT',
        uri: `${config.host}/api/v2/paymentrequests/${req.payeePaymentReference}`,
        json: true,
        body: json,
        'content-type': 'application/json',
        cert: config.cert,
        key: config.key,
        passphrase: config.passphrase
    };
    if (isTesting) {
        options.ca = config.ca ? config.ca : null;
    }
    return options;
}

async function cancelRequestOptions (req, context, isTesting) {

    const testConfig = {
        payeeAlias: process.env.SWISH_TEST_NUMBER,
        host: process.env.TESTING_SWISH_HOST,
        qrHost: process.env.SWISH_QR_HOST,
        cert: new Buffer(testCertUtils.cert, 'base64').toString('ascii'),
        key: new Buffer(testKeyUtils.key, 'base64').toString('ascii'),
        passphrase: process.env.NEW_TEST_SWISH_PASSPHRASE
    };
    context.log(testConfig);
    const prodConfig = {
        payeeAlias: process.env.NEW_SWISH_NUMBER,
        host: process.env.SWISH_HOST,
        qrHost: process.env.SWISH_QR_HOST,
        cert: new Buffer(prodCertUtils.cert, 'base64').toString('ascii'),
        key: new Buffer(prodKeyUtils.key, 'base64').toString('ascii'),
        passphrase: process.env.NEW_SWISH_PASSPHRASE
    };
    context.log(prodConfig);
    let config;
    if (isTesting) {
        config = testConfig;
    } else {
        config = prodConfig;
    }
    //let instructionUUID = req.body.retailTransactionID.toUpperCase();
    //instructionUUID = instructionUUID.replace('-', '');
    const options = {
        method: 'PUT',
        uri: `${config.host}/api/v2/refunds/${req.instructionUUID}`,
        json: true,
        body: req.body.cancelBody,
        headers: { 'content-type': 'application/json' },
        cert: config.cert,
        key: config.key
    };
    if (isTesting) {
        options.ca = config.ca ? config.ca : null;
    } else {
        options.passphrase = config.passphrase;
    }
    return options;
}


