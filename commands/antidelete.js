const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile, unlink, readdir, stat } = require('fs/promises');
const { getOwnerConfig, setOwnerConfig, getGroupConfig, setGroupConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');
const MESSAGE_RETENTION_SECONDS = 604800;
const MESSAGE_RETENTION_MS = MESSAGE_RETENTION_SECONDS * 1000;

async function ensureTempDir() {
    try {
        await fs.promises.mkdir(TEMP_MEDIA_DIR, { recursive: true });
    } catch {}
}

async function getFolderSizeInMB(folderPath) {
    try {
        const files = await readdir(folderPath);
        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            try {
                const stats = await stat(filePath);
                if (stats.isFile()) totalSize += stats.size;
            } catch {}
        }
        return totalSize / (1024 * 1024);
    } catch {
        return 0;
    }
}

async function cleanTempFolder(maxStorageMB = 200) {
    try {
        const sizeMB = await getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > maxStorageMB) {
            const files = await readdir(TEMP_MEDIA_DIR);
            let deletedCount = 0;
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                try {
                    await unlink(filePath);
                    deletedCount++;
                } catch {}
            }
            return deletedCount;
        }
        return 0;
    } catch {
        return 0;
    }
}

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
        if (db.hasGroupSetting(chatId, 'antidelete')) {
            const groupConf = getGroupConfig(chatId, 'antidelete');
            if (typeof groupConf === 'object' && groupConf.enabled !== undefined) {
                return groupConf;
            }
        }
        const ownerRaw = getOwnerConfig('antidelete');
        const ownerConf = normalizeOwnerConfig(ownerRaw);
        return { enabled: ownerConf.gc.enabled, mode: ownerConf.gc.mode };
    } else {
        const ownerRaw = getOwnerConfig('antidelete');
        const ownerConf = normalizeOwnerConfig(ownerRaw);
        return { enabled: ownerConf.pm.enabled, mode: ownerConf.pm.mode };
    }
}

