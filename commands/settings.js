const { getOwnerConfig, getGroupConfig } = require('../Database/settingsStore');
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

async function settingsCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        
        if (!await isAuthorized(sock, message)) {
            await sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
            return;
        }

        const isGroup = chatId.endsWith('@g.us');

        const autoStatus = getOwnerConfig('autostatus') || { enabled: false };
        const autoread = getOwnerConfig('autoread') || { mode: 'off' };
        const autotyping = getOwnerConfig('autotyping') || { enabled: false };
        const autorecording = getOwnerConfig('autorecording') || { enabled: false };
        const pmblocker = getOwnerConfig('pmblocker') || { enabled: false };
        const anticall = getOwnerConfig('anticall') || { enabled: false };
        const antiedit = getOwnerConfig('antiedit') || { enabled: false };
        const antidelete = getOwnerConfig('antidelete') || { enabled: false };
        const autoReaction = getOwnerConfig('autoReaction') || { enabled: false };
        const prefix = getOwnerConfig('prefix') || '.';

        const lines = [];
        lines.push(`*${botName} SETTINGS*`);
        lines.push('');
        lines.push(`Prefix: ${prefix === 'none' ? 'None' : prefix}`);
        lines.push(`Auto Status: ${autoStatus.enabled ? 'ON' : 'OFF'}`);
        lines.push(`Autoread: ${autoread.mode !== 'off' ? autoread.mode.toUpperCase() : 'OFF'}`);
        lines.push(`Autotyping: ${autotyping.enabled ? 'ON' : 'OFF'}`);
        lines.push(`Autorecording: ${autorecording.enabled ? 'ON' : 'OFF'}`);
        lines.push(`PM Blocker: ${pmblocker.enabled ? 'ON' : 'OFF'}`);
        lines.push(`Anticall: ${anticall.enabled ? `ON (${anticall.mode || 'block'})` : 'OFF'}`);
        lines.push(`Antiedit: ${antiedit.enabled ? 'ON' : 'OFF'}`);
        lines.push(`Antidelete: ${antidelete.enabled ? `ON (${antidelete.mode || 'private'})` : 'OFF'}`);
        lines.push(`Auto Reaction: ${autoReaction.enabled ? 'ON' : 'OFF'}`);
        
        if (isGroup) {
            lines.push('');
            lines.push('*GROUP SETTINGS*');
            
            const antilink = getGroupConfig(chatId, 'antilink') || { enabled: false };
            const antibadword = getGroupConfig(chatId, 'antibadword') || { enabled: false };
            const welcome = getGroupConfig(chatId, 'welcome') || { enabled: false };
            const goodbye = getGroupConfig(chatId, 'goodbye') || { enabled: false };
            const chatbot = getGroupConfig(chatId, 'chatbot') || false;
            const antitag = getGroupConfig(chatId, 'antitag') || { enabled: false };
            const antimention = getGroupConfig(chatId, 'antimention') || { enabled: false };
            const antichart = getGroupConfig(chatId, 'antichart') || { enabled: false };
            const antikick = getGroupConfig(chatId, 'antikick') || { enabled: false };
            const groupAntiedit = getGroupConfig(chatId, 'antiedit') || { enabled: false };
            const groupAntidelete = getGroupConfig(chatId, 'antidelete') || { enabled: false };

            lines.push(`Antilink: ${antilink.enabled ? `ON (${antilink.action || 'delete'})` : 'OFF'}`);
            lines.push(`Antibadword: ${antibadword.enabled ? `ON (${antibadword.action || 'delete'})` : 'OFF'}`);
            lines.push(`Welcome: ${welcome.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Goodbye: ${goodbye.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Chatbot: ${chatbot ? 'ON' : 'OFF'}`);
            lines.push(`Antitag: ${antitag.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Antimention: ${antimention.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Antichart: ${antichart.enabled ? `ON (${antichart.action || 'delete'})` : 'OFF'}`);
            lines.push(`Antikick: ${antikick.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Antiedit (Group): ${groupAntiedit.enabled ? 'ON' : 'OFF'}`);
            lines.push(`Antidelete (Group): ${groupAntidelete.enabled ? 'ON' : 'OFF'}`);
        }

        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: fake });
    } catch (error) {
        console.error('Error in settings command:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = settingsCommand;
