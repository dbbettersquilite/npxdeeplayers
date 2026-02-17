const { getGroupConfig, setGroupConfig, deleteGroupToggle, getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');
const db = require('../Database/database');
const { migrateFromJson, cleanupLegacyFiles } = require('../Database/migration');

migrateFromJson();

function loadUserGroupData() {
    try {
        const result = {
            antibadword: {},
            antilink: {},
            antitag: {},
            antimention: {},
            antigroupmention: {},
            antidemote: {},
            antisticker: {},
            antiimage: {},
            antiaudio: {},
            antidocument: {},
            antifiles: {},
            antipromote: {},
            antivideo: {},
            antibug: {},
            antichart: {},
            welcome: {},
            goodbye: {},
            chatbot: {},
            warnings: {},
            sudo: db.getAllSudoUsers()
        };

        const allGroupJids = db.getAllGroupJids();
        for (const groupJid of allGroupJids) {
            const settings = db.getAllGroupSettings(groupJid);
            for (const [key, value] of Object.entries(settings)) {
                if (result.hasOwnProperty(key)) {
                    result[key][groupJid] = value;
                }
            }
        }

        result.warnings = db.getAllWarnings();

        return result;
    } catch (error) {
        console.error('Error loading user group data:', error);
        return {
            antibadword: {},
            antilink: {},
            antitag: {},
            antimention: {},
            antigroupmention: {},
            antidemote: {},
            antisticker: {},
            antiimage: {},
            antiaudio: {},
            antidocument: {},
            antifiles: {},
            antipromote: {},
            antivideo: {},
            antibug: {},
            antichart: {},
            welcome: {},
            goodbye: {},
            chatbot: {},
            warnings: {},
            sudo: []
        };
    }
}

function saveUserGroupData(data) {
    try {
        if (data.sudo && Array.isArray(data.sudo)) {
            const currentSudo = db.getAllSudoUsers();
            for (const user of data.sudo) {
                if (!currentSudo.includes(user)) {
                    db.addSudoUser(user);
                }
            }
        }
        
        const features = [
            'antibadword', 'antilink', 'antitag', 'antimention', 'antigroupmention',
            'antidemote', 'antisticker', 'antiimage', 'antiaudio', 'antidocument',
            'antifiles', 'antipromote', 'antivideo', 'antibug', 'antichart',
            'welcome', 'goodbye', 'chatbot'
        ];
        
        for (const feature of features) {
            if (data[feature] && typeof data[feature] === 'object') {
                for (const [groupId, config] of Object.entries(data[feature])) {
                    setGroupConfig(groupId, feature, config);
                }
            }
        }
        
        if (data.warnings && typeof data.warnings === 'object') {
            for (const [groupId, users] of Object.entries(data.warnings)) {
                if (typeof users === 'object') {
                    for (const [userId, count] of Object.entries(users)) {
                        db.setWarningCount(groupId, userId, count);
                    }
                }
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error saving user group data:', error);
        return false;
    }
}

async function setAntilink(groupId, type, action) {
    setGroupConfig(groupId, 'antilink', {
        enabled: type === 'on' || type === 'delete' || type === 'kick' || type === 'warn',
        action: action || 'delete'
    });
    return true;
}

async function getAntilink(groupId) {
    return getGroupConfig(groupId, 'antilink');
}

async function removeAntilink(groupId) {
    deleteGroupToggle(groupId, 'antilink');
    return true;
}

async function setAntimention(groupId, type, action, maxMentions = 5) {
    setGroupConfig(groupId, 'antimention', {
        enabled: type === 'on' || type === true,
        action: action || 'delete',
        maxMentions: maxMentions
    });
    return true;
}

async function getAntimention(groupId) {
    return getGroupConfig(groupId, 'antimention');
}

async function removeAntimention(groupId) {
    deleteGroupToggle(groupId, 'antimention');
    return true;
}

async function setAntitag(groupId, type, action) {
    setGroupConfig(groupId, 'antitag', {
        enabled: type === 'on',
        action: action || 'delete'
    });
    return true;
}

async function getAntitag(groupId) {
    return getGroupConfig(groupId, 'antitag');
}

async function removeAntitag(groupId) {
    deleteGroupToggle(groupId, 'antitag');
    return true;
}

async function setAntigroupmention(groupId, type, action) {
    setGroupConfig(groupId, 'antigroupmention', {
        enabled: type === 'on',
        action: action || 'delete'
    });
    return true;
}

async function getAntigroupmention(groupId) {
    return getGroupConfig(groupId, 'antigroupmention');
}

async function removeAntigroupmention(groupId) {
    deleteGroupToggle(groupId, 'antigroupmention');
    return true;
}

async function setAntidemote(groupId, type) {
    setGroupConfig(groupId, 'antidemote', {
        enabled: type === 'on' || type === true
    });
    return true;
}

async function getAntidemote(groupId) {
    return getGroupConfig(groupId, 'antidemote');
}

async function removeAntidemote(groupId) {
    deleteGroupToggle(groupId, 'antidemote');
    return true;
}

async function setAntipromote(groupId, type) {
    setGroupConfig(groupId, 'antipromote', {
        enabled: type === 'on' || type === true
    });
    return true;
}

async function getAntipromote(groupId) {
    return getGroupConfig(groupId, 'antipromote');
}

async function removeAntipromote(groupId) {
    deleteGroupToggle(groupId, 'antipromote');
    return true;
}

async function setAntisticker(groupId, type, action) {
    setGroupConfig(groupId, 'antisticker', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntisticker(groupId) {
    return getGroupConfig(groupId, 'antisticker');
}

async function removeAntisticker(groupId) {
    deleteGroupToggle(groupId, 'antisticker');
    return true;
}

async function setAntiimage(groupId, type, action) {
    setGroupConfig(groupId, 'antiimage', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntiimage(groupId) {
    return getGroupConfig(groupId, 'antiimage');
}

async function removeAntiimage(groupId) {
    deleteGroupToggle(groupId, 'antiimage');
    return true;
}

async function setAntiaudio(groupId, type, action) {
    setGroupConfig(groupId, 'antiaudio', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntiaudio(groupId) {
    return getGroupConfig(groupId, 'antiaudio');
}

async function removeAntiaudio(groupId) {
    deleteGroupToggle(groupId, 'antiaudio');
    return true;
}

async function setAntidocument(groupId, type, action) {
    setGroupConfig(groupId, 'antidocument', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntidocument(groupId) {
    return getGroupConfig(groupId, 'antidocument');
}

async function removeAntidocument(groupId) {
    deleteGroupToggle(groupId, 'antidocument');
    return true;
}

async function setAntifiles(groupId, type, action) {
    setGroupConfig(groupId, 'antifiles', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntifiles(groupId) {
    return getGroupConfig(groupId, 'antifiles');
}

async function removeAntifiles(groupId) {
    deleteGroupToggle(groupId, 'antifiles');
    return true;
}

async function setAntivideo(groupId, type, action) {
    setGroupConfig(groupId, 'antivideo', {
        enabled: type === 'on' || type === true,
        action: action || 'delete'
    });
    return true;
}

async function getAntivideo(groupId) {
    return getGroupConfig(groupId, 'antivideo');
}

async function removeAntivideo(groupId) {
    deleteGroupToggle(groupId, 'antivideo');
    return true;
}

async function setAntibug(groupId, type) {
    setGroupConfig(groupId, 'antibug', {
        enabled: type === 'on' || type === true
    });
    return true;
}

async function getAntibug(groupId) {
    return getGroupConfig(groupId, 'antibug');
}

async function removeAntibug(groupId) {
    deleteGroupToggle(groupId, 'antibug');
    return true;
}

async function setAntichart(groupId, enabled, action, blockedUsers = []) {
    setGroupConfig(groupId, 'antichart', {
        enabled: enabled === true || enabled === 'on',
        action: action || 'delete',
        blockedUsers: blockedUsers || []
    });
    return true;
}

async function getAntichart(groupId) {
    return getGroupConfig(groupId, 'antichart');
}

async function removeAntichart(groupId) {
    deleteGroupToggle(groupId, 'antichart');
    return true;
}

async function setAntiBadword(groupId, type, action) {
    setGroupConfig(groupId, 'antibadword', {
        enabled: type === 'on',
        action: action || 'delete'
    });
    return true;
}

async function getAntiBadword(groupId) {
    return getGroupConfig(groupId, 'antibadword');
}

async function removeAntiBadword(groupId) {
    setGroupConfig(groupId, 'antibadword', { enabled: false, action: 'delete' });
    return true;
}

function incrementWarningCount(groupId, userId) {
    return db.incrementWarning(groupId, userId);
}

function resetWarningCount(groupId, userId) {
    db.resetWarning(groupId, userId);
    return true;
}

function isSudo(userId) {
    return db.isSudo(userId);
}

function addSudo(userId) {
    db.addSudoUser(userId);
    return true;
}

function removeSudo(userId) {
    db.removeSudoUser(userId);
    return true;
}

function getSudoList() {
    return db.getAllSudoUsers();
}

async function addWelcome(groupId, enabled, message) {
    setGroupConfig(groupId, 'welcome', { enabled: enabled, message: message || '' });
    return true;
}

async function delWelcome(groupId) {
    setGroupConfig(groupId, 'welcome', { enabled: false, message: '' });
    return true;
}

async function isWelcomeOn(groupId) {
    const config = getGroupConfig(groupId, 'welcome');
    return config?.enabled || false;
}

async function getWelcome(groupId) {
    const config = getGroupConfig(groupId, 'welcome');
    return config?.message || null;
}

async function addGoodbye(groupId, enabled, message) {
    setGroupConfig(groupId, 'goodbye', { enabled: enabled, message: message || '' });
    return true;
}

async function delGoodBye(groupId) {
    setGroupConfig(groupId, 'goodbye', { enabled: false, message: '' });
    return true;
}

async function isGoodByeOn(groupId) {
    const config = getGroupConfig(groupId, 'goodbye');
    return config?.enabled || false;
}

async function getGoodbye(groupId) {
    const config = getGroupConfig(groupId, 'goodbye');
    return config?.message || null;
}

async function setChatbot(groupId, type) {
    setGroupConfig(groupId, 'chatbot', type === 'on' || type === true);
    return true;
}

async function getChatbot(groupId) {
    return getGroupConfig(groupId, 'chatbot');
}

async function removeChatbot(groupId) {
    setGroupConfig(groupId, 'chatbot', false);
    return true;
}

const bugPatterns = [
    /\u0000/g,
    /\u200E{100,}/g,
    /\u200F{100,}/g,
    /\u202A{50,}/g,
    /\u202B{50,}/g,
    /\u202C{50,}/g,
    /\u202D{50,}/g,
    /\u202E{50,}/g,
    /\u2060{50,}/g,
    /\u2061{50,}/g,
    /\u2062{50,}/g,
    /\u2063{50,}/g,
    /\u2064{50,}/g,
    /\uFEFF{50,}/g,
    /[\u0300-\u036F]{50,}/g,
    /(.)\1{500,}/g,
    /\n{100,}/g,
    /\t{100,}/g,
];

function isBugMessage(message) {
    if (!message) return false;

    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text ||
                 message.message?.imageMessage?.caption ||
                 message.message?.videoMessage?.caption || '';

    if (text.length > 50000) return true;

    for (const pattern of bugPatterns) {
        if (pattern.test(text)) return true;
    }

    const vcardData = message.message?.contactMessage?.vcard ||
                      message.message?.contactsArrayMessage?.contacts?.[0]?.vcard || '';
    if (vcardData.length > 10000) return true;

    const buttonCount = message.message?.buttonsMessage?.buttons?.length ||
                       message.message?.templateMessage?.hydratedTemplate?.hydratedButtons?.length || 0;
    if (buttonCount > 10) return true;

    const listCount = message.message?.listMessage?.sections?.reduce((acc, s) => acc + (s.rows?.length || 0), 0) || 0;
    if (listCount > 50) return true;

    return false;
}

module.exports = {
    loadUserGroupData,
    saveUserGroupData,
    setAntilink,
    getAntilink,
    removeAntilink,
    setAntitag,
    getAntitag,
    removeAntitag,
    setAntigroupmention,
    getAntigroupmention,
    removeAntigroupmention,
    setAntidemote,
    getAntidemote,
    removeAntidemote,
    setAntisticker,
    getAntisticker,
    removeAntisticker,
    setAntiimage,
    getAntiimage,
    removeAntiimage,
    setAntiaudio,
    getAntiaudio,
    removeAntiaudio,
    setAntidocument,
    getAntidocument,
    removeAntidocument,
    setAntifiles,
    getAntifiles,
    removeAntifiles,
    setAntipromote,
    getAntipromote,
    removeAntipromote,
    setAntivideo,
    getAntivideo,
    removeAntivideo,
    setAntibug,
    getAntibug,
    removeAntibug,
    setAntichart,
    getAntichart,
    removeAntichart,
    setAntiBadword,
    getAntiBadword,
    removeAntiBadword,
    isBugMessage,
    bugPatterns,
    incrementWarningCount,
    resetWarningCount,
    isSudo,
    addSudo,
    removeSudo,
    getSudoList,
    setAntimention,
    getAntimention,
    removeAntimention,
    addWelcome,
    delWelcome,
    isWelcomeOn,
    getWelcome,
    addGoodbye,
    delGoodBye,
    isGoodByeOn,
    getGoodbye,
    setChatbot,
    getChatbot,
    removeChatbot
};
