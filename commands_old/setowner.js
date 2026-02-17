const { getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName, getOwnerName: getOwnerNameFromConfig, setOwnerName: setOwnerNameToConfig } = require('../lib/fakeContact');
const { setOwnerName: setBotConfigOwnerName } = require('../lib/botConfig');

const DEFAULT_OWNER_NAME = 'Not set';

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

function getOwnerName() {
    try {
        return getOwnerNameFromConfig() || DEFAULT_OWNER_NAME;
    } catch (error) {
        console.error('Error getting owner name:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return DEFAULT_OWNER_NAME;
    }
}

function setOwnerName(newOwnerName) {
    try {
        if (!newOwnerName?.trim() || newOwnerName.trim().length > 20) return false;
        setBotConfigOwnerName(newOwnerName.trim());
        return true;
    } catch (error) {
        console.error('Error setting owner name:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return false;
    }
}

function resetOwnerName() {
    try {
        setBotConfigOwnerName(DEFAULT_OWNER_NAME);
        return true;
    } catch (error) {
        console.error('Error resetting owner name:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return false;
    }
}

function validateOwnerName(name) {
    if (!name?.trim()) return { isValid: false, message: 'Owner name cannot be empty' };

    const trimmed = name.trim();
    if (trimmed.length > 20) return { isValid: false, message: 'Owner name must be 1-20 characters long' };

    const invalidChars = /[<>@#\$%\^\*\\\/]/;
    if (invalidChars.test(trimmed)) return { isValid: false, message: 'Owner name contains invalid characters' };

    return { isValid: true, message: 'Valid owner name' };
}

async function handleSetOwnerCommand(sock, chatId, message) {
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
        const args = text.trim().split(' ').slice(1).join(' ');

        if (!args) {
            const currentOwner = getOwnerName();
            await sock.sendMessage(chatId, {
                text: `*${botName} OWNER NAME*\n\n` +
                    `Current: ${currentOwner}\n\n` +
                    `*Commands:*\n` +
                    `.setowner <name> - Set owner name\n` +
                    `.setowner reset - Reset owner name`
            }, { quoted: fake });
            return;
        }

        let responseText = '';

        if (args.toLowerCase() === 'reset') {
            resetOwnerName();
            responseText = `*${botName}*\nOwner name reset!`;
        } else {
            const validation = validateOwnerName(args);
            if (!validation.isValid) {
                responseText = `*${botName}*\n${validation.message}`;
            } else {
                setOwnerName(args);
                responseText = `*${botName}*\nOwner name set to: ${args}`;
            }
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
    } catch (error) {
        console.error('Error in setowner command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    getOwnerName,
    setOwnerName,
    resetOwnerName,
    validateOwnerName,
    handleSetOwnerCommand
};
