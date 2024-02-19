'use strict';

const chai = require('chai');
const request = require('request-promise');
const chaiAsPromised = require('chai-as-promised');
const { getMongodbCollection } = require('../../db/mongodb');
const existingDocuments = [];
const existingWalletsDocuments = [];
const existingWalletInboxDocuments = [];
const existingWalletFriendsDocuments = [];

chai.use(chaiAsPromised);

exports.API_URL = process.env.FUNCTION_STAGING_URL || 'http://localhost:7071';

exports.saveExistingDocuments = async collectionName => {
    existingDocuments.length = 0;
    const collection = await getMongodbCollection(collectionName);
    const result = await collection.find({ docType: 'order' }).toArray();
    existingDocuments.push(...result);
};

exports.restoreExistingDocuments = async collectionName => {
    const collection = await getMongodbCollection(collectionName);
    await collection.deleteMany({ docType: 'order' });
    if (existingDocuments.length) {
        await collection.insertMany(existingDocuments);
    }
};

exports.createTestDocuments = async (collectionName, document) => {
    const collection = await getMongodbCollection(collectionName);
    await collection.insertOne(document);
};

exports.removeTestDocuments = async collectionName => {
    const collection = await getMongodbCollection(collectionName);
    await collection.deleteMany({ docType: 'order' });
};

exports.triggerAzureFunction = async (name, args = {}) => {
    try {
        const options = {
            method: 'POST',
            uri: `${this.API_URL}/admin/functions/${name}`,
            body: args,
            json: true,
            headers: {
                'x-functions-key': process.env.X_FUNCTIONS_KEY
            }
        };

        await request(options);
    } catch (error) {
        return Promise.reject(error);
    }
};

exports.removeWalletTestDocuments = async collectionName => {
    const collection = await getMongodbCollection(collectionName);
    await collection.deleteMany({ docType: 'wallets' });
    await collection.deleteMany({ docType: 'walletInbox' });
    await collection.deleteMany({ docType: 'walletFriends' });

};

exports.saveWalletExistingDocuments = async collectionName => {
    existingWalletsDocuments.length = 0;
    existingWalletInboxDocuments.length = 0;
    existingWalletFriendsDocuments.length = 0;
    const collection = await getMongodbCollection(collectionName);

    const result0 = await collection.find({ docType: 'wallets' }).toArray();
    const result1 = await collection.find({ docType: 'walletInbox' }).toArray();
    const result2 = await collection.find({ docType: 'walletFriends' }).toArray();

    existingWalletsDocuments.push(...result0);
    existingWalletInboxDocuments.push(...result1);
    existingWalletFriendsDocuments.push(...result2);

    await this.removeWalletTestDocuments(collectionName);
};

exports.restoreWalletExistingDocuments = async collectionName => {
    const collection = await getMongodbCollection(collectionName);
    await this.removeWalletTestDocuments(collectionName);

    if (existingWalletsDocuments.length) {
        await collection.insertMany(existingWalletsDocuments);
    }

    if (existingWalletInboxDocuments.length) {
        await collection.insertMany(existingWalletInboxDocuments);
    }

    if (existingWalletFriendsDocuments.length) {
        await collection.insertMany(existingWalletFriendsDocuments);
    }
};