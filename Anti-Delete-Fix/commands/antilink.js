const { getGroupConfig, setGroupConfig, parseToggleCommand, parseActionCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

function normalizeJid(jid) {
    if (!jid) return '';
    const num = jid.split('@')[0].split(':')[0];
    return num + '@s.whatsapp.net';
}

async function handleAntiLinkDetection(sock, m) {
    try {
        if (!m?.message) return;
        if (m.key.fromMe) return;
        if (!m.key.remoteJid?.endsWith('@g.us')) return;

        const chatId = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;

        const config = getGroupConfig(chatId, 'antilink');
        if (!config?.enabled) return;

        let text = "";
        const msg = m.message;
        if (msg.conversation) {
            text = msg.conversation;
        } else if (msg.extendedTextMessage?.text) {
            text = msg.extendedTextMessage.text;
        } else if (msg.imageMessage?.caption) {
            text = msg.imageMessage.caption;
        } else if (msg.videoMessage?.caption) {
            text = msg.videoMessage.caption;
        } else if (msg.documentMessage?.caption) {
            text = msg.documentMessage.caption;
        } else if (msg.buttonsResponseMessage?.selectedDisplayText) {
            text = msg.buttonsResponseMessage.selectedDisplayText;
        } else if (msg.listResponseMessage?.title) {
            text = msg.listResponseMessage.title;
        } else if (msg.templateButtonReplyMessage?.selectedDisplayText) {
            text = msg.templateButtonReplyMessage.selectedDisplayText;
        }

        const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|bit\.ly\/[^\s]+|t\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|whatsapp\.com\/[^\s]+|youtu\.be\/[^\s]+|youtube\.com\/[^\s]+)/gi;
        if (!urlRegex.test(String(text).toLowerCase())) return;

        console.log(`[ANTILINK] Link detected from ${sender} in ${chatId}: "${text.substring(0, 80)}"`);

        let groupMetadata;
        try {
            groupMetadata = await sock.groupMetadata(chatId);
        } catch (metaErr) {
            console.error('[ANTILINK] Failed to fetch group metadata:', metaErr.message);
            return;
        }

        const botId = normalizeJid(sock.user.id);
        const normalizedSender = normalizeJid(sender);
        const bot = groupMetadata.participants.find(p => normalizeJid(p.id) === botId || p.id === sock.user?.id);
        if (bot && !bot.admin) {
            console.log(`[ANTILINK] Bot is not admin, skipping`);
            return;
        }

        const participant = groupMetadata.participants.find(p => normalizeJid(p.id) === normalizedSender || p.id === sender);
        if (participant?.admin) {
            console.log(`[ANTILINK] Sender is admin, skipping`);
            return;
        }
        if (db.isSudo(sender) || db.isSudo(normalizedSender)) {
            console.log(`[ANTILINK] Sender is sudo, skipping`);
            return;
        }

        const botName = getBotName();
        const fake = createFakeContact(sender);

        await sock.sendMessage(chatId, {
            delete: {
                remoteJid: chatId,
                fromMe: false,
                id: m.key.id,
                participant: sender,
            },
        });

        const username = sender.split('@')[0];
        const action = config.action || 'delete';
        const maxWarnings = config.maxWarnings || 3;

        switch (action) {
            case 'delete':
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n@${username}, no links allowed!\nMessage deleted.`,
                    mentions: [sender],
                }, { quoted: fake });
                break;

            case 'warn':
                const warningCount = db.incrementWarning(chatId, sender);
                if (warningCount >= maxWarnings) {
                    try {
                        await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                        db.resetWarning(chatId, sender);
                        await sock.sendMessage(chatId, {
                            text: `*${botName}*\n@${username} kicked after ${maxWarnings} warnings!\nLinks not allowed.`,
                            mentions: [sender],
                        }, { quoted: fake });
                    } catch {}
                } else {
                    await sock.sendMessage(chatId, {
                        text: `*${botName}*\n@${username}, no links allowed!\nWarning ${warningCount}/${maxWarnings}`,
                        mentions: [sender],
                    }, { quoted: fake });
                }
                break;

            case 'kick':
                try {
                    await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `*${botName}*\n@${username} kicked for posting links.`,
                        mentions: [sender],
                    }, { quoted: fake });
                } catch (err) {
                    console.error('Failed to kick user:', err.message);
                }
                break;
        }
    } catch (err) {
        console.error('Error in handleAntiLinkDetection:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin) {
    try {
        const text = typeof userMessage === 'string' ? userMessage : 
                    (userMessage?.message?.conversation || 
                     userMessage?.message?.extendedTextMessage?.text || '');

        const parts = text.trim().split(/\s+/);
        const subCmd = parts[1]?.toLowerCase();
        const botName = getBotName();
        const fake = createFakeContact(senderId);
        const config = getGroupConfig(chatId, 'antilink') || { enabled: false, action: 'delete', maxWarnings: 3 };

        if (!subCmd || subCmd === 'help' || subCmd === 'status') {
            const helpText = `*${botName} ANTILINK*\n\n` +
                            `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                            `Action: ${config.action || 'delete'}\n` +
                            `Max Warnings: ${config.maxWarnings || 3}\n\n` +
                            `*Commands:*\n` +
                            `.antilink on - Enable\n` +
                            `.antilink off - Disable\n` +
                            `.antilink delete - Set action to delete only\n` +
                            `.antilink warn - Set action to warn (max = kick)\n` +
                            `.antilink kick - Set action to delete & kick\n` +
                            `.antilink setwarn <num> - Set max warnings\n` +
                            `.antilink status - Show status`;
            await sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
            return;
        }

        if (subCmd === 'setwarn') {
            const num = parseInt(parts[2]);
            if (num > 0 && num <= 10) {
                const newConfig = { ...config, maxWarnings: num };
                setGroupConfig(chatId, 'antilink', newConfig);
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nMax warnings set to: ${num}`
                }, { quoted: fake });
            } else {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nInvalid number! Use 1-10`
                }, { quoted: fake });
            }
            return;
        }

        let newConfig = { ...config };
        let responseText = '';

        if (subCmd === 'on' || subCmd === 'enable') {
            newConfig.enabled = true;
            responseText = `*${botName}*\nAntiLink ENABLED\nAction: ${newConfig.action || 'delete'}`;
        } else if (subCmd === 'off' || subCmd === 'disable') {
            newConfig.enabled = false;
            responseText = `*${botName}*\nAntiLink DISABLED`;
        } else if (subCmd === 'delete' || subCmd === 'del') {
            newConfig.action = 'delete';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAntiLink action set to: DELETE\nLinks will be deleted.`;
        } else if (subCmd === 'warn' || subCmd === 'warning') {
            newConfig.action = 'warn';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAntiLink action set to: WARN\n${newConfig.maxWarnings || 3} warnings = kick.`;
        } else if (subCmd === 'kick' || subCmd === 'boot') {
            newConfig.action = 'kick';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAntiLink action set to: KICK\nLink senders will be removed immediately.`;
        } else {
            responseText = `*${botName}*\nInvalid option: "${subCmd}"\nUse: on, off, delete, warn, kick`;
        }

        if (responseText && !responseText.includes('Invalid')) {
            setGroupConfig(chatId, 'antilink', newConfig);
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });

    } catch (error) {
        console.error('Error in handleAntilinkCommand:', error.message, 'Line:', error.stack?.split('\n')[1]);
        const botName = getBotName();
        await sock.sendMessage(chatId, {
            text: `*${botName}*\nFailed to configure antilink!`
        });
    }
}

async function getAntilink(groupId) {
    return getGroupConfig(groupId, 'antilink');
}

async function setAntilink(groupId, type, action) {
    const config = {
        enabled: type === 'on' || type === 'delete' || type === 'kick' || type === 'warn',
        action: action || 'delete'
    };
    setGroupConfig(groupId, 'antilink', config);
    return true;
}

module.exports = {
    handleAntiLinkDetection,
    handleAntilinkCommand,
    getAntilink,
    setAntilink
};
