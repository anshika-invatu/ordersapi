'use strict';


//BASE-239

module.exports = async (context) => {
   
    context.res = {
        body: {
            code: 200,
            text: 'ping'
        }
    };
};
