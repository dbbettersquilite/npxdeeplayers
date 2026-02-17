const { getGroupConfig, setGroupConfig, deleteGroupToggle } = require('../Database/settingsStore');
const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function antistickerCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!isSenderAdmin && !message?.key?.fromMe && !db.isSudo(senderId)) {
            await sock.sendMessage(chatId, { text: `*${botName}*\nAdmin only command!` }, { quoted: fake });
            return;
        }

        const args = userMessage.slice(12).toLowerCase().trim().split(' ');
        const action = args[0];

        if (!action) {
            const config = getGroupConfig(chatId, 'antisticker') || { enabled: false };
            const currentMode = config.enabled ? (config.action || 'delete') : 'off';

            const usage = `*${botName} ANTI-STICKER*\n\nCurrent Mode: ${currentMode.toUpperCase()}\n\n*Commands:*\n.antisticker off - Disable\n.antisticker delete - Delete sticker\n.antisticker warn - Delete + warn\n.antisticker kick - Delete + kick`;

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
            deleteGroupToggle(chatId, 'antisticker');
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nAnti-Sticker DISABLED` 
            }, { quoted: fake });
        } else {
            setGroupConfig(chatId, 'antisticker', { enabled: true, action: action });
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nAnti-Sticker: ${action.toUpperCase()}` 
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in antisticker command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

async function handleStickerDetection(sock, chatId, message, senderId) {
    try {
        const isSticker = message.type === 'stickerMessage' || 
                         (message.message && message.message.stickerMessage);

        if (!isSticker) return;
        if (!chatId.endsWith('@g.us')) return;

        const config = getGroupConfig(chatId, 'antisticker');
        if (!config || !config.enabled) return;

        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isBotAdmin || isSenderAdmin || db.isSudo(senderId)) return;

        const botName = getBotName();
        const userTag = `@${senderId.split("@")[0]}`;

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
            console.error("[ANTI-STICKER] Delete failed:", e.message);
            return;
        }

        if (config.action === 'kick') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n\n${userTag} kicked for sending sticker.`,
                mentions: [senderId]
            });
            await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
        } else if (config.action === 'warn') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n\n${userTag}, stickers are not allowed!`,
                mentions: [senderId]
            });
        }
    } catch (error) {
        console.error('Error in handleStickerDetection:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    antistickerCommand,
    handleStickerDetection
};