async function handleAntideleteCommand(sock, chatId, message, match) {
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    
    if (!await isAuthorized(sock, message)) {
        return sock.sendMessage(chatId, { 
            text: `*${botName}*\nOwner only command!` 
        }, { quoted: fake });
    }

    const isGroup = chatId.endsWith('@g.us');
    const ownerRaw = getOwnerConfig('antidelete');
    const ownerConf = normalizeOwnerConfig(ownerRaw);

    if (!match) {
        const sizeMB = await getFolderSizeInMB(TEMP_MEDIA_DIR);
        const msgCount = db.getMessageCount();
        let groupStatus = '';
        if (isGroup) {
            const gc = getEffectiveConfig(chatId);
            groupStatus = `This Group: ${gc.enabled ? 'ON' : 'OFF'} (${gc.mode})\n`;
        }
        
        const text = `*${botName} ANTIDELETE*\n\n` +
                    `Groups: ${ownerConf.gc.enabled ? 'ON' : 'OFF'} (${ownerConf.gc.mode})\n` +
                    `PMs: ${ownerConf.pm.enabled ? 'ON' : 'OFF'} (${ownerConf.pm.mode})\n` +
                    groupStatus +
                    `Storage: ${sizeMB.toFixed(1)}MB\n` +
                    `Messages: ${msgCount}\n` +
                    `Retention: 7 days\n\n` +
                    `*Commands:*\n` +
                    `.antidelete on/off - Toggle all\n` +
                    `.antidelete gc on/off - Toggle groups\n` +
                    `.antidelete pm on/off - Toggle PMs\n` +
                    `.antidelete gc private/chat/both - Group mode\n` +
                    `.antidelete pm private/chat/both - PM mode\n` +
                    `.antidelete private/chat/both - Current scope mode\n` +
                    `.antidelete clean - Clear storage\n` +
                    `.antidelete stats - Show statistics`;
        
        await sock.sendMessage(chatId, { text }, { quoted: fake });
        return;
    }

    const command = match.toLowerCase().trim();
    let responseText = '';

    const parts = command.split(/\s+/);
    const scope = parts[0];
    const action = parts[1] || '';

    if (scope === 'gc' || scope === 'group' || scope === 'groups') {
        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            ownerConf.gc.enabled = true;
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete GROUPS: ON\nMode: ${ownerConf.gc.mode}`;
        } else if (toggle === 'off') {
            ownerConf.gc.enabled = false;
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete GROUPS: OFF`;
        } else if (['private', 'prvt', 'priv'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'private';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete GROUPS: PRIVATE\nDeleted group messages sent to owner DM.`;
        } else if (['chat', 'cht'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'chat';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete GROUPS: CHAT\nDeleted group messages sent to same chat.`;
        } else if (['both', 'all'].includes(action)) {
            ownerConf.gc.enabled = true;
            ownerConf.gc.mode = 'both';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete GROUPS: BOTH\nDeleted group messages sent to owner DM and chat.`;
        } else {
            responseText = `*${botName}*\nUsage: .antidelete gc on/off/private/chat/both`;
        }
    } else if (scope === 'pm' || scope === 'dm' || scope === 'pms' || scope === 'dms') {
        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            ownerConf.pm.enabled = true;
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete PMs: ON\nMode: ${ownerConf.pm.mode}`;
        } else if (toggle === 'off') {
            ownerConf.pm.enabled = false;
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete PMs: OFF`;
        } else if (['private', 'prvt', 'priv'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'private';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete PMs: PRIVATE\nDeleted PM messages sent to owner DM.`;
        } else if (['chat', 'cht'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'chat';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete PMs: CHAT\nDeleted PM messages sent to same chat.`;
        } else if (['both', 'all'].includes(action)) {
            ownerConf.pm.enabled = true;
            ownerConf.pm.mode = 'both';
            setOwnerConfig('antidelete', ownerConf);
            responseText = `*${botName}*\nAntidelete PMs: BOTH\nDeleted PM messages sent to owner DM and chat.`;
        } else {
            responseText = `*${botName}*\nUsage: .antidelete pm on/off/private/chat/both`;
        }
    } else {
        const toggle = parseToggleCommand(scope);
        if (toggle === 'on') {
            if (isGroup) {
                setGroupConfig(chatId, 'antidelete', { enabled: true, mode: 'private' });
                responseText = `*${botName}*\nAntidelete ENABLED for this group\nMode: private`;
            } else {
                ownerConf.gc.enabled = true;
                ownerConf.pm.enabled = true;
                setOwnerConfig('antidelete', ownerConf);
                responseText = `*${botName}*\nAntidelete ENABLED (Groups + PMs)`;
            }
        } else if (toggle === 'off') {
            if (isGroup) {
                setGroupConfig(chatId, 'antidelete', { enabled: false, mode: 'private' });
                responseText = `*${botName}*\nAntidelete DISABLED for this group`;
            } else {
                ownerConf.gc.enabled = false;
                ownerConf.pm.enabled = false;
                setOwnerConfig('antidelete', ownerConf);
                responseText = `*${botName}*\nAntidelete DISABLED (Groups + PMs)`;
            }
        } else if (['private', 'prvt', 'priv'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antidelete', { enabled: true, mode: 'private' });
                responseText = `*${botName}*\nAntidelete PRIVATE for this group\nDeleted messages sent to owner DM.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'private';
                setOwnerConfig('antidelete', ownerConf);
                responseText = `*${botName}*\nAntidelete PMs: PRIVATE\nDeleted messages sent to owner DM.`;
            }
        } else if (['chat', 'cht'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antidelete', { enabled: true, mode: 'chat' });
                responseText = `*${botName}*\nAntidelete CHAT for this group\nDeleted messages sent to same chat.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'chat';
                setOwnerConfig('antidelete', ownerConf);
                responseText = `*${botName}*\nAntidelete PMs: CHAT\nDeleted messages sent to same chat.`;
            }
        } else if (['both', 'all'].includes(scope)) {
            if (isGroup) {
                setGroupConfig(chatId, 'antidelete', { enabled: true, mode: 'both' });
                responseText = `*${botName}*\nAntidelete BOTH for this group\nDeleted messages sent to owner DM and chat.`;
            } else {
                ownerConf.pm.enabled = true;
                ownerConf.pm.mode = 'both';
                setOwnerConfig('antidelete', ownerConf);
                responseText = `*${botName}*\nAntidelete PMs: BOTH\nDeleted messages sent to owner DM and chat.`;
            }
        } else if (scope === 'clean' || scope === 'clear') {
            const deleted = await cleanTempFolder(0);
            const cleaned = db.cleanOldMessages(0);
            responseText = `*${botName}*\nCleaned: ${deleted} files, ${cleaned} messages`;
        } else if (scope === 'stats' || scope === 'status') {
            const sizeMB = await getFolderSizeInMB(TEMP_MEDIA_DIR);
            const msgCount = db.getMessageCount();
            responseText = `*${botName} ANTIDELETE STATS*\n\n` +
                          `Messages stored: ${msgCount}\n` +
                          `Storage used: ${sizeMB.toFixed(1)}MB\n` +
                          `Groups: ${ownerConf.gc.enabled ? 'ON' : 'OFF'} (${ownerConf.gc.mode})\n` +
                          `PMs: ${ownerConf.pm.enabled ? 'ON' : 'OFF'} (${ownerConf.pm.mode})\n` +
                          `Retention: 7 days`;
        } else {
            responseText = `*${botName}*\nInvalid command!\n\nUse:\n` +
                          `.antidelete on/off\n` +
                          `.antidelete gc on/off/private/chat/both\n` +
                          `.antidelete pm on/off/private/chat/both\n` +
                          `.antidelete private/chat/both\n` +
                          `.antidelete clean | stats`;
        }
    }

    await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
}

async function storeMessage(sock, message) {
    try {
        await ensureTempDir();
        
        const chatId = message.key.remoteJid;
        if (!chatId) return;
        if (!message.key?.id) return;
        if (chatId === 'status@broadcast') return;

        const messageId = message.key.id;
        const sender = message.key.participant || message.key.remoteJid;
        const pushName = message.pushName || 'Unknown';
        
        let content = '';
        let mediaType = null;
        let mediaPath = null;
        let isViewOnce = false;

        const msg = message.message;
        if (!msg) return;

        if (msg.protocolMessage || msg.senderKeyDistributionMessage) return;

        const viewOnceContainer = msg.viewOnceMessageV2?.message || msg.viewOnceMessage?.message;
        
        if (viewOnceContainer) {
            isViewOnce = true;
            if (viewOnceContainer.imageMessage) {
                mediaType = 'image';
                content = viewOnceContainer.imageMessage.caption || '';
                mediaPath = await downloadMedia(viewOnceContainer.imageMessage, 'image', `${Date.now()}_viewonce.jpg`);
            } else if (viewOnceContainer.videoMessage) {
                mediaType = 'video';
                content = viewOnceContainer.videoMessage.caption || '';
                mediaPath = await downloadMedia(viewOnceContainer.videoMessage, 'video', `${Date.now()}_viewonce.mp4`);
            }
        } else {
            if (msg.conversation) {
                content = msg.conversation;
            } else if (msg.extendedTextMessage?.text) {
                content = msg.extendedTextMessage.text;
            } else if (msg.imageMessage) {
                mediaType = 'image';
                content = msg.imageMessage.caption || '';
                mediaPath = await downloadMedia(msg.imageMessage, 'image', `${Date.now()}.jpg`);
            } else if (msg.videoMessage) {
                mediaType = 'video';
                content = msg.videoMessage.caption || '';
                mediaPath = await downloadMedia(msg.videoMessage, 'video', `${Date.now()}.mp4`);
            } else if (msg.stickerMessage) {
                mediaType = 'sticker';
                mediaPath = await downloadMedia(msg.stickerMessage, 'sticker', `${Date.now()}.webp`);
            } else if (msg.audioMessage) {
                mediaType = 'audio';
                const ext = msg.audioMessage.mimetype?.includes('ogg') ? 'ogg' : 'mp3';
                mediaPath = await downloadMedia(msg.audioMessage, 'audio', `${Date.now()}.${ext}`);
            } else if (msg.documentMessage) {
                mediaType = 'document';
                content = msg.documentMessage.fileName || 'Document';
                mediaPath = await downloadMedia(msg.documentMessage, 'document', `${Date.now()}_${msg.documentMessage.fileName || 'file'}`);
            }
        }

        if (content || mediaType) {
            db.storeMessage(messageId, chatId, sender, content, mediaType, mediaPath, isViewOnce, pushName);
            
            if (isViewOnce && mediaPath) {
                const config = getEffectiveConfig(chatId);
                if (config.enabled) {
                    await handleViewOnceForward(sock, config, { messageId, chatId, sender, content, mediaType, mediaPath, isViewOnce, pushName });
                }
            }
        }

    } catch (err) {
        console.error('Error storing message:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function downloadMedia(message, type, fileName) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        const filePath = path.join(TEMP_MEDIA_DIR, fileName);
        await writeFile(filePath, buffer);
        return filePath;
    } catch {
        return null;
    }
}

async function handleViewOnceForward(sock, config, storedMessage) {
    try {
        if (!storedMessage.mediaPath || !fs.existsSync(storedMessage.mediaPath)) return;

        const botName = getBotName();
        const senderName = storedMessage.sender.split('@')[0];
        const fake = createFakeContact(storedMessage.sender);
        
        const mediaOptions = {
            caption: `*${botName} - VIEW ONCE*\n\nFrom: @${senderName}\nName: ${storedMessage.pushName}\nType: ${storedMessage.mediaType}`,
            mentions: [storedMessage.sender]
        };

        const targets = getNotificationTargets(sock, storedMessage.chatId, config);
        
        for (const target of targets) {
            try {
                if (storedMessage.mediaType === 'image') {
                    await sock.sendMessage(target, { image: { url: storedMessage.mediaPath }, ...mediaOptions }, { quoted: fake });
                } else if (storedMessage.mediaType === 'video') {
                    await sock.sendMessage(target, { video: { url: storedMessage.mediaPath }, ...mediaOptions }, { quoted: fake });
                }
            } catch {}
        }

    } catch {}
}

function getNotificationTargets(sock, chatId, config) {
    const targets = [];
    const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const mode = config.mode || 'private';
    
    if (mode === 'private' || mode === 'both') {
        targets.push(ownerNumber);
    }
    
    if ((mode === 'chat' || mode === 'both') && chatId !== ownerNumber) {
        targets.push(chatId);
    }
    
    if (targets.length === 0) targets.push(ownerNumber);
    
    return targets;
}

async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const chatId = revocationMessage.key.remoteJid;
        if (!chatId) return;
        
        const config = getEffectiveConfig(chatId);
        if (!config.enabled) return;

        const messageId = revocationMessage.message?.protocolMessage?.key?.id;
        if (!messageId) return;

        const deletedBy = revocationMessage.participant || revocationMessage.key.participant || revocationMessage.key.remoteJid;
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (deletedBy.includes(sock.user.id) || deletedBy === ownerNumber) return;

        const original = db.getMessage(messageId);
        if (!original) return;

        const targets = getNotificationTargets(sock, original.chat_jid, config);
        if (targets.length === 0) return;

        await sendDeletionNotification(sock, original, deletedBy, targets);
        
        db.deleteMessage(messageId);
        if (original.media_path && fs.existsSync(original.media_path)) {
            unlink(original.media_path).catch(() => {});
        }

    } catch (err) {
        console.error('Error handling revocation:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function sendDeletionNotification(sock, original, deletedBy, targets) {
    try {
        const botName = getBotName();
        const senderName = original.sender_jid.split('@')[0];
        const deleterName = deletedBy.split('@')[0];
        const fake = createFakeContact(original.sender_jid);
        
        let groupName = '';
        if (original.chat_jid.endsWith('@g.us')) {
            try {
                const metadata = await sock.groupMetadata(original.chat_jid);
                groupName = metadata.subject;
            } catch {}
        }

        const time = new Date(original.timestamp * 1000).toLocaleString('en-US', {
            hour12: true, hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let text = `*${botName} - MESSAGE DELETED*\n\n`;
        text += `Deleted by: @${deleterName}\n`;
        text += `Original sender: @${senderName}\n`;
        text += `Name: ${original.push_name || 'Unknown'}\n`;
        text += `Time: ${time}\n`;
        if (groupName) text += `Group: ${groupName}\n`;
        if (original.is_view_once) text += `Type: View Once\n`;
        if (original.content) {
            text += `\n*DELETED MESSAGE:*\n${original.content.substring(0, 500)}${original.content.length > 500 ? '...' : ''}`;
        }

        const textMessage = {
            text,
            mentions: [deletedBy, original.sender_jid]
        };

        for (const target of targets) {
            try {
                await sock.sendMessage(target, textMessage, { quoted: fake });
            } catch {}
        }

        if (original.media_type && original.media_path && fs.existsSync(original.media_path)) {
            await sendMediaNotification(sock, original, targets);
        }

    } catch {}
}

async function sendMediaNotification(sock, original, targets) {
    const botName = getBotName();
    const senderName = original.sender_jid.split('@')[0];
    const fake = createFakeContact(original.sender_jid);
    
    const mediaOptions = {
        caption: `*${botName} - DELETED ${original.media_type.toUpperCase()}*\n\nFrom: @${senderName}`,
        mentions: [original.sender_jid]
    };

    for (const target of targets) {
        try {
            switch (original.media_type) {
                case 'image':
                    await sock.sendMessage(target, { image: { url: original.media_path }, ...mediaOptions }, { quoted: fake });
                    break;
                case 'sticker':
                    await sock.sendMessage(target, { sticker: { url: original.media_path } });
                    break;
                case 'video':
                    await sock.sendMessage(target, { video: { url: original.media_path }, ...mediaOptions }, { quoted: fake });
                    break;
                case 'audio':
                    await sock.sendMessage(target, { audio: { url: original.media_path }, mimetype: 'audio/mpeg', ptt: false });
                    break;
                case 'document':
                    await sock.sendMessage(target, { document: { url: original.media_path }, fileName: path.basename(original.media_path), ...mediaOptions }, { quoted: fake });
                    break;
            }
        } catch {}
    }
}

setInterval(() => {
    db.cleanOldMessages(MESSAGE_RETENTION_SECONDS);
    cleanTempFolder(200);
}, 3600000);

module.exports = {
    handleAntideleteCommand,
    handleMessageRevocation,
    storeMessage,
    cleanTempFolder
};
