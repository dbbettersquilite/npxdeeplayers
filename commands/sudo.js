const settings = require('../settings');
const { isSudo, addSudo, removeSudo, getSudoList } = require('../lib/index');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

function extractMentionedJid(message) {
    try {
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) return mentioned[0];

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const match = text.match(/\b(\d{7,15})\b/);
        if (match) return `${match[1]}@s.whatsapp.net`;

        return null;
    } catch (err) {
        console.error('extractMentionedJid error:', err.message, 'Line:', err.stack?.split('\n')[1]);
        return null;
    }
}

async function sudoCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();

    try {
        const ownerJid = `${settings.ownerNumber}@s.whatsapp.net`;
        const isOwner = message.key.fromMe || senderId === ownerJid;

        const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = rawText.trim().split(/\s+/).slice(1);
        const sub = (args[0] || '').toLowerCase();

        if (!sub || !['add', 'del', 'remove', 'list'].includes(sub)) {
            await sock.sendMessage(chatId, {
                text: `*${botName} SUDO*\n\n.sudo add @user\n.sudo del @user\n.sudo list`
            }, { quoted: fake });
            return;
        }

        if (sub === 'list') {
            const list = getSudoList();
            if (!list || list.length === 0) {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nNo sudo users set.` 
                }, { quoted: fake });
                return;
            }

            const formatted = list.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n');
            await sock.sendMessage(chatId, {
                text: `*${botName} SUDO LIST*\n\n${formatted}`,
                mentions: list
            }, { quoted: fake });
            return;
        }

        if (!isOwner) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nOwner only command!` 
            }, { quoted: fake });
            return;
        }

        const targetJid = extractMentionedJid(message);
        if (!targetJid) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nMention a user or provide phone number!` 
            }, { quoted: fake });
            return;
        }

        if (sub === 'add') {
            if (isSudo(targetJid)) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n@${targetJid.split('@')[0]} is already sudo!`,
                    mentions: [targetJid]
                }, { quoted: fake });
                return;
            }

            addSudo(targetJid);
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n\n@${targetJid.split('@')[0]} added as sudo!`,
                mentions: [targetJid]
            }, { quoted: fake });
        } else if (sub === 'del' || sub === 'remove') {
            if (!isSudo(targetJid)) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n@${targetJid.split('@')[0]} is not sudo!`,
                    mentions: [targetJid]
                }, { quoted: fake });
                return;
            }

            removeSudo(targetJid);
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n\n@${targetJid.split('@')[0]} removed from sudo!`,
                mentions: [targetJid]
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Sudo command error:', error.message, 'Line:', error.stack?.split('\n')[1]);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nSudo command failed!` 
        }, { quoted: fake });
    }
}

module.exports = { sudoCommand };
