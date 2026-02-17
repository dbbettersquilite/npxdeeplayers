const { getOwnerConfig, setOwnerConfig, parseToggleCommand, parseActionCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const processedCalls = new Map();
const CALL_COOLDOWN_MS = 30000;

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function anticallCommand(sock, chatId, message, args) {
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    
    if (!await isAuthorized(sock, message)) {
        return sock.sendMessage(chatId, { 
            text: `*${botName}*\nOwner only command!` 
        }, { quoted: fake });
    }

    const config = getOwnerConfig('anticall');
    const sub = (args || '').trim().toLowerCase();

    if (!sub) {
        const helpText = `*${botName} ANTICALL*\n\n` +
                        `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                        `Mode: ${config.mode || 'block'}\n` +
                        `Message: ${config.message || 'Calls not allowed!'}\n\n` +
                        `*Commands:*\n` +
                        `.anticall on - Enable\n` +
                        `.anticall off - Disable\n` +
                        `.anticall block - Block caller\n` +
                        `.anticall decline - Decline only\n` +
                        `.anticall both - Decline & block\n` +
                        `.anticall allow - Allow calls\n` +
                        `.setcallmsg <text> - Set custom message\n` +
                        `.anticall status - Show status`;
        
        await sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
        return;
    }

    let newConfig = { ...config };
    let responseText = '';

    if (sub === 'status') {
        const statusText = `*${botName} ANTICALL STATUS*\n\n` +
                          `Status: ${config.enabled ? 'ACTIVE' : 'INACTIVE'}\n` +
                          `Mode: ${config.mode || 'block'}\n` +
                          `Message: ${config.message || 'Calls not allowed!'}`;
        await sock.sendMessage(chatId, { text: statusText }, { quoted: fake });
        return;
    }

    const toggle = parseToggleCommand(sub);
    if (toggle === 'on') {
        newConfig.enabled = true;
        responseText = `*${botName}*\nAnticall ENABLED\nMode: ${newConfig.mode || 'block'}`;
    } else if (toggle === 'off') {
        newConfig.enabled = false;
        responseText = `*${botName}*\nAnticall DISABLED`;
    } else {
        const action = parseActionCommand(sub);
        if (action === 'block') {
            newConfig.mode = 'block';
            newConfig.enabled = true;
            responseText = `*${botName}*\nMode: BLOCK\nCallers will be blocked.`;
        } else if (action === 'decline') {
            newConfig.mode = 'decline';
            newConfig.enabled = true;
            responseText = `*${botName}*\nMode: DECLINE\nCalls will be declined only.`;
        } else if (sub === 'both') {
            newConfig.mode = 'both';
            newConfig.enabled = true;
            responseText = `*${botName}*\nMode: BOTH\nCalls will be declined and caller blocked.`;
        } else if (action === 'allow') {
            newConfig.mode = 'allow';
            newConfig.enabled = false;
            responseText = `*${botName}*\nMode: ALLOW\nAll calls allowed.`;
        } else if (sub.startsWith('msg ') || sub.startsWith('message ')) {
            const msgText = args.replace(/^(msg|message)\s+/i, '').trim();
            if (msgText) {
                newConfig.message = msgText;
                responseText = `*${botName}*\nCustom message set!\n"${msgText}"`;
            } else {
                responseText = `*${botName}*\nPlease provide a message!`;
            }
        } else {
            responseText = `*${botName}*\nInvalid command!\nUse: on, off, block, decline, both, allow`;
        }
    }

    if (responseText && !responseText.includes('Invalid') && !responseText.includes('provide')) {
        setOwnerConfig('anticall', newConfig);
    }

    await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
}

async function setcallmsgCommand(sock, chatId, message, args) {
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    
    if (!await isAuthorized(sock, message)) {
        return sock.sendMessage(chatId, { 
            text: `*${botName}*\nOwner only command!` 
        }, { quoted: fake });
    }

    const msgText = (args || '').trim();
    
    if (!msgText) {
        const config = getOwnerConfig('anticall');
        return sock.sendMessage(chatId, { 
            text: `*${botName} SETCALLMSG*\n\nCurrent message: ${config.message || 'Calls not allowed!'}\n\nUsage: .setcallmsg <your message>` 
        }, { quoted: fake });
    }

    const config = getOwnerConfig('anticall');
    setOwnerConfig('anticall', { ...config, message: msgText });
    
    await sock.sendMessage(chatId, { 
        text: `*${botName}*\nCall message set!\n"${msgText}"` 
    }, { quoted: fake });
}

async function handleIncomingCall(sock, call) {
    try {
        const config = getOwnerConfig('anticall');
        
        if (!config.enabled || config.mode === 'allow') return;
        
        const callKey = call.id || `${call.from}_${Date.now()}`;
        const now = Date.now();
        if (processedCalls.has(callKey)) {
            const lastTime = processedCalls.get(callKey);
            if (now - lastTime < CALL_COOLDOWN_MS) return;
        }
        processedCalls.set(callKey, now);
        
        if (processedCalls.size > 50) {
            for (const [key, time] of processedCalls) {
                if (now - time > 60000) processedCalls.delete(key);
            }
        }
        
        const callerId = call.from;
        const callerNumber = callerId.split('@')[0];
        const botName = getBotName();
        const fake = createFakeContact(callerId);
        
        try { await sock.rejectCall(call.id, call.from); } catch (e) {}
        
        const customMsg = config.message || 'Calls not allowed!';
        let modeText = '';
        
        switch (config.mode) {
            case 'block':
                modeText = 'You have been blocked.';
                break;
            case 'decline':
                modeText = 'Call declined.';
                break;
            case 'both':
                modeText = 'Call declined and you have been blocked.';
                break;
            default:
                modeText = 'Call declined.';
        }
        
        const responseMsg = `*${botName}*\n\n${customMsg}\n${modeText}`;
        
        await sock.sendMessage(callerId, { text: responseMsg }, { quoted: fake });
        
        if (config.mode === 'block' || config.mode === 'both') {
            try {
                await sock.updateBlockStatus(callerId, 'block');
            } catch (blockErr) {
                console.error('Error blocking caller:', blockErr.message, 'Line:', blockErr.stack?.split('\n')[1]);
            }
            
            const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            await sock.sendMessage(ownerNumber, {
                text: `*${botName} - CALL BLOCKED*\n\nFrom: @${callerNumber}\nAction: ${config.mode.toUpperCase()}`,
                mentions: [callerId]
            }, { quoted: fake });
        }
        
    } catch (err) {
        console.error('Error handling call:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

function readState() {
    const config = getOwnerConfig('anticall');
    return { enabled: config.enabled || false };
}

module.exports = { 
    anticallCommand, 
    setcallmsgCommand,
    handleIncomingCall,
    readState 
};
