'use strict';

const ENABLED = false;

function noop () {
    // do nothing
}

if (ENABLED) {
    const winston = require('winston');
    require('winston-loggly-bulk');

    winston.configure({
        transports: [
            new winston.transports.Loggly({
                token: process.env.LOGGLY_TOKEN,
                subdomain: 'vourity',
                tags: ['Winston-NodeJS'],
                json: true
            })
        ]
    });

    exports.logEvents = (message) => {
        const error = Object.assign({}, message);
        error.functionName = 'OrderApi';
        winston.log('error', error);
    };

    exports.logInfo = (message) => {
        if (typeof(message) === 'string') {
            message  = { message: message };
        }
        const logMessage = Object.assign({}, message);
        logMessage.functionName = 'OrderApi';
        winston.info(logMessage);
    };
} else {
    exports.logEvents = noop;
    exports.logInfo = noop;
}