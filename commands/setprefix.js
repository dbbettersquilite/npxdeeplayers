const { getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const DEFAULT_PREFIX = '.';
const NO_PREFIX = 'none';

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

function getPrefix() {
    try {
        const prefix = getOwnerConfig('prefix');
        if (prefix === NO_PREFIX || prefix === '') return '';
        return prefix || DEFAULT_PREFIX;
    } catch (error) {
        console.error('Error getting prefix:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return DEFAULT_PREFIX;
    }
}

function getRawPrefix() {
    try {
        return getOwnerConfig('prefix') || DEFAULT_PREFIX;
    } catch (error) {
        console.error('Error getting raw prefix:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return DEFAULT_PREFIX;
    }
}

function setPrefix(newPrefix) {
    try {
        setOwnerConfig('prefix', newPrefix);
        return true;
    } catch (error) {
        console.error('Error setting prefix:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return false;
    }
}

async function handleSetPrefixCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nOwner only command!`
            }, { quoted: fake });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ');
        const newPrefix = args[1];

        if (!newPrefix) {
            const currentPrefix = getRawPrefix();
            const displayPrefix = currentPrefix === NO_PREFIX ? 'None (prefixless)' : currentPrefix;
            
            await sock.sendMessage(chatId, {
                text: `*${botName} PREFIX*\n\n` +
                    `Current Prefix: ${displayPrefix}\n\n` +
                    `*Commands:*\n` +
                    `.setprefix <symbol> - Set new prefix\n` +
                    `.setprefix none - Remove prefix\n` +
                    `.setprefix reset - Reset to default (.)`
            }, { quoted: fake });
            return;
        }

        let responseText = '';

        if (newPrefix.toLowerCase() === 'none') {
            setPrefix(NO_PREFIX);
            responseText = `*${botName}*\nPrefix removed!\nBot is now prefixless.`;
        } else if (newPrefix.toLowerCase() === 'reset') {
            setPrefix(DEFAULT_PREFIX);
            responseText = `*${botName}*\nPrefix reset to: ${DEFAULT_PREFIX}`;
        } else if (newPrefix.length > 5) {
            responseText = `*${botName}*\nPrefix must be 1-5 characters!`;
        } else {
            setPrefix(newPrefix);
            responseText = `*${botName}*\nPrefix changed to: ${newPrefix}`;
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
    } catch (error) {
        console.error('Error in setprefix command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    getPrefix,
    getRawPrefix,
    setPrefix,
    handleSetPrefixCommand
};
