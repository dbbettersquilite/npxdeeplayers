const { getOwnerConfig, setOwnerConfig, getGroupConfig, setGroupConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const originalMessages = new Map();
const MAX_STORED_MESSAGES = 5000;
const MESSAGE_RETENTION_MS = 604800000;

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

function normalizeOwnerConfig(raw) {
    if (!raw || typeof raw !== 'object') {
        return { gc: { enabled: true, mode: 'private' }, pm: { enabled: true, mode: 'private' } };
    }
    if (raw.gc && raw.pm) return raw;
    const enabled = raw.enabled !== undefined ? raw.enabled : true;
    const mode = raw.mode || 'private';
    return { gc: { enabled, mode }, pm: { enabled, mode } };
}

function getEffectiveConfig(chatId) {
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup) {
        if (db.hasGroupSetting(chatId, 'antiedit')) {
            const groupConf = getGroupConfig(chatId, 'antiedit');
            if (typeof groupConf === 'object' && groupConf.enabled !== undefined) {
                return groupConf;
            }
        }
        const ownerRaw = getOwnerConfig('antiedit');
        const ownerConf = normalizeOwnerConfig(ownerRaw);
        return { enabled: ownerConf.gc.enabled, mode: ownerConf.gc.mode };
    } else {
        const ownerRaw = getOwnerConfig('antiedit');
        const ownerConf = normalizeOwnerConfig(ownerRaw);
        return { enabled: ownerConf.pm.enabled, mode: ownerConf.pm.mode };
    }
}

