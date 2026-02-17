const Obfuscator = require("javascript-obfuscator");
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const lastUsed = new Map();
const COOLDOWN_MS = 10000;

function extractQuotedText(message) {
    const contextInfo = 
        message.message?.extendedTextMessage?.contextInfo ||
        message.message?.imageMessage?.contextInfo ||
        message.message?.videoMessage?.contextInfo ||
        message.message?.documentMessage?.contextInfo ||
        message.message?.audioMessage?.contextInfo;

    if (!contextInfo?.quotedMessage) return null;

    const quoted = contextInfo.quotedMessage;

    return (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption ||
        null
    );
}

async function encryptCommand(sock, chatId, message) {
    const fake = createFakeContact(message);
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;

    const now = Date.now();
    if (lastUsed.has(senderId) && now - lastUsed.get(senderId) < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (now - lastUsed.get(senderId))) / 1000);
        return sock.sendMessage(chatId, { 
            text: `*${botName}*\nPlease wait ${wait}s before using this again.`
        }, { quoted: fake });
    }

    const rawText = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || '';
    const inlineCode = rawText.split(' ').slice(1).join(' ').trim();
    const quotedCode = extractQuotedText(message);
    const code = inlineCode || quotedCode;

    if (!code) {
        return sock.sendMessage(chatId, { 
            text: `*${botName} OBFUSCATE*\n\nUsage:\n.encrypt <javascript code>\n.encrypt (reply to code message)`
        }, { quoted: fake });
    }

    lastUsed.set(senderId, now);

    try {
        const obfuscationResult = Obfuscator.obfuscate(code, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 1,
            numbersToExpressions: true,
            simplify: true,
            stringArrayShuffle: true,
            splitStrings: true,
            stringArrayThreshold: 1
        });

        const encryptedCode = obfuscationResult.getObfuscatedCode();

        if (encryptedCode.length > 4000) {
            const buffer = Buffer.from(encryptedCode, 'utf-8');
            await sock.sendMessage(chatId, {
                document: buffer,
                fileName: 'obfuscated.js',
                mimetype: 'application/javascript',
                caption: `*${botName}*\nObfuscated code (${encryptedCode.length} chars)`
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, { 
                text: encryptedCode
            }, { quoted: fake });
        }

    } catch (error) {
        console.error("Encrypt Error:", error);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nFailed to obfuscate code.\nMake sure it is valid JavaScript.`
        }, { quoted: fake });
    }
}

module.exports = encryptCommand;
