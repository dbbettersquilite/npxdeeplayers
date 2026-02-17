const isAdmin = require('../lib/isAdmin');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function downloadMediaMessage(message, mediaType) {
    const stream = await downloadContentFromMessage(message, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const tempDir = path.join(__dirname, '../temp/');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const filePath = path.join(tempDir, `${Date.now()}.${mediaType}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

async function hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message) {
    const fake = createFakeContact(senderId);
    const botName = getBotName();
    
    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

    if (!isBotAdmin) {
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nBot needs to be admin!` 
        }, { quoted: fake });
        return;
    }

    if (!isSenderAdmin && !message.key.fromMe && !db.isSudo(senderId)) {
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nAdmin only command!`
        }, { quoted: fake });
        return;
    }

    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants.map(p => p.id);

        if (replyMessage) {
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (quotedMsg?.imageMessage) {
                const filePath = await downloadMediaMessage(quotedMsg.imageMessage, 'image');
                await sock.sendMessage(chatId, {
                    image: fs.readFileSync(filePath),
                    caption: quotedMsg.imageMessage.caption || '',
                    mentions: participants
                });
                fs.unlinkSync(filePath);
            } else if (quotedMsg?.videoMessage) {
                const filePath = await downloadMediaMessage(quotedMsg.videoMessage, 'video');
                await sock.sendMessage(chatId, {
                    video: fs.readFileSync(filePath),
                    caption: quotedMsg.videoMessage.caption || '',
                    mentions: participants
                });
                fs.unlinkSync(filePath);
            } else if (quotedMsg?.stickerMessage) {
                const filePath = await downloadMediaMessage(quotedMsg.stickerMessage, 'sticker');
                await sock.sendMessage(chatId, {
                    sticker: fs.readFileSync(filePath),
                    mentions: participants
                });
                fs.unlinkSync(filePath);
            } else if (quotedMsg?.audioMessage) {
                const filePath = await downloadMediaMessage(quotedMsg.audioMessage, 'audio');
                await sock.sendMessage(chatId, {
                    audio: fs.readFileSync(filePath),
                    ptt: quotedMsg.audioMessage.ptt || false,
                    mentions: participants
                });
                fs.unlinkSync(filePath);
            } else {
                const quotedText = quotedMsg?.conversation || 
                                   quotedMsg?.extendedTextMessage?.text || 
                                   replyMessage;
                await sock.sendMessage(chatId, {
                    text: quotedText,
                    mentions: participants
                });
            }
        } else if (messageText) {
            await sock.sendMessage(chatId, {
                text: messageText,
                mentions: participants
            });
        } else {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nUsage: .hidetag <message> or reply to a message`
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Hidetag error:', error.message, 'Line:', error.stack?.split('\n')[1]);
        await sock.sendMessage(chatId, {
            text: `*${botName}*\nError: ${error.message}`
        }, { quoted: fake });
    }
}

module.exports = hideTagCommand;