async function antieditCommand(sock, chatId, message, args) {
    const isGroup = chatId.endsWith('@g.us');
    const senderId = message.key.participant || message.key.remoteJid;
    const botName = getBotName();
    const fake = createFakeContact(senderId);
    
    if (isGroup) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === senderId);
            if (!participant?.admin && !message.key.fromMe && !db.isSudo(senderId)) {
                return sock.sendMessage(chatId, { 
                    text: `*${botName}*\nAdmin only command!` 
                }, { quoted: fake });
            }
        } catch {}
    } else {
        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { 
                text: `*${botName}*\nOwner only command!` 
            }, { quoted: fake });
        }
    }

    const ownerRaw = getOwnerConfig('antiedit');
    const ownerConf = normalizeOwnerConfig(ownerRaw);
    const sub = (args || '').trim().toLowerCase();

    if (!sub) {
        const { getPrefix } = require('./setprefix');
        const p = getPrefix();
        let groupStatus = '';
        if (isGroup) {
            const gc = getEffectiveConfig(chatId);
            groupStatus = `This Group: ${gc.enabled ? 'ON' : 'OFF'} (${gc.mode})\n`;
        }
        const helpText = `*${botName} ANTIEDIT*\n\n` +
                        `Groups: ${ownerConf.gc.enabled ? 'ON' : 'OFF'} (${ownerConf.gc.mode})\n` +
                        `PMs: ${ownerConf.pm.enabled ? 'ON' : 'OFF'} (${ownerConf.pm.mode})\n` +
                        groupStatus +
                        `Tracked messages: ${originalMessages.size}\n\n` +
                        `*Commands:*\n` +
                        `${p}antiedit on/off - Toggle all\n` +
                        `${p}antiedit gc on/off - Toggle groups\n` +
                        `${p}antiedit pm on/off - Toggle PMs\n` +
                        `${p}antiedit gc private/chat/both - Group mode\n` +
                        `${p}antiedit pm private/chat/both - PM mode\n` +
                        `${p}antiedit private/chat/both - Current scope mode\n` +
                        `${p}antiedit status - Show status`;
        
        await sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
        return;
    }

    let responseText = '';
    const parts = sub.split(/\s+/);
    const scope = parts[0];
    const action = parts[1] || '';

    if (scope === 'gc' || scope === 'group' || scope === 'groups') {
        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            ownerConf.gc.enabled = true;
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit GROUPS: ON\nMode: ${ownerConf.gc.mode}`;
        } else if (toggle === 'off') {
            ownerConf.gc.enabled = false;
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit GROUPS: OFF`;
        } else if (['private', 'prvt', 'priv', 'pm'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'private';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit GROUPS: PRIVATE\nEdit notifications sent to owner DM.`;
        } else if (['chat', 'cht'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'chat';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit GROUPS: CHAT\nEdit notifications sent to same chat.`;
        } else if (['both', 'all'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'both';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit GROUPS: BOTH\nEdit notifications sent to owner DM and chat.`;
        } else {
            responseText = `*${botName}*\nUsage: .antiedit gc on/off/private/chat/both`;
        }
    } else if (scope === 'pm' || scope === 'dm' || scope === 'pms' || scope === 'dms') {
        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            ownerConf.pm.enabled = true;
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit PMs: ON\nMode: ${ownerConf.pm.mode}`;
        } else if (toggle === 'off') {
            ownerConf.pm.enabled = false;
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit PMs: OFF`;
        } else if (['private', 'prvt', 'priv'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'private';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit PMs: PRIVATE\nEdit notifications sent to owner DM.`;
        } else if (['chat', 'cht'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'chat';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit PMs: CHAT\nEdit notifications sent to same chat.`;
        } else if (['both', 'all'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'both';
            setOwnerConfig('antiedit', ownerConf);
            responseText = `*${botName}*\nAntiEdit PMs: BOTH\nEdit notifications sent to owner DM and chat.`;
        } else {
            responseText = `*${botName}*\nUsage: .antiedit pm on/off/private/chat/both`;
        }
    } else if (scope === 'status') {
        responseText = `*${botName} ANTIEDIT STATUS*\n\n` +
                      `Groups: ${ownerConf.gc.enabled ? 'ON' : 'OFF'} (${ownerConf.gc.mode})\n` +
                      `PMs: ${ownerConf.pm.enabled ? 'ON' : 'OFF'} (${ownerConf.pm.mode})\n` +
                      `Tracked: ${originalMessages.size} messages`;
    } else {
        const toggle = parseToggleCommand(scope);
        if (toggle === 'on') {
            if (isGroup) {
                setGroupConfig(chatId, 'antiedit', { enabled: true, mode: 'private' });
                responseText = `*${botName}*\nAntiEdit ENABLED for this group\nMode: private`;
            } else {
                ownerConf.gc.enabled = true;
                ownerConf.pm.enabled = true;
                setOwnerConfig('antiedit', ownerConf);
                responseText = `*${botName}*\nAntiEdit ENABLED (Groups + PMs)`;
            }
        } else if (toggle === 'off') {
            if (isGroup) {
                setGroupConfig(chatId, 'antiedit', { enabled: false, mode: 'private' });
                responseText = `*${botName}*\nAntiEdit DISABLED for this group`;
            } else {
                ownerConf.gc.enabled = false;
                ownerConf.pm.enabled = false;
                setOwnerConfig('antiedit', ownerConf);
                responseText = `*${botName}*\nAntiEdit DISABLED (Groups + PMs)`;
            }
        } else if (['private', 'prvt', 'priv'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antiedit', { enabled: true, mode: 'private' });
                responseText = `*${botName}*\nAntiEdit PRIVATE for this group\nEdit notifications sent to owner DM.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'private';
                setOwnerConfig('antiedit', ownerConf);
                responseText = `*${botName}*\nAntiEdit PMs: PRIVATE\nEdit notifications sent to owner DM.`;
            }
        } else if (['chat', 'cht'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antiedit', { enabled: true, mode: 'chat' });
                responseText = `*${botName}*\nAntiEdit CHAT for this group\nEdit notifications sent to same chat.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'chat';
                setOwnerConfig('antiedit', ownerConf);
                responseText = `*${botName}*\nAntiEdit PMs: CHAT\nEdit notifications sent to same chat.`;
            }
        } else if (['both', 'all'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antiedit', { enabled: true, mode: 'both' });
                responseText = `*${botName}*\nAntiEdit BOTH for this group\nEdit notifications sent to owner DM and chat.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'both';
                setOwnerConfig('antiedit', ownerConf);
                responseText = `*${botName}*\nAntiEdit PMs: BOTH\nEdit notifications sent to owner DM and chat.`;
            }
        } else {
            responseText = `*${botName}*\nInvalid! Use:\n` +
                          `.antiedit on/off\n` +
                          `.antiedit gc on/off/private/chat/both\n` +
                          `.antiedit pm on/off/private/chat/both\n` +
                          `.antiedit private/chat/both`;
        }
    }

    await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
}

