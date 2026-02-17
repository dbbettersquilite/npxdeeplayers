const { getOwnerConfig, setOwnerConfig, parseToggleCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const recordingIntervals = new Map();

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function autorecordingCommand(sock, chatId, message) {
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

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(/\s+/).slice(1);
        const action = args[0]?.toLowerCase();
        const action2 = args[1]?.toLowerCase();

        const config = getOwnerConfig('autorecording') || { enabled: false, pm: true, group: true };

        if (!action) {
            const helpText = `*${botName} AUTORECORDING*\n\n` +
                `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                `PM: ${config.pm ? 'ON' : 'OFF'}\n` +
                `Group: ${config.group ? 'ON' : 'OFF'}\n\n` +
                `*Commands:*\n` +
                `.autorecording on - Enable for all\n` +
                `.autorecording off - Disable completely\n` +
                `.autorecording pm - Enable for PMs only\n` +
                `.autorecording pm on/off - Toggle PM mode\n` +
                `.autorecording group - Enable for groups only\n` +
                `.autorecording group on/off - Toggle group mode\n` +
                `.autorecording both - Enable for both\n` +
                `.autorecording both off - Disable both`;
            await sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
            return;
        }

        let newConfig = { ...config };
        let responseText = '';

        const toggle = parseToggleCommand(action);

        if (toggle === 'on') {
            newConfig.enabled = true;
            newConfig.pm = true;
            newConfig.group = true;
            responseText = `*${botName}*\nAutorecording ENABLED for both PMs & Groups`;
        } else if (toggle === 'off') {
            newConfig.enabled = false;
            stopAllRecordingIntervals();
            responseText = `*${botName}*\nAutorecording DISABLED`;
        } else if (action === 'pm') {
            const toggle2 = action2 ? parseToggleCommand(action2) : null;
            if (toggle2 === 'off') {
                newConfig.pm = false;
                if (!newConfig.group) newConfig.enabled = false;
                responseText = `*${botName}*\nAutorecording PM mode DISABLED\nGroup: ${newConfig.group ? 'ON' : 'OFF'}`;
            } else {
                newConfig.pm = true;
                newConfig.group = false;
                newConfig.enabled = true;
                responseText = `*${botName}*\nAutorecording enabled for PMs only`;
                if (toggle2 === 'on') {
                    newConfig.group = config.group;
                    responseText = `*${botName}*\nAutorecording PM mode ENABLED\nGroup: ${newConfig.group ? 'ON' : 'OFF'}`;
                }
            }
        } else if (action === 'group') {
            const toggle2 = action2 ? parseToggleCommand(action2) : null;
            if (toggle2 === 'off') {
                newConfig.group = false;
                if (!newConfig.pm) newConfig.enabled = false;
                responseText = `*${botName}*\nAutorecording Group mode DISABLED\nPM: ${newConfig.pm ? 'ON' : 'OFF'}`;
            } else {
                newConfig.group = true;
                newConfig.pm = false;
                newConfig.enabled = true;
                responseText = `*${botName}*\nAutorecording enabled for Groups only`;
                if (toggle2 === 'on') {
                    newConfig.pm = config.pm;
                    responseText = `*${botName}*\nAutorecording Group mode ENABLED\nPM: ${newConfig.pm ? 'ON' : 'OFF'}`;
                }
            }
        } else if (action === 'both') {
            const toggle2 = action2 ? parseToggleCommand(action2) : null;
            if (toggle2 === 'off') {
                newConfig.enabled = false;
                newConfig.pm = false;
                newConfig.group = false;
                stopAllRecordingIntervals();
                responseText = `*${botName}*\nAutorecording DISABLED for both PMs & Groups`;
            } else {
                newConfig.pm = true;
                newConfig.group = true;
                newConfig.enabled = true;
                responseText = `*${botName}*\nAutorecording enabled for both PMs & Groups`;
            }
        } else {
            responseText = `*${botName}*\nInvalid! Use: on, off, pm, group, both\nOr: pm on/off, group on/off, both on/off`;
        }

        if (responseText && !responseText.includes('Invalid')) {
            if (!newConfig.pm && !newConfig.group) {
                newConfig.enabled = false;
                stopAllRecordingIntervals();
            }
            setOwnerConfig('autorecording', newConfig);
        }

        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
    } catch (error) {
        console.error('Error in autorecording command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

function isAutorecordingEnabled() {
    const config = getOwnerConfig('autorecording');
    return config?.enabled || false;
}

function stopAllRecordingIntervals() {
    for (const [key, interval] of recordingIntervals.entries()) {
        clearInterval(interval);
        recordingIntervals.delete(key);
    }
}

async function handleAutorecordingForMessage(sock, chatId) {
    try {
        const config = getOwnerConfig('autorecording');
        if (!config?.enabled) return;
        
        const isGroup = chatId.endsWith('@g.us');
        if (isGroup && !config.group) return;
        if (!isGroup && !config.pm) return;
        
        if (recordingIntervals.has(chatId)) {
            clearInterval(recordingIntervals.get(chatId));
        }

        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('recording', chatId);

        const interval = setInterval(async () => {
            try {
                const currentConfig = getOwnerConfig('autorecording');
                if (!currentConfig?.enabled) {
                    clearInterval(interval);
                    recordingIntervals.delete(chatId);
                    return;
                }
                await sock.sendPresenceUpdate('recording', chatId);
            } catch (e) {
                clearInterval(interval);
                recordingIntervals.delete(chatId);
            }
        }, 4000);

        recordingIntervals.set(chatId, interval);

        setTimeout(() => {
            if (recordingIntervals.has(chatId)) {
                clearInterval(recordingIntervals.get(chatId));
                recordingIntervals.delete(chatId);
                try { sock.sendPresenceUpdate('paused', chatId); } catch(e) {}
            }
        }, 30000);
    } catch (error) {
        console.error('Autorecording error:', error.message);
    }
}

module.exports = {
    autorecordingCommand,
    isAutorecordingEnabled,
    handleAutorecordingForMessage,
    stopAllRecordingIntervals
};
