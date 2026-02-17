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
            const authMsgs = [
                `*${botName}*\nOwner only.`,
                `*${botName}*\nPrivileges required.`,
                `*${botName}*\nBoss only.`
            ];
            await sock.sendMessage(chatId, {
                text: authMsgs[Math.floor(Math.random() * authMsgs.length)]
            }, { quoted: fake });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ').slice(1).join(' ');

        if (!args) {
            const currentOwner = getOwnerName();
            await sock.sendMessage(chatId, {
                text: `╭─❖ *OWNER SETTINGS* ❖─╮\n` +
                    `│ Current : ${currentOwner}\n` +
                    `╰───────────────────────╯\n\n` +
                    `✦ .setowner <name>\n` +
                    `✦ .setowner reset`
            }, { quoted: fake });
            return;
        }

        let responseText = '';

        if (args.toLowerCase() === 'reset') {
            resetOwnerName();
            const resetMsgs = [
                `*${botName}*\n✓ Owner name reset.`,
                `*${botName}*\n✓ Reset to default.`,
                `*${botName}*\n✓ Owner name cleared.`
            ];
            responseText = resetMsgs[Math.floor(Math.random() * resetMsgs.length)];
        } else {
            const validation = validateOwnerName(args);
            if (!validation.isValid) {
                const errorMsgs = [
                    `*${botName}*\n✗ ${validation.message}`,
                    `*${botName}*\n✗ Invalid: ${validation.message.toLowerCase()}`,
                    `*${botName}*\n✗ ${validation.message}`
                ];
                responseText = errorMsgs[Math.floor(Math.random() * errorMsgs.length)];
            } else {
                setOwnerName(args);
                const successMsgs = [
                    `*${botName}*\n✓ Owner: ${args}`,
                    `*${botName}*\n✓ Set to: ${args}`,
                    `*${botName}*\n✓ Now ${args}`
                ];
                responseText = successMsgs[Math.floor(Math.random() * successMsgs.length)];
            }
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
    } catch (error) {
        console.error('Error in setowner command:', error.message, 'Line:', error.stack?.split('\n')[1]);
        
        const errorMsgs = [
            `*${botName}*\n✗ Something went wrong.`,
            `*${botName}*\n✗ Command failed.`,
            `*${botName}*\n✗ Try again.`
        ];
        await sock.sendMessage(chatId, { 
            text: errorMsgs[Math.floor(Math.random() * errorMsgs.length)]
        }, { quoted: fake });
    }
}

module.exports = {
    getOwnerName,
    setOwnerName,
    resetOwnerName,
    validateOwnerName,
    handleSetOwnerCommand
};