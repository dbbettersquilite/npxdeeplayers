const { getOwnerConfig, setOwnerConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function autoreadCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nOwner only command!`
            }, { quoted: fake });
            return;
        }

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];

        const config = getOwnerConfig('autoread') || { mode: 'off' };

        if (args.length === 0) {
            const usageText = `*${botName} AUTOREAD*\n\n` +
                `Current Mode: ${config.mode}\n\n` +
                `*Commands:*\n` +
                `.autoread on - Read all messages\n` +
                `.autoread pm - Read PM only\n` +
                `.autoread group - Read groups only\n` +
                `.autoread off - Disable\n` +
                `.autoread status - Show status`;

            await sock.sendMessage(chatId, { text: usageText }, { quoted: fake });
            return;
        }

        const action = args[0].toLowerCase();
        let responseText = '';

        if (action === 'status') {
            responseText = `*${botName}*\nAutoread mode: ${config.mode}`;
        } else if (action === 'on' || action === 'all') {
            setOwnerConfig('autoread', { mode: 'all' });
            responseText = `*${botName}*\nAutoread ENABLED for all messages`;
        } else if (action === 'off') {
            setOwnerConfig('autoread', { mode: 'off' });
            responseText = `*${botName}*\nAutoread DISABLED`;
        } else if (action === 'pm') {
            setOwnerConfig('autoread', { mode: 'pm' });
            responseText = `*${botName}*\nAutoread enabled for PMs only`;
        } else if (action === 'group' || action === 'groups') {
            setOwnerConfig('autoread', { mode: 'group' });
            responseText = `*${botName}*\nAutoread enabled for groups only`;
        } else {
            responseText = `*${botName}*\nInvalid mode! Use: on, off, pm, group`;
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
    } catch (error) {
        console.error('Error in autoread command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

function isAutoreadEnabled() {
    const config = getOwnerConfig('autoread');
    return config?.mode && config.mode !== 'off';
}

async function handleAutoread(sock, message) {
    try {
        const config = getOwnerConfig('autoread');
        if (!config || config.mode === 'off') return;

        const chatId = message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        if (config.mode === 'all' || 
            (config.mode === 'pm' && !isGroup) || 
            (config.mode === 'group' && isGroup)) {
            await sock.readMessages([message.key]);
        }
    } catch (error) {
        console.error('Autoread error:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    autoreadCommand,
    isAutoreadEnabled,
    handleAutoread
};
