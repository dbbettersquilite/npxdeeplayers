const { getBotName, getMenuImage, getOwnerName } = require('./botConfig');

function createFakeContact(input = '0') {
    const botName = getBotName();
    let rawId = '0';
    if (input && typeof input === 'object' && input.key) {
        rawId = input.key.participant || input.key.remoteJid || '0';
    } else if (typeof input === 'string') {
        rawId = input;
    }
    const cleanId = String(rawId).split(':')[0].split('@')[0] || '0';
    const senderJid = cleanId !== '0' ? `${cleanId}@s.whatsapp.net` : '0@s.whatsapp.net';
    
    return {
        key: {
            participants: senderJid,
            remoteJid: senderJid,
            fromMe: false,
            id: "DAVEX" + Math.random().toString(36).substring(2, 12).toUpperCase()
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:${botName}\nitem1.TEL;waid=${cleanId}:${cleanId}\nitem1.X-ABLabel:Phone\nEND:VCARD`
            }
        },
        participant: senderJid
    };
}

function createStyledMessage(title, content, options = {}) {
    const { showBorder = true, emoji = '' } = options;
    
    let msg = '';
    if (showBorder) {
        msg += '━━━━━━━━━━━━━━━━━━━━━\n';
    }
    if (emoji) {
        msg += `${emoji} `;
    }
    msg += `*${title}*\n`;
    if (showBorder) {
        msg += '━━━━━━━━━━━━━━━━━━━━━\n';
    }
    msg += '\n';
    msg += content;
    if (showBorder) {
        msg += '\n━━━━━━━━━━━━━━━━━━━━━';
    }
    
    return msg;
}

function createSuccessMessage(text) {
    return `*${text}*`;
}

function createErrorMessage(text) {
    return `*${text}*`;
}

function createInfoMessage(title, details) {
    let msg = `*${title}*\n\n`;
    for (const [key, value] of Object.entries(details)) {
        msg += `${key}: ${value}\n`;
    }
    return msg.trim();
}

async function sendWithFakeContact(sock, chatId, text, message = null) {
    const fakeContact = createFakeContact(message?.key?.participant || message?.key?.remoteJid);
    return await sock.sendMessage(chatId, { text }, { quoted: fakeContact });
}

async function sendStyledWithFakeContact(sock, chatId, title, content, message = null, options = {}) {
    const fakeContact = createFakeContact(message?.key?.participant || message?.key?.remoteJid);
    const styledText = createStyledMessage(title, content, options);
    return await sock.sendMessage(chatId, { text: styledText }, { quoted: fakeContact });
}

module.exports = {
    createFakeContact,
    getBotName,
    getMenuImage,
    getOwnerName,
    createStyledMessage,
    createSuccessMessage,
    createErrorMessage,
    createInfoMessage,
    sendWithFakeContact,
    sendStyledWithFakeContact
};
