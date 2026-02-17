const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function unmuteCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

    if (!isBotAdmin) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nBot needs admin!` }, { quoted: fake });
        return { success: false, message: 'Bot not admin' };
    }

    if (!isSenderAdmin && !message?.key?.fromMe && !db.isSudo(senderId)) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nAdmin only command!` }, { quoted: fake });
        return { success: false, message: 'Not authorized' };
    }
    
    try {
        await sock.groupSettingUpdate(chatId, 'not_announcement');

        const metadata = await sock.groupMetadata(chatId);
        const groupName = metadata?.subject || 'Group';

        await sock.sendMessage(chatId, { 
            text: `*${botName}*\n\n${groupName} has been unmuted.`
        }, { quoted: fake });

        return { success: true, message: `${groupName} unmuted` };

    } catch (error) {
        console.error('Unmute error:', error.message, 'Line:', error.stack?.split('\n')[1]);

        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nFailed to unmute.`
        }, { quoted: fake });

        return { success: false, message: 'Failed', error };
    }
}

module.exports = unmuteCommand;
