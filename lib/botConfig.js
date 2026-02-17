const { getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');

const defaultConfig = {
    botName: 'DAVE-X',
    menuImage: '',
    ownerName: 'Dave',
    welcomeMessage: 'Welcome to the group!',
    goodbyeMessage: 'Goodbye!',
    antideletePrivate: true
};

// One-time migration: fix stored bot name from KOLOLI to DAVE-X
try {
    const stored = getOwnerConfig('botconfig');
    if (stored && stored.botName === 'DAVE-X') {
        stored.botName = 'DAVE-X';
        if (stored.ownerName === 'Owner') stored.ownerName = 'Dave';
        setOwnerConfig('botconfig', stored);
    }
} catch {}

function getConfig() {
    try {
        const storedConfig = getOwnerConfig('botconfig');
        return { ...defaultConfig, ...(storedConfig || {}) };
    } catch (error) {
        console.error('Error getting bot config:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return defaultConfig;
    }
}

function saveConfig(config) {
    try {
        setOwnerConfig('botconfig', config);
    } catch (error) {
        console.error('Error saving bot config:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

function getBotName() {
    return getConfig().botName;
}

function setBotName(name) {
    const config = getConfig();
    config.botName = name;
    saveConfig(config);
}

function getMenuImage() {
    return getConfig().menuImage;
}

function setMenuImage(url) {
    const config = getConfig();
    config.menuImage = url;
    saveConfig(config);
}

function getOwnerName() {
    return getConfig().ownerName;
}

function setOwnerName(name) {
    const config = getConfig();
    config.ownerName = name;
    saveConfig(config);
}

function isAntideletePrivateEnabled() {
    return getConfig().antideletePrivate !== false;
}

function setAntideletePrivate(enabled) {
    const config = getConfig();
    config.antideletePrivate = enabled;
    saveConfig(config);
}

function updateConfig(updates) {
    const config = getConfig();
    Object.assign(config, updates);
    saveConfig(config);
}

module.exports = {
    getBotName,
    setBotName,
    getMenuImage,
    setMenuImage,
    getOwnerName,
    setOwnerName,
    isAntideletePrivateEnabled,
    setAntideletePrivate,
    getConfig,
    updateConfig
};
