const { getGroupConfig, setGroupConfig } = require('../Database/settingsStore');
const db = require('../Database/database');
const isAdmin = require('../lib/isAdmin');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function groupanticallCommand(sock, chatId, message, args) {
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const isGroup = chatId.endsWith('@g.us');

    if (!isGroup) {
        return sock.sendMessage(chatId, {
            text: `*${botName}*\nThis command works in groups only!`
        }, { quoted: fake });
    }

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isSenderAdmin && !message.key.fromMe && !db.isSudo(senderId)) {
        return sock.sendMessage(chatId, {
            text: `*${botName}*\nAdmin only command!`
        }, { quoted: fake });
    }

    const config = getGroupConfig(chatId, 'groupanticall') || { enabled: false, action: 'decline' };
    const sub = (args || '').trim().toLowerCase();

    if (!sub) {
        const helpText = `*${botName} GROUP ANTI-CALL*\n\n` +
            `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
            `Action: ${config.action || 'decline'}\n\n` +
            `*Commands:*\n` +
            `.groupanticall on - Enable\n` +
            `.groupanticall off - Disable\n` +
            `.groupanticall decline - Decline calls\n` +
            `.groupanticall warn - Decline + warn user\n` +
            `.groupanticall kick - Decline + kick caller\n` +
            `.groupanticall status - Show status\n\n` +
            `*Note:* All group calls are declined instantly.\n` +
            `This is separate from the personal anticall.`;
        return sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
    }

    let newConfig = { ...config };
    let responseText = '';

    if (sub === 'status') {
        responseText = `*${botName} GROUP ANTI-CALL STATUS*\n\n` +
            `Status: ${config.enabled ? 'ACTIVE' : 'INACTIVE'}\n` +
            `Action: ${(config.action || 'decline').toUpperCase()}`;
    } else if (sub === 'on' || sub === 'enable') {
        newConfig.enabled = true;
        responseText = `*${botName}*\nGroup Anti-Call ENABLED\nAction: ${(newConfig.action || 'decline').toUpperCase()}`;
        setGroupConfig(chatId, 'groupanticall', newConfig);
    } else if (sub === 'off' || sub === 'disable') {
        newConfig.enabled = false;
        responseText = `*${botName}*\nGroup Anti-Call DISABLED`;
        setGroupConfig(chatId, 'groupanticall', newConfig);
    } else if (sub === 'decline') {
        newConfig.enabled = true;
        newConfig.action = 'decline';
        responseText = `*${botName}*\nAction: DECLINE\nGroup calls will be declined instantly.`;
        setGroupConfig(chatId, 'groupanticall', newConfig);
    } else if (sub === 'warn') {
        newConfig.enabled = true;
        newConfig.action = 'warn';
        responseText = `*${botName}*\nAction: WARN\nGroup calls declined + caller warned.`;
        setGroupConfig(chatId, 'groupanticall', newConfig);
    } else if (sub === 'kick') {
        newConfig.enabled = true;
        newConfig.action = 'kick';
        responseText = `*${botName}*\nAction: KICK\nGroup calls declined + caller removed.`;
        setGroupConfig(chatId, 'groupanticall', newConfig);
    } else {
        responseText = `*${botName}*\nInvalid option!\nUse: on, off, decline, warn, kick, status`;
    }

    await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
}

async function handleGroupCall(sock, call) {
    try {
        if (!call.isGroup) return false;

        const callerJid = call.from;
        if (!callerJid) return false;

        const groupJid = call.chatId;
        if (!groupJid || !groupJid.endsWith('@g.us')) return false;

        const config = getGroupConfig(groupJid, 'groupanticall');
        if (!config || !config.enabled) return false;

        try {
            await sock.rejectCall(call.id, callerJid);
        } catch (e) {
            console.error('[GROUP-ANTICALL] Reject failed:', e.message);
        }

        const botName = getBotName();
        const callerTag = `@${callerJid.split('@')[0]}`;
        const action = config.action || 'decline';

        if (action === 'warn') {
            try {
                await sock.sendMessage(groupJid, {
                    text: `*${botName}*\n\n${callerTag}, group calls are not allowed!`,
                    mentions: [callerJid]
                });
            } catch (e) {
                console.error('[GROUP-ANTICALL] Warn failed:', e.message);
            }
        } else if (action === 'kick') {
            try {
                const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                const groupMeta = await sock.groupMetadata(groupJid);
                const botIsAdmin = groupMeta.participants.some(
                    p => (p.id === botJid || p.id.startsWith(sock.user?.id?.split(':')[0])) &&
                         (p.admin === 'admin' || p.admin === 'superadmin')
                );
                if (botIsAdmin) {
                    await sock.sendMessage(groupJid, {
                        text: `*${botName}*\n\n${callerTag} removed for attempting a group call.`,
                        mentions: [callerJid]
                    });
                    await sock.groupParticipantsUpdate(groupJid, [callerJid], 'remove');
                } else {
                    await sock.sendMessage(groupJid, {
                        text: `*${botName}*\n\n${callerTag}, group calls are not allowed! (Bot needs admin to kick)`,
                        mentions: [callerJid]
                    });
                }
            } catch (e) {
                console.error('[GROUP-ANTICALL] Kick failed:', e.message);
            }
        }

        return true;
    } catch (error) {
        console.error('[GROUP-ANTICALL] Error:', error.message);
        return false;
    }
}

module.exports = {
    groupanticallCommand,
    handleGroupCall
};
