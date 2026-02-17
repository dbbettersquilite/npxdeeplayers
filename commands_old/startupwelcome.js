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

function isStartupWelcomeOn() {
    try {
        const config = getOwnerConfig('startupWelcome');
        return config !== false;
    } catch (error) {
        console.error('Error getting startup welcome:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return true;
    }
}

function setStartupWelcome(enabled) {
    try {
        setOwnerConfig('startupWelcome', enabled);
        return true;
    } catch (error) {
        console.error('Error setting startup welcome:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return false;
    }
}

async function startupWelcomeCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();

    try {
        if (!await isAuthorized(sock, message)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nOwner only command!`
            }, { quoted: fake });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ').slice(1);
        const action = args[0]?.toLowerCase();

        const currentStatus = isStartupWelcomeOn();

        if (!action) {
            await sock.sendMessage(chatId, {
                text: `*${botName} STARTUP WELCOME*\n\n` +
                    `Current Status: ${currentStatus ? 'ON' : 'OFF'}\n\n` +
                    `*Commands:*\n` +
                    `.startupwelcome on - Enable startup message\n` +
                    `.startupwelcome off - Disable startup message`
            }, { quoted: fake });
            return;
        }

        const toggle = parseToggleCommand(action);
        
        if (toggle === 'on') {
            setStartupWelcome(true);
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nStartup welcome message enabled!`
            }, { quoted: fake });
        } else if (toggle === 'off') {
            setStartupWelcome(false);
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nStartup welcome message disabled!`
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nInvalid option! Use: on/off`
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Startup welcome command error:', error.message, 'Line:', error.stack?.split('\n')[1]);
        await sock.sendMessage(chatId, {
            text: `*${botName}*\nCommand failed!`
        }, { quoted: fake });
    }
}

module.exports = { 
    startupWelcomeCommand, 
    isStartupWelcomeOn, 
    setStartupWelcome 
};
