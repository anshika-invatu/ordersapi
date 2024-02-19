'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');


let db;

/**
 * Get MongoDB collection object
 * @param {string} name - collection name
 * @returns {Promise<Collection>} A Promise that resolves to the collection object
 */
exports.getMongodbCollection = async (name) => {
    console.log('name',name);
    if (db) {
        return db.collection(name);
    } else {
        const client = await MongoClient.connect(process.env.MONGODB_URL, { useNewUrlParser: true });
        db = client.db(process.env.MONGODB_DB);
        return db.collection(name);
    }
};








// 'use strict';

// const Promise = require('bluebird');
// const MongoClient = require('mongodb').MongoClient;

// let db;

// /**
//  * Get MongoDB client object
//  * @returns {Promise<any>|Promise<db>}
//  */
// exports.getMongodbCollection = name => {
//     if (db) {
//         return Promise.resolve(db.collection(name));
//     } else {
//         return MongoClient
//             .connect(process.env.MONGODB_URL, {
//                 promiseLibrary: Promise
//             })
//             .then(client => {
//                 db = client.db(process.env.MONGODB_DB);
//                 return db.collection(name);
//             });
//     }
// };
