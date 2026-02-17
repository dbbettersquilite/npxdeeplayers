const isAdmin = require('../lib/isAdmin');
const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function resolveToPhone(sock, jid) {
    if (!jid) return 'unknown';
    const raw = jid.split('@')[0].split(':')[0];
    if (/^\d{7,15}$/.test(raw)) return raw;
    try {
        if (sock?.signalRepository?.lidMapping?.getPNForLID) {
            const formats = [jid, `${raw}:0@lid`, `${raw}@lid`];
            for (const fmt of formats) {
                try {
                    const pn = await sock.signalRepository.lidMapping.getPNForLID(fmt);
                    if (pn) {
                        const num = String(pn).split('@')[0].replace(/[^0-9]/g, '');
                        if (num.length >= 7 && num.length <= 15 && num !== raw) return num;
                    }
                } catch {}
            }
        }
        const groups = await sock.groupFetchAllParticipating();
        for (const gid of Object.keys(groups)) {
            for (const p of (groups[gid].participants || [])) {
                const pid = (p.id || '').split('@')[0].split(':')[0];
                const pLid = (p.lid || '').split('@')[0].split(':')[0];
                if ((pLid === raw || pid === raw) && pid && /^\d{7,15}$/.test(pid) && pid !== raw) return pid;
            }
        }
    } catch {}
    return raw;
}

async function tagAllCommand(sock, chatId, senderId, message) {
    const fake = createFakeContact(senderId);
    const botName = getBotName();
    
    try {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        
        if (!isSenderAdmin && !isBotAdmin && !message?.key?.fromMe && !db.isSudo(senderId)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAdmin only command!`
            }, { quoted: fake });
            return;
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;

        if (!participants || participants.length === 0) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nNo participants found!` 
            }, { quoted: fake });
            return;
        }

        let profilePictureUrl = null;
        try {
            profilePictureUrl = await sock.profilePictureUrl(chatId, 'image');
        } catch (error) {}

        let textContent = `*${botName} TAGALL*\n\n`;
        textContent += `Group: ${groupMetadata.subject}\n`;
        textContent += `Members: ${participants.length}\n\n`;

        for (let index = 0; index < participants.length; index++) {
            const participant = participants[index];
            const number = (index + 1).toString().padStart(2, '0');
            const resolved = await resolveToPhone(sock, participant.id);
            const displayName = participant.name || participant.notify || resolved;
            textContent += `${number}. @${resolved} (${displayName})\n`;
        }

        const mentions = participants.map(p => p.id);

        if (profilePictureUrl) {
            await sock.sendMessage(chatId, {
                image: { url: profilePictureUrl },
                caption: textContent,
                mentions: mentions
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, {
                text: textContent,
                mentions: mentions
            }, { quoted: fake });
        }

    } catch (error) {
        console.error('TagAll error:', error.message, 'Line:', error.stack?.split('\n')[1]);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nFailed to tag members.`
        }, { quoted: fake });
    }
}

module.exports = { tagAllCommand };
