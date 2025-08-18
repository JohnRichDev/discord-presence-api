const { isOptedOut, optOutUser, optInUser } = require('./optOut');
const { deepEqual, corsOriginCheck, getMember, formatUserData } = require('./helpers');

module.exports = {
    isOptedOut,
    optOutUser,
    optInUser,
    deepEqual,
    corsOriginCheck,
    getMember,
    formatUserData
};
