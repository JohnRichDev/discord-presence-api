const fs = require('fs');
const path = require('path');

const OPTOUT_PATH = path.join(__dirname, '..', 'optout.json');

function ensureOptOutFile() {
    if (!fs.existsSync(OPTOUT_PATH)) {
        fs.writeFileSync(OPTOUT_PATH, '[]');
    }
}

function loadOptOutList() {
    ensureOptOutFile();
    try {
        return new Set(JSON.parse(fs.readFileSync(OPTOUT_PATH, 'utf8')));
    } catch (e) {
        return new Set();
    }
}

function saveOptOutList(optOutSet) {
    ensureOptOutFile();
    fs.writeFileSync(OPTOUT_PATH, JSON.stringify([...optOutSet], null, 2));
}

module.exports = {
    loadOptOutList,
    saveOptOutList,
    ensureOptOutFile
};
