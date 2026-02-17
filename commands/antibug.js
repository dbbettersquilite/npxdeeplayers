const { getGroupConfig, setGroupConfig, deleteGroupToggle, getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');
const { isBugMessage } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function antibugCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const isGroup = chatId.endsWith('@g.us');

        if (isGroup) {
            if (!isSenderAdmin && !message?.key?.fromMe && !db.isSudo(senderId)) {
                await sock.sendMessage(chatId, { text: `*${botName}*\nAdmin only command!` }, { quoted: fake });
                return;
            }
        } else {
            if (!message?.key?.fromMe && !db.isSudo(senderId)) {
                await sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
                return;
            }
        }

        const args = userMessage.slice(8).toLowerCase().trim().split(' ');
        const action = args[0];

        const config = isGroup 
            ? (getGroupConfig(chatId, 'antibug') || { enabled: false })
            : (getOwnerConfig('antibug_pm') || { enabled: false });
        const currentMode = config.enabled ? (config.action || 'delete') : 'off';

        const { getPrefix } = require('./setprefix');
        const p = getPrefix();

        if (!action) {
            const scope = isGroup ? 'GROUP' : 'PM';
            const usage = `*${botName} ANTI-BUG (${scope})*\n\nCurrent Mode: ${currentMode.toUpperCase()}\n\n*Commands:*\n${p}antibug off - Disable\n${p}antibug delete - Delete bug messages\n${p}antibug warn - Delete + warn\n${p}antibug kick - Delete + kick${!isGroup ? '\n\nIn PM: blocks bug senders' : ''}`;

            await sock.sendMessage(chatId, { text: usage }, { quoted: fake });
            return;
        }

        const validModes = ["off", "delete", "warn", "kick"];

        if (!validModes.includes(action)) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nInvalid mode! Use: off, delete, warn, kick` 
            }, { quoted: fake });
            return;
        }

        if (action === 'off') {
            if (isGroup) {
                deleteGroupToggle(chatId, 'antibug');
            } else {
                setOwnerConfig('antibug_pm', { enabled: false });
            }
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nAnti-Bug DISABLED` 
            }, { quoted: fake });
        } else {
            const newConf = { enabled: true, action: action };
            if (isGroup) {
                setGroupConfig(chatId, 'antibug', newConf);
            } else {
                setOwnerConfig('antibug_pm', newConf);
            }
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nAnti-Bug: ${action.toUpperCase()}${!isGroup ? ' (PM)' : ''}` 
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in antibug command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

async function handleBugDetection(sock, chatId, message, senderId) {
    try {
        if (!isBugMessage(message)) return;

        const isGroup = chatId.endsWith('@g.us');

        if (isGroup) {
            const config = getGroupConfig(chatId, 'antibug');
            if (!config || !config.enabled) return;

            const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
            if (!isBotAdmin || isSenderAdmin || db.isSudo(senderId)) return;

            const botName = getBotName();
            const userTag = `@${senderId.split("@")[0]}`;
            const fake = createFakeContact(senderId);

            try {
                await sock.sendMessage(chatId, {
                    delete: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: message.key.id,
                        participant: senderId
                    }
                });
            } catch (e) {
                console.error("[ANTI-BUG] Delete failed:", e.message);
                return;
            }

            if (config.action === 'kick') {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n${userTag} kicked for crash messages.`,
                    mentions: [senderId]
                });
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
            } else if (config.action === 'warn') {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n${userTag}, crash messages prohibited!`,
                    mentions: [senderId]
                });
            }
        } else {
            const config = getOwnerConfig('antibug_pm') || { enabled: false };
            if (!config.enabled) return;
            if (message.key.fromMe || db.isSudo(senderId)) return;

            const botName = getBotName();
            const senderNumber = senderId.split('@')[0];
            const fake = createFakeContact(senderId);
            const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            await sock.sendMessage(ownerNumber, {
                text: `*${botName} - BUG BLOCKED (PM)*\n\nFrom: @${senderNumber}\nAction: ${config.action || 'delete'}`,
                mentions: [senderId]
            }, { quoted: fake });

            if (config.action === 'kick' || config.action === 'warn') {
                try {
                    await sock.updateBlockStatus(senderId, 'block');
                    await sock.sendMessage(ownerNumber, {
                        text: `*${botName}*\n@${senderNumber} blocked for sending crash messages in PM.`,
                        mentions: [senderId]
                    }, { quoted: fake });
                } catch (e) {
                    console.error("[ANTI-BUG PM] Block failed:", e.message);
                }
            }
        }
    } catch (error) {
        console.error('Error in handleBugDetection:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    antibugCommand,
    handleBugDetection
};