function storeOriginalMessage(message) {
    try {
        if (!message?.key?.id) return;
        
        const chatId = message.key.remoteJid;
        if (!chatId || chatId === 'status@broadcast') return;
        
        let text = '';
        const msg = message.message;
        if (!msg) return;
        
        if (msg.protocolMessage || msg.senderKeyDistributionMessage) return;
        
        if (msg.conversation) {
            text = msg.conversation;
        } else if (msg.extendedTextMessage?.text) {
            text = msg.extendedTextMessage.text;
        } else if (msg.imageMessage?.caption) {
            text = msg.imageMessage.caption;
        } else if (msg.videoMessage?.caption) {
            text = msg.videoMessage.caption;
        }
        
        if (!text) return;
        
        if (originalMessages.size >= MAX_STORED_MESSAGES) {
            const firstKey = originalMessages.keys().next().value;
            originalMessages.delete(firstKey);
        }
        
        originalMessages.set(message.key.id, {
            text,
            sender: message.key.participant || message.key.remoteJid,
            chatId,
            timestamp: Date.now(),
            pushName: message.pushName || 'Unknown'
        });
        
    } catch (err) {
        console.error('Error storing original message:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function handleEditedMessage(sock, editedMessage) {
    try {
        const chatId = editedMessage.key.remoteJid;
        if (!chatId) return;
        
        const config = getEffectiveConfig(chatId);
        if (!config?.enabled) return;
        
        let messageId = editedMessage.key.id;
        
        const msg = editedMessage.message;
        if (msg?.protocolMessage?.key?.id) {
            messageId = msg.protocolMessage.key.id;
        }
        
        if (editedMessage.update?.message?.protocolMessage?.key?.id) {
            messageId = editedMessage.update.message.protocolMessage.key.id;
        }
        
        const original = originalMessages.get(messageId);
        if (!original) return;
        
        let newText = '';
        
        if (msg?.protocolMessage?.editedMessage) {
            const edited = msg.protocolMessage.editedMessage;
            if (edited.conversation) {
                newText = edited.conversation;
            } else if (edited.extendedTextMessage?.text) {
                newText = edited.extendedTextMessage.text;
            } else if (edited.imageMessage?.caption) {
                newText = edited.imageMessage.caption;
            } else if (edited.videoMessage?.caption) {
                newText = edited.videoMessage.caption;
            }
        } else if (msg?.editedMessage) {
            const em = msg.editedMessage.message || msg.editedMessage;
            if (em.conversation) {
                newText = em.conversation;
            } else if (em.extendedTextMessage?.text) {
                newText = em.extendedTextMessage.text;
            } else if (em.imageMessage?.caption) {
                newText = em.imageMessage.caption;
            } else if (em.videoMessage?.caption) {
                newText = em.videoMessage.caption;
            }
        }
        
        if (!newText && editedMessage.update?.message) {
            const updateMsg = editedMessage.update.message;
            if (updateMsg.conversation) {
                newText = updateMsg.conversation;
            } else if (updateMsg.extendedTextMessage?.text) {
                newText = updateMsg.extendedTextMessage.text;
            } else if (updateMsg.imageMessage?.caption) {
                newText = updateMsg.imageMessage.caption;
            } else if (updateMsg.videoMessage?.caption) {
                newText = updateMsg.videoMessage.caption;
            } else if (updateMsg.protocolMessage?.editedMessage) {
                const pe = updateMsg.protocolMessage.editedMessage;
                newText = pe.conversation || pe.extendedTextMessage?.text || pe.imageMessage?.caption || pe.videoMessage?.caption || '';
            }
        }
        
        if (!newText && msg) {
            newText = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || '';
        }
        
        if (!newText || newText === original.text) return;
        
        const botName = getBotName();
        const senderNumber = original.sender.split('@')[0];
        const time = new Date().toLocaleString('en-US', {
            hour12: true, hour: '2-digit', minute: '2-digit'
        });
        
        let groupName = '';
        if (chatId.endsWith('@g.us')) {
            try {
                const metadata = await sock.groupMetadata(chatId);
                groupName = metadata.subject;
            } catch {}
        }
        
        let notificationText = `*${botName} - MESSAGE EDITED*\n\n` +
                              `By: @${senderNumber}\n` +
                              `Name: ${original.pushName}\n` +
                              `Time: ${time}\n`;
        if (groupName) notificationText += `Group: ${groupName}\n`;
        notificationText += `\n*ORIGINAL MESSAGE:*\n${original.text.substring(0, 500)}${original.text.length > 500 ? '...' : ''}\n\n` +
                           `*EDITED TO:*\n${newText.substring(0, 500)}${newText.length > 500 ? '...' : ''}`;
        
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const fake = createFakeContact(original.sender);
        const mode = config.mode || 'private';
        
        const targets = [];
        if (mode === 'private' || mode === 'both') targets.push(ownerNumber);
        if ((mode === 'chat' || mode === 'both') && chatId !== ownerNumber) targets.push(chatId);
        if (targets.length === 0) targets.push(ownerNumber);
        
        for (const target of targets) {
            await sock.sendMessage(target, {
                text: notificationText,
                mentions: [original.sender]
            }, { quoted: fake });
        }
        
        originalMessages.set(messageId, {
            ...original,
            text: newText,
            timestamp: Date.now()
        });
        
    } catch (err) {
        console.error('Error handling edited message:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

setInterval(() => {
    const cutoff = Date.now() - MESSAGE_RETENTION_MS;
    for (const [key, value] of originalMessages.entries()) {
        if (value.timestamp < cutoff) {
            originalMessages.delete(key);
        }
    }
}, 3600000);

module.exports = {
    antieditCommand,
    storeOriginalMessage,
    handleEditedMessage,
    handleMessageUpdate: handleEditedMessage
};
