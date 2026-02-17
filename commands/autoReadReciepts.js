const { getOwnerConfig, setOwnerConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const DEFAULT_CONFIG = {
    enabled: false,
    readReceipts: 'all'
};

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

function loadConfig() {
    try {
        return getOwnerConfig('autoreadreceipts') || { ...DEFAULT_CONFIG };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(config) {
    setOwnerConfig('autoreadreceipts', config);
}

async function autoreadReceiptsCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ').slice(1);

        if (!args.length) {
            const config = loadConfig();
            const status = `*${botName} AUTOREAD RECEIPTS*\n\n` +
                `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                `Mode: ${config.readReceipts}\n\n` +
                `*Commands:*\n` +
                `.autoreadreceipts on - Enable\n` +
                `.autoreadreceipts off - Disable\n` +
                `.autoreadreceipts all - Read all\n` +
                `.autoreadreceipts none - Read none`;
            return sock.sendMessage(chatId, { text: status }, { quoted: fake });
        }

        const action = args[0].toLowerCase();
        const config = loadConfig();

        const toggle = parseToggleCommand(action);
        if (toggle === 'on') {
            config.enabled = true;
            saveConfig(config);
            return sock.sendMessage(chatId, { text: `*${botName}*\nAutoread receipts ENABLED` }, { quoted: fake });
        } else if (toggle === 'off') {
            config.enabled = false;
            saveConfig(config);
            return sock.sendMessage(chatId, { text: `*${botName}*\nAutoread receipts DISABLED` }, { quoted: fake });
        } else if (action === 'all' || action === 'none') {
            config.readReceipts = action;
            saveConfig(config);
            return sock.sendMessage(chatId, { text: `*${botName}*\nRead receipts mode: ${action.toUpperCase()}` }, { quoted: fake });
        } else {
            return sock.sendMessage(chatId, { text: `*${botName}*\nInvalid option! Use: on, off, all, none` }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in autoreadreceipts command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

function isAutoreadReceiptsEnabled() {
    const config = loadConfig();
    return config?.enabled || false;
}

function getReadReceiptsMode() {
    const config = loadConfig();
    return config?.readReceipts || 'all';
}

module.exports = {
    autoreadReceiptsCommand,
    isAutoreadReceiptsEnabled,
    getReadReceiptsMode
};
