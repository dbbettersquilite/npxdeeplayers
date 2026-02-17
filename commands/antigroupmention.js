const { getGroupConfig, setGroupConfig, deleteGroupToggle } = require('../Database/settingsStore');
const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
const { getPrefix } = require('./setprefix');

async function handleAntiStatusMention(sock, m) {
    try {
        if (!m?.message) return;
        if (m.key.fromMe) return;
        
        const chatId = m.key.remoteJid;
        if (!chatId?.endsWith('@g.us')) return;

        const config = getGroupConfig(chatId, 'antigroupmention');
        if (!config || !config.enabled) return;

        const mode = config.action || 'delete';
        if (mode === 'off') return;

        const isGroupStatusMention = m.message?.groupStatusMentionMessage;
        
        if (!isGroupStatusMention) {
            const isForwarded = m.message?.extendedTextMessage?.contextInfo?.isForwarded;
            const forwardingScore = m.message?.extendedTextMessage?.contextInfo?.forwardingScore || 0;
            
            if (!isForwarded && forwardingScore === 0) return;
            
            let text = m.message?.extendedTextMessage?.text || m.message?.conversation || '';
            const groupIdPart = chatId.split('@')[0];
            if (!text.includes(groupIdPart)) return;
        }

        const sender = m.key.participant || m.key.remoteJid;
        const botName = getBotName();
        
        const adminStatus = await isAdmin(sock, chatId, sender);
        const isSenderAdmin = adminStatus.isSenderAdmin;
        const isBotAdmin = adminStatus.isBotAdmin;

        if (isSenderAdmin || db.isSudo(sender)) {
            return;
        }

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nCannot delete status mention - need admin!`,
            });
            return;
        }

        await sock.sendMessage(chatId, {
            delete: {
                remoteJid: chatId,
                fromMe: false,
                id: m.key.id,
                participant: sender,
            },
        });

        const userTag = `@${sender.split('@')[0]}`;

        if (mode === 'delete') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n\n${userTag}, status mention deleted!\nDon't mention this group in your status!`,
                mentions: [sender],
            });
        } else if (mode === 'kick' || mode === 'remove') {
            try {
                await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n${userTag} kicked for status mention!`,
                    mentions: [sender],
                });
            } catch (err) {
                console.error('Failed to remove user:', err.message, 'Line:', err.stack?.split('\n')[1]);
            }
        }
    } catch (err) {
        console.error('Error in handleAntiStatusMention:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function antigroupmentionCommand(sock, chatId, message, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const prefix = getPrefix();

        const userMessage = message.message?.conversation || 
                           message.message?.extendedTextMessage?.text || '';
        const args = userMessage.split(' ');
        const subCmd = args[1]?.toLowerCase();

        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nGroup command only!`
            }, { quoted: fake });
            return;
        }

        const adminStatus = await isAdmin(sock, chatId, senderId);
        const isSenderAdmin = adminStatus.isSenderAdmin;
        const isBotAdmin = adminStatus.isBotAdmin;

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nBot needs to be admin!`
            }, { quoted: fake });
            return;
        }

        if (!subCmd || subCmd === 'help') {
            const config = getGroupConfig(chatId, 'antigroupmention') || { enabled: false };
            await sock.sendMessage(chatId, {
                text: `*${botName} ANTI-GROUP MENTION*\n\nStatus: ${config.enabled ? 'ON' : 'OFF'}\n\n*Commands:*\n${prefix}antigroupmention on - Enable\n${prefix}antigroupmention off - Disable\n${prefix}antigroupmention delete - Delete only\n${prefix}antigroupmention kick - Kick violators\n${prefix}antigroupmention status - Check status`
            }, { quoted: fake });
            return;
        }

        if (subCmd === 'status') {
            const config = getGroupConfig(chatId, 'antigroupmention') || { enabled: false };
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAnti-Group Mention: ${config.enabled ? 'ACTIVE (' + (config.action || 'delete') + ')' : 'INACTIVE'}`
            }, { quoted: fake });
            return;
        }

        if (!isSenderAdmin && !message.key.fromMe && !db.isSudo(senderId)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAdmin only command!`
            }, { quoted: fake });
            return;
        }

        const validActions = ['on', 'off', 'delete', 'kick', 'remove'];
        if (!validActions.includes(subCmd)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nInvalid option! Use: on, off, delete, kick`
            }, { quoted: fake });
            return;
        }

        if (subCmd === 'off') {
            deleteGroupToggle(chatId, 'antigroupmention');
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAnti-Group Mention DISABLED`
            }, { quoted: fake });
        } else {
            const action = subCmd === 'on' ? 'delete' : subCmd;
            setGroupConfig(chatId, 'antigroupmention', { enabled: true, action: action });
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAnti-Group Mention: ${action.toUpperCase()}`
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in antigroupmentionCommand:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    handleAntiStatusMention,
    antigroupmentionCommand
};
