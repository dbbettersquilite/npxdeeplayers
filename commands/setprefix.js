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
            const authMsgs = [
                `*${botName}*\nOnly the boss can do that!`,
                `*${botName}*\nOwner privileges required.`,
                `*${botName}*\nThis one's for the owner only.`
            ];
            await sock.sendMessage(chatId, {
                text: authMsgs[Math.floor(Math.random() * authMsgs.length)]
            }, { quoted: fake });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ');
        const newPrefix = args[1];

        if (!newPrefix) {
            const currentPrefix = getRawPrefix();
            const displayPrefix = currentPrefix === NO_PREFIX ? 'No prefix' : currentPrefix;
            
            await sock.sendMessage(chatId, {
                text: `╭─❖ *PREFIX SETTINGS* ❖─╮\n` +
                    `│ Current : ${displayPrefix}\n` +
                    `╰───────────────────────╯\n\n` +
                    `✦ .setprefix <symbol>\n` +
                    `✦ .setprefix none\n` +
                    `✦ .setprefix reset`
            }, { quoted: fake });
            return;
        }

        let responseText = '';

        if (newPrefix.toLowerCase() === 'none') {
            setPrefix(NO_PREFIX);
            const msgs = [
                `*${botName}*\n✓ Prefix removed. Bot is now prefixless.`,
                `*${botName}*\n✓ No more prefix! Use commands without one.`,
                `*${botName}*\n✓ Prefix disabled.`
            ];
            responseText = msgs[Math.floor(Math.random() * msgs.length)];
        } else if (newPrefix.toLowerCase() === 'reset') {
            setPrefix(DEFAULT_PREFIX);
            const msgs = [
                `*${botName}*\n✓ Reset to default: ${DEFAULT_PREFIX}`,
                `*${botName}*\n✓ Back to ${DEFAULT_PREFIX}`,
                `*${botName}*\n✓ Default restored: ${DEFAULT_PREFIX}`
            ];
            responseText = msgs[Math.floor(Math.random() * msgs.length)];
        } else if (newPrefix.length > 5) {
            const msgs = [
                `*${botName}*\n✗ Max 5 characters!`,
                `*${botName}*\n✗ Too long! Keep it under 5.`,
                `*${botName}*\n✗ Prefix must be 1-5 chars.`
            ];
            responseText = msgs[Math.floor(Math.random() * msgs.length)];
        } else {
            setPrefix(newPrefix);
            const msgs = [
                `*${botName}*\n✓ Prefix is now: ${newPrefix}`,
                `*${botName}*\n✓ Changed to: ${newPrefix}`,
                `*${botName}*\n✓ Using: ${newPrefix}`
            ];
            responseText = msgs[Math.floor(Math.random() * msgs.length)];
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