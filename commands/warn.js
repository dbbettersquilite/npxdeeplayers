const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function warnCommand(sock, chatId, senderId, mentionedJids, message) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nGroup command only!`
            }, { quoted: fake });
            return;
        }

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

        let userToWarn;

        if (mentionedJids && mentionedJids.length > 0) {
            userToWarn = mentionedJids[0];
        } else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
            userToWarn = message.message.extendedTextMessage.contextInfo.participant;
        }

        if (!userToWarn) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nMention or reply to a user to warn them.`
            }, { quoted: fake });
            return;
        }

        const targetAdmin = await isAdmin(sock, chatId, userToWarn);
        if (targetAdmin.isSenderAdmin) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nCannot warn an admin!`
            }, { quoted: fake });
            return;
        }

        const warnCount = db.incrementWarning(chatId, userToWarn);
        const maxWarnings = 3;
        const userTag = `@${userToWarn.split('@')[0]}`;

        if (warnCount >= maxWarnings) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n${userTag} has been kicked!\nReason: ${maxWarnings} warnings`,
                mentions: [userToWarn]
            }, { quoted: fake });
            
            try {
                await sock.groupParticipantsUpdate(chatId, [userToWarn], 'remove');
                db.resetWarning(chatId, userToWarn);
            } catch (kickError) {
                console.error('Kick error:', kickError.message, 'Line:', kickError.stack?.split('\n')[1]);
            }
        } else {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n${userTag} has been warned!\nWarnings: ${warnCount}/${maxWarnings}`,
                mentions: [userToWarn]
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in warn command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = warnCommand;
