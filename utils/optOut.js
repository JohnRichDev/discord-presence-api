const { loadOptOutList, saveOptOutList } = require('./fileSystem');

let optOutSet = loadOptOutList();

function isOptedOut(userId) {
    return optOutSet.has(userId);
}

function optOutUser(userId) {
    optOutSet.add(userId);
    saveOptOutList(optOutSet);
}

function optInUser(userId) {
    optOutSet.delete(userId);
    saveOptOutList(optOutSet);
}

function refreshOptOutList() {
    optOutSet = loadOptOutList();
}

module.exports = {
    isOptedOut,
    optOutUser,
    optInUser,
    refreshOptOutList
};
