const { createFakeContact, getBotName } = require('../lib/fakeContact');
const db = require('../Database/database');

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function pinCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        try {
            await sock.chatModify({ pin: true }, chatId);
            await sock.sendMessage(chatId, { text: `*${botName}*\nChat pinned!` }, { quoted: fake });
        } catch (modifyErr) {
            if (modifyErr.message && modifyErr.message.includes('myAppStateKey')) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nPin/Unpin requires WhatsApp to fully sync app state.\nThis usually takes a few minutes after bot connects.\nPlease try again shortly.`
                }, { quoted: fake });
            } else {
                throw modifyErr;
            }
        }
    } catch (error) {
        try {
            const fake = createFakeContact(message.key.participant || message.key.remoteJid);
            await sock.sendMessage(chatId, { text: `*${getBotName()}*\nFailed to pin: ${error.message}` }, { quoted: fake });
        } catch {}
    }
}

async function unpinCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        try {
            await sock.chatModify({ pin: false }, chatId);
            await sock.sendMessage(chatId, { text: `*${botName}*\nChat unpinned!` }, { quoted: fake });
        } catch (modifyErr) {
            if (modifyErr.message && modifyErr.message.includes('myAppStateKey')) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nPin/Unpin requires WhatsApp to fully sync app state.\nThis usually takes a few minutes after bot connects.\nPlease try again shortly.`
                }, { quoted: fake });
            } else {
                throw modifyErr;
            }
        }
    } catch (error) {
        try {
            const fake = createFakeContact(message.key.participant || message.key.remoteJid);
            await sock.sendMessage(chatId, { text: `*${getBotName()}*\nFailed to unpin: ${error.message}` }, { quoted: fake });
        } catch {}
    }
}

async function archiveCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const lastMsg = {
            key: message.key,
            messageTimestamp: message.messageTimestamp || Math.floor(Date.now() / 1000)
        };

        try {
            await sock.chatModify({ archive: true, lastMessages: [lastMsg] }, chatId);
            await sock.sendMessage(chatId, { text: `*${botName}*\nChat archived!` }, { quoted: fake });
        } catch (modifyErr) {
            if (modifyErr.message && modifyErr.message.includes('myAppStateKey')) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nArchive requires WhatsApp to fully sync app state.\nThis usually takes a few minutes after bot connects.\nPlease try again shortly.`
                }, { quoted: fake });
            } else {
                throw modifyErr;
            }
        }
    } catch (error) {
        try {
            const fake = createFakeContact(message.key.participant || message.key.remoteJid);
            await sock.sendMessage(chatId, { text: `*${getBotName()}*\nFailed to archive: ${error.message}` }, { quoted: fake });
        } catch {}
    }
}

async function unarchiveCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const lastMsg = {
            key: message.key,
            messageTimestamp: message.messageTimestamp || Math.floor(Date.now() / 1000)
        };

        try {
            await sock.chatModify({ archive: false, lastMessages: [lastMsg] }, chatId);
            await sock.sendMessage(chatId, { text: `*${botName}*\nChat unarchived!` }, { quoted: fake });
        } catch (modifyErr) {
            if (modifyErr.message && modifyErr.message.includes('myAppStateKey')) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nUnarchive requires WhatsApp to fully sync app state.\nThis usually takes a few minutes after bot connects.\nPlease try again shortly.`
                }, { quoted: fake });
            } else {
                throw modifyErr;
            }
        }
    } catch (error) {
        try {
            const fake = createFakeContact(message.key.participant || message.key.remoteJid);
            await sock.sendMessage(chatId, { text: `*${getBotName()}*\nFailed to unarchive: ${error.message}` }, { quoted: fake });
        } catch {}
    }
}

async function disappearingCommand(sock, chatId, message, args) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const sub = (args || '').toLowerCase().trim();

        if (!sub) {
            return sock.sendMessage(chatId, {
                text: `*${botName} DISAPPEARING MESSAGES*\n\n*Commands:*\n.disappearing on - Enable (24h)\n.disappearing 7d - 7 days\n.disappearing 90d - 90 days\n.disappearing off - Disable`
            }, { quoted: fake });
        }

        let duration = 0;
        if (sub === 'on' || sub === '24h') {
            duration = 86400;
        } else if (sub === '7d') {
            duration = 604800;
        } else if (sub === '90d') {
            duration = 7776000;
        } else if (sub === 'off') {
            duration = 0;
        } else {
            return sock.sendMessage(chatId, { text: `*${botName}*\nUse: on, off, 7d, 90d` }, { quoted: fake });
        }

        await sock.sendMessage(chatId, { disappearingMessagesInChat: duration });

        const label = duration === 0 ? 'OFF' : duration === 86400 ? '24 hours' : duration === 604800 ? '7 days' : '90 days';
        await sock.sendMessage(chatId, { text: `*${botName}*\nDisappearing messages: ${label}` }, { quoted: fake });
    } catch (error) {
        try {
            const fake = createFakeContact(message.key.participant || message.key.remoteJid);
            await sock.sendMessage(chatId, { text: `*${getBotName()}*\nFailed: ${error.message}` }, { quoted: fake });
        } catch {}
    }
}

module.exports = {
    pinCommand,
    unpinCommand,
    archiveCommand,
    unarchiveCommand,
    disappearingCommand
};
