'use strict';

const utils = require('../utils');
const retailTransactionUtils = require('../utils/retail-transaction-pos');

module.exports = async (context, req) => {
    
    try {

        await utils.validateUUIDField(context, `${req.body._id}`, 'The _id specified in the request body does not match the UUID v4 format.');
        
        const oldZreport = await retailTransactionUtils.getOldZreport(req.body._id);
        
        let zreport;
        if (oldZreport && oldZreport.isOpen !== false) {
            zreport = await retailTransactionUtils.updateOldZreportStatus(req.body, oldZreport.posEvents, req.body.isManual, oldZreport);
        }

        if ((zreport && zreport.matchedCount) || (!oldZreport) || (oldZreport && oldZreport.isOpen === false)) {
            context.res = {
                body: {
                    description: 'Successfully updated the document'
                }
            };
        }
        
    } catch (error) {
        utils.handleError(context, error);
    }
};
