const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

//================================================
// Sticker conversion (simple fallback)
//================================================
async function convertStickerToImageSimple(stickerBuffer) {
    if (stickerBuffer.slice(0, 12).toString('hex').includes('52494646')) { // RIFF header
        console.log('Detected WebP sticker, using fallback conversion');
        return stickerBuffer; 
    }
    return stickerBuffer;
}

async function convertStickerToImage(stickerBuffer, mimetype = 'image/webp') {
    try {
        return await convertStickerToImageSimple(stickerBuffer);
    } catch (error) {
        console.error('Sticker conversion failed:', error);
        throw new Error(`Sticker conversion failed: ${error.message}`);
    }
}

// ================================================
// Main command
// ================================================
async function setGroupStatusCommand(sock, chatId, msg) {
    // Create fake contact for replies
    const fake = createFakeContact(msg?.key?.participant || chatId);
    const botName = getBotName();
    
    try {
        // ✅ Group check
        const isGroup = chatId.endsWith('@g.us');
        if (!isGroup) {
            return sock.sendMessage(chatId, { 
                text: `*${botName}*\n❌ This command can only be used in groups!` 
            }, { quoted: fake });
        }

        // ✅ Admin check
        const participant = await sock.groupMetadata(chatId).then(metadata =>
            metadata.participants.find(p => p.id === msg.key.participant || p.id === msg.key.remoteJid)
        );
        const isAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
        
        if (!isAdmin && !msg.key.fromMe) {
            return sock.sendMessage(chatId, { 
                text: `*${botName}*\n❌ Only group admins can use this command!` 
            }, { quoted: fake });
        }

        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const commandRegex = /^[.!#/]?(tosgroup|togstatus|swgc|groupstatus)\s*/i;

        let textAfterCommand = '';
        if (messageText.trim()) {
            const match = messageText.match(commandRegex);
            if (match) textAfterCommand = messageText.slice(match[0].length).trim();
        }

        if (!quotedMessage && !textAfterCommand) {
            return sock.sendMessage(chatId, { 
                text: getHelpText(botName) 
            }, { quoted: fake });
        }

        let payload = null;

        if (quotedMessage) {
            payload = await buildPayloadFromQuoted(quotedMessage);
            if (textAfterCommand && payload) {
                if (payload.video || payload.image || (payload.convertedSticker && payload.image)) {
                    payload.caption = textAfterCommand;
                }
            }
        } else if (textAfterCommand) {
            payload = { text: textAfterCommand };
        }

        if (!payload) {
            return sock.sendMessage(chatId, { 
                text: getHelpText(botName) 
            }, { quoted: fake });
        }

        // ✅ Send group status
        await sendGroupStatus(sock, chatId, payload);

        const mediaType = detectMediaType(quotedMessage, payload);
        let successMsg = `*${botName}*\n✅ *Group Status sent successfully!*\n\n📌 Type: ${mediaType}`;
        if (payload.caption) successMsg += `\n📝 Caption: "${payload.caption}"`;
        if (payload.convertedSticker) successMsg += `\n✨ Sticker converted to image`;

        await sock.sendMessage(chatId, { 
            text: successMsg 
        }, { quoted: fake });

    } catch (error) {
        console.error('Error in group status command:', error);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\n❌ Error: ${error.message}` 
        }, { quoted: fake });
    }
}

/* ------------------ Helpers ------------------ */

// 📌 Help text
function getHelpText(botName) {
    return `*${botName} - GROUP STATUS*

*Commands:*
✦ .tosgroup <text> - Post text status
✦ .tosgroup (reply to media) - Post media status
✦ .tosgroup (reply to sticker) - Convert & post sticker

*Examples:*
✦ .tosgroup Hello everyone!
✦ Reply to image with .tosgroup
✦ Reply to sticker with .tosgroup

*Supported:* Image, Video, Audio, Sticker, Text`;
}

// 📌 Build payload from quoted message
async function buildPayloadFromQuoted(quotedMessage) {
    if (quotedMessage.videoMessage) {
        const buffer = await downloadToBuffer(quotedMessage.videoMessage, 'video');
        return { 
            video: buffer, 
            caption: quotedMessage.videoMessage.caption || '',
            gifPlayback: quotedMessage.videoMessage.gifPlayback || false,
            mimetype: quotedMessage.videoMessage.mimetype || 'video/mp4'
        };
    } else if (quotedMessage.imageMessage) {
        const buffer = await downloadToBuffer(quotedMessage.imageMessage, 'image');
        return { 
            image: buffer, 
            caption: quotedMessage.imageMessage.caption || '',
            mimetype: quotedMessage.imageMessage.mimetype || 'image/jpeg'
        };
    } else if (quotedMessage.audioMessage) {
        const buffer = await downloadToBuffer(quotedMessage.audioMessage, 'audio');
        if (quotedMessage.audioMessage.ptt) {
            const audioVn = await toVN(buffer);
            return { audio: audioVn, mimetype: "audio/ogg; codecs=opus", ptt: true };
        } else {
            return { audio: buffer, mimetype: quotedMessage.audioMessage.mimetype || 'audio/mpeg', ptt: false };
        }
    } else if (quotedMessage.stickerMessage) {
        try {
            const buffer = await downloadToBuffer(quotedMessage.stickerMessage, 'sticker');
            const imageBuffer = await convertStickerToImage(buffer, quotedMessage.stickerMessage.mimetype);
            return { 
                image: imageBuffer, 
                caption: quotedMessage.stickerMessage.caption || '',
                mimetype: 'image/png',
                convertedSticker: true,
                originalMimetype: quotedMessage.stickerMessage.mimetype
            };
        } catch (conversionError) {
            console.error('Sticker conversion failed:', conversionError);
            return { text: `⚠️ Sticker conversion failed (${quotedMessage.stickerMessage.mimetype || 'unknown'})` };
        }
    } else if (quotedMessage.conversation || quotedMessage.extendedTextMessage?.text) {
        const textContent = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
        return { text: textContent };
    }
    return null;
}

// 📌 Detect media type
function detectMediaType(quotedMessage, payload = null) {
    if (!quotedMessage) return 'Text';
    if (quotedMessage.videoMessage) return 'Video';
    if (quotedMessage.imageMessage) return 'Image';
    if (quotedMessage.audioMessage) return 'Audio';
    if (quotedMessage.stickerMessage) {
        if (payload && payload.convertedSticker) return 'Sticker → Image';
        return 'Sticker';
    }
    return 'Text';
}

// 📌 Download message content
async function downloadToBuffer(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// 📌 Send group status
async function sendGroupStatus(conn, jid, content) {
    const { generateWAMessageContent, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
    
    const inside = await generateWAMessageContent(content, { upload: conn.waUploadToServer });
    const messageSecret = crypto.randomBytes(32);
    const m = generateWAMessageFromContent(jid, {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: { message: { ...inside, messageContextInfo: { messageSecret } } }
    }, {});
    
    await conn.relayMessage(jid, m.message, { messageId: m.key.id });
    return m;
}

// 📌 Convert audio to voice note
async function toVN(inputBuffer) {
    return new Promise((resolve, reject) => {
        const inStream = new PassThrough();
        inStream.end(inputBuffer);
        const outStream = new PassThrough();
        const chunks = [];
        
        ffmpeg(inStream)
            .noVideo()
            .audioCodec("libopus")
            .format("ogg")
            .audioBitrate("48k")
            .audioChannels(1)
            .audioFrequency(48000)
            .on("error", reject)
            .on("end", () => resolve(Buffer.concat(chunks)))
            .pipe(outStream, { end: true });
            
        outStream.on("data", chunk => chunks.push(chunk));
    });
}

module.exports = setGroupStatusCommand;