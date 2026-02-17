const { getGroupConfig, setGroupConfig, parseToggleCommand, parseActionCommand } = require('../Database/settingsStore');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const DEFAULT_BAD_WORDS = [
    'gandu', 'madarchod', 'bhosdike', 'bsdk', 'fucker', 'bhosda', 
    'lauda', 'laude', 'betichod', 'chutiya', 'behenchod', 
    'randi', 'chuchi', 'boobs', 'idiot', 'nigga', 'fuck', 
    'dick', 'bitch', 'bastard', 'asshole', 'lund', 'mc', 'lodu',
    'shit', 'damn', 'piss', 'crap', 'slut', 'whore', 'prick',
    'motherfucker', 'cock', 'cunt', 'pussy', 'twat', 'wanker',
    'chut', 'harami', 'kameena', 'haramzada'
];

async function handleAntiBadwordCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const botName = getBotName();
    
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participant = groupMetadata.participants.find(p => p.id === senderId);
        if (!participant?.admin && !message.key.fromMe && !db.isSudo(senderId)) {
            const fake = createFakeContact(senderId);
            return sock.sendMessage(chatId, { 
                text: `*${botName}*\nAdmin only command!` 
            }, { quoted: fake });
        }
    } catch {}

    const fake = createFakeContact(senderId);
    const config = getGroupConfig(chatId, 'antibadword');

    if (!match) {
        const words = config.words?.length > 0 ? config.words : DEFAULT_BAD_WORDS;
        const helpText = `*${botName} ANTIBADWORD*\n\n` +
                        `Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                        `Action: ${config.action || 'delete'}\n` +
                        `Max Warnings: ${config.maxWarnings || 3}\n` +
                        `Custom Words: ${config.words?.length || 0}\n\n` +
                        `*Commands:*\n` +
                        `.antibadword on - Enable\n` +
                        `.antibadword off - Disable\n` +
                        `.antibadword delete - Delete messages\n` +
                        `.antibadword kick - Kick user\n` +
                        `.antibadword warn - Warn user\n` +
                        `.antibadword add <word1,word2> - Add words\n` +
                        `.antibadword remove <word> - Remove word\n` +
                        `.antibadword list - Show word list\n` +
                        `.antibadword setwarn <num> - Set max warnings\n` +
                        `.antibadword reset - Reset to default words`;
        
        await sock.sendMessage(chatId, { text: helpText }, { quoted: fake });
        return;
    }

    let newConfig = { ...config };
    let responseText = '';
    const sub = match.toLowerCase().trim();

    if (sub === 'status') {
        responseText = `*${botName} ANTIBADWORD STATUS*\n\n` +
                      `Status: ${config.enabled ? 'ACTIVE' : 'INACTIVE'}\n` +
                      `Action: ${config.action || 'delete'}\n` +
                      `Max Warnings: ${config.maxWarnings || 3}\n` +
                      `Custom Words: ${config.words?.length || 0}`;
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    if (sub === 'list') {
        const words = config.words?.length > 0 ? config.words : DEFAULT_BAD_WORDS;
        responseText = `*${botName} BADWORD LIST*\n\n` +
                      `Total: ${words.length} words\n\n` +
                      words.slice(0, 50).join(', ') + 
                      (words.length > 50 ? `\n...and ${words.length - 50} more` : '');
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    if (sub.startsWith('add ')) {
        const wordsToAdd = sub.replace('add ', '').split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 1);
        if (wordsToAdd.length > 0) {
            const currentWords = config.words?.length > 0 ? [...config.words] : [...DEFAULT_BAD_WORDS];
            const addedWords = [];
            for (const word of wordsToAdd) {
                if (!currentWords.includes(word)) {
                    currentWords.push(word);
                    addedWords.push(word);
                }
            }
            newConfig.words = currentWords;
            setGroupConfig(chatId, 'antibadword', newConfig);
            responseText = `*${botName}*\nAdded ${addedWords.length} words: ${addedWords.join(', ')}`;
        } else {
            responseText = `*${botName}*\nProvide words to add!`;
        }
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    if (sub.startsWith('remove ')) {
        const wordToRemove = sub.replace('remove ', '').trim().toLowerCase();
        const currentWords = config.words?.length > 0 ? [...config.words] : [...DEFAULT_BAD_WORDS];
        const index = currentWords.indexOf(wordToRemove);
        if (index > -1) {
            currentWords.splice(index, 1);
            newConfig.words = currentWords;
            setGroupConfig(chatId, 'antibadword', newConfig);
            responseText = `*${botName}*\nRemoved: ${wordToRemove}`;
        } else {
            responseText = `*${botName}*\nWord not found in list!`;
        }
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    if (sub.startsWith('setwarn ')) {
        const num = parseInt(sub.replace('setwarn ', '').trim());
        if (num > 0 && num <= 10) {
            newConfig.maxWarnings = num;
            setGroupConfig(chatId, 'antibadword', newConfig);
            responseText = `*${botName}*\nMax warnings set to: ${num}`;
        } else {
            responseText = `*${botName}*\nInvalid number! Use 1-10`;
        }
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    if (sub === 'reset') {
        newConfig.words = [...DEFAULT_BAD_WORDS];
        setGroupConfig(chatId, 'antibadword', newConfig);
        responseText = `*${botName}*\nReset to default ${DEFAULT_BAD_WORDS.length} words`;
        await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
        return;
    }

    const toggle = parseToggleCommand(sub);
    if (toggle === 'on') {
        newConfig.enabled = true;
        responseText = `*${botName}*\nAntiBadword ENABLED\nAction: ${newConfig.action || 'delete'}`;
    } else if (toggle === 'off') {
        newConfig.enabled = false;
        responseText = `*${botName}*\nAntiBadword DISABLED`;
    } else {
        const action = parseActionCommand(sub);
        if (action === 'delete') {
            newConfig.action = 'delete';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAction: DELETE\nBad word messages will be deleted.`;
        } else if (action === 'kick') {
            newConfig.action = 'kick';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAction: KICK\nUsers will be removed for bad words.`;
        } else if (action === 'warn') {
            newConfig.action = 'warn';
            newConfig.enabled = true;
            responseText = `*${botName}*\nAction: WARN\nUsers get ${newConfig.maxWarnings || 3} warnings before kick.`;
        } else {
            responseText = `*${botName}*\nInvalid command!\nUse: on, off, delete, kick, warn, add, remove, list`;
        }
    }

    if (responseText && !responseText.includes('Invalid')) {
        setGroupConfig(chatId, 'antibadword', newConfig);
    }

    await sock.sendMessage(chatId, { text: responseText }, { quoted: fake });
}

function normalizeJid(jid) {
    if (!jid) return '';
    const num = jid.split('@')[0].split(':')[0];
    return num + '@s.whatsapp.net';
}

async function handleBadwordDetection(sock, chatId, message, userMessage, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) return;
        if (message.key.fromMe) return;
        
        const config = getGroupConfig(chatId, 'antibadword');
        if (!config?.enabled) return;

        const groupMetadata = await sock.groupMetadata(chatId);
        const botId = normalizeJid(sock.user.id);
        const normalizedSender = normalizeJid(senderId);
        const bot = groupMetadata.participants.find(p => normalizeJid(p.id) === botId);
        if (!bot?.admin) return;

        const participant = groupMetadata.participants.find(p => normalizeJid(p.id) === normalizedSender);
        if (participant?.admin) return;
        if (db.isSudo(senderId) || db.isSudo(normalizedSender)) return;

        const cleanMessage = userMessage.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const badWords = config.words?.length > 0 ? config.words : DEFAULT_BAD_WORDS;
        const messageWords = cleanMessage.split(' ');
        let containsBadWord = false;
        let detectedWord = '';

        for (const word of messageWords) {
            if (word.length < 2) continue;
            if (badWords.includes(word)) {
                containsBadWord = true;
                detectedWord = word;
                break;
            }
        }

        for (const badWord of badWords) {
            if (badWord.includes(' ') && cleanMessage.includes(badWord)) {
                containsBadWord = true;
                detectedWord = badWord;
                break;
            }
        }

        if (!containsBadWord) return;

        const botName = getBotName();
        const fake = createFakeContact(senderId);

        try {
            await sock.sendMessage(chatId, { delete: message.key });
        } catch (err) {
            console.error('Error deleting message:', err.message);
            return;
        }

        const action = config.action || 'delete';
        const senderNumber = senderId.split('@')[0];
        const maxWarnings = config.maxWarnings || 3;

        switch (action) {
            case 'delete':
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n@${senderNumber}, bad words not allowed!\nMessage deleted.`,
                    mentions: [senderId]
                }, { quoted: fake });
                break;

            case 'kick':
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `*${botName}*\n@${senderNumber} kicked for bad words!`,
                        mentions: [senderId]
                    }, { quoted: fake });
                } catch (error) {
                    console.error('Error kicking user:', error.message);
                }
                break;

            case 'warn':
                const warningCount = db.incrementWarning(chatId, senderId);
                if (warningCount >= maxWarnings) {
                    try {
                        await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                        db.resetWarning(chatId, senderId);
                        await sock.sendMessage(chatId, {
                            text: `*${botName}*\n@${senderNumber} kicked after ${maxWarnings} warnings!`,
                            mentions: [senderId]
                        }, { quoted: fake });
                    } catch (error) {
                        console.error('Error kicking user after warnings:', error.message);
                    }
                } else {
                    await sock.sendMessage(chatId, {
                        text: `*${botName}*\n@${senderNumber} warning ${warningCount}/${maxWarnings}!\nBad words not allowed.`,
                        mentions: [senderId]
                    }, { quoted: fake });
                }
                break;
        }
    } catch (err) {
        console.error('Error in handleBadwordDetection:', err.message, 'Line:', err.stack?.split('\n')[1]);
    }
}

async function antibadwordCommand(sock, chatId, message, args) {
    try {
        await handleAntiBadwordCommand(sock, chatId, message, args || '');
    } catch (error) {
        console.error('Error in antibadword command:', error.message, 'Line:', error.stack?.split('\n')[1]);
        const botName = getBotName();
        await sock.sendMessage(chatId, { text: `*${botName}*\nError processing command!` });
    }
}

module.exports = {
    handleAntiBadwordCommand,
    handleBadwordDetection,
    antibadwordCommand
};
