const { getOwnerConfig, setOwnerConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

let presenceInterval = null;

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function alwaysonlineCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(/\s+/).slice(1);
        const action = args[0]?.toLowerCase();

        const config = getOwnerConfig('alwaysonline') || { enabled: false };

        if (!action) {
            const newState = !config.enabled;
            if (newState) {
                setOwnerConfig('alwaysonline', { enabled: true });
                setOwnerConfig('alwaysoffline', { enabled: false });
                startPresenceLoop(sock, 'available');
                await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Online ENABLED\nBot will always appear online.` }, { quoted: fake });
            } else {
                setOwnerConfig('alwaysonline', { enabled: false });
                stopPresenceLoop();
                await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Online DISABLED` }, { quoted: fake });
            }
            return;
        }

        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            setOwnerConfig('alwaysonline', { enabled: true });
            setOwnerConfig('alwaysoffline', { enabled: false });
            startPresenceLoop(sock, 'available');
            await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Online ENABLED\nBot will always appear online.` }, { quoted: fake });
        } else if (toggle === 'off') {
            setOwnerConfig('alwaysonline', { enabled: false });
            stopPresenceLoop();
            await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Online DISABLED` }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, { 
                text: `*${botName} ALWAYS ONLINE*\n\nStatus: ${config.enabled ? 'ON' : 'OFF'}\n\n*Usage:*\n.alwaysonline - Toggle on/off\n.alwaysonline on - Enable\n.alwaysonline off - Disable` 
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in alwaysonline:', error.message);
    }
}

async function alwaysofflineCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(/\s+/).slice(1);
        const action = args[0]?.toLowerCase();

        const config = getOwnerConfig('alwaysoffline') || { enabled: false };

        if (!action) {
            const newState = !config.enabled;
            if (newState) {
                setOwnerConfig('alwaysoffline', { enabled: true });
                setOwnerConfig('alwaysonline', { enabled: false });
                startPresenceLoop(sock, 'unavailable');
                await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Offline ENABLED\nBot will always appear offline.` }, { quoted: fake });
            } else {
                setOwnerConfig('alwaysoffline', { enabled: false });
                stopPresenceLoop();
                await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Offline DISABLED` }, { quoted: fake });
            }
            return;
        }

        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            setOwnerConfig('alwaysoffline', { enabled: true });
            setOwnerConfig('alwaysonline', { enabled: false });
            startPresenceLoop(sock, 'unavailable');
            await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Offline ENABLED\nBot will always appear offline.` }, { quoted: fake });
        } else if (toggle === 'off') {
            setOwnerConfig('alwaysoffline', { enabled: false });
            stopPresenceLoop();
            await sock.sendMessage(chatId, { text: `*${botName}*\nAlways Offline DISABLED` }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, { 
                text: `*${botName} ALWAYS OFFLINE*\n\nStatus: ${config.enabled ? 'ON' : 'OFF'}\n\n*Usage:*\n.alwaysoffline - Toggle on/off\n.alwaysoffline on - Enable\n.alwaysoffline off - Disable` 
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in alwaysoffline:', error.message);
    }
}

function startPresenceLoop(sock, presenceType) {
    stopPresenceLoop();
    try { sock.sendPresenceUpdate(presenceType); } catch(e) {}
    presenceInterval = setInterval(async () => {
        try {
            await sock.sendPresenceUpdate(presenceType);
        } catch (e) {}
    }, 10000);
}

function stopPresenceLoop() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

function initPresenceOnConnect(sock) {
    const onlineConfig = getOwnerConfig('alwaysonline') || { enabled: false };
    const offlineConfig = getOwnerConfig('alwaysoffline') || { enabled: false };
    if (onlineConfig.enabled) {
        startPresenceLoop(sock, 'available');
    } else if (offlineConfig.enabled) {
        startPresenceLoop(sock, 'unavailable');
    }
}

module.exports = {
    alwaysonlineCommand,
    alwaysofflineCommand,
    initPresenceOnConnect,
    startPresenceLoop,
    stopPresenceLoop
};
