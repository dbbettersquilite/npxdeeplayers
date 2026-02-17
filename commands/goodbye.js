const { handleGoodbye } = require('../lib/welcome');
const { isGoodByeOn, getGoodbye } = require('../lib/index');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

function isLidJid(jid) {
    if (!jid) return false;
    if (jid.includes('@lid')) return true;
    const num = jid.split('@')[0].split(':')[0];
    if (num.length > 15) return true;
    if (!/^\d+$/.test(num)) return true;
    return false;
}

async function resolveNumber(sock, participantJid) {
    if (!participantJid) return participantJid;
    const raw = participantJid.split('@')[0].split(':')[0];
    if (!isLidJid(participantJid)) return raw;
    try {
        if (sock?.signalRepository?.lidMapping?.getPNForLID) {
            const formats = [participantJid, `${raw}:0@lid`, `${raw}@lid`];
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
                if ((pLid === raw || pid === raw) && pid && !pid.includes('lid') && pid.length >= 7 && pid.length <= 15 && /^\d+$/.test(pid)) {
                    return pid;
                }
            }
        }
    } catch {}
    return raw;
}

async function goodbyeCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);

    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: fake });
        return;
    }

    const text = message.message?.conversation ||
                message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');

    await handleGoodbye(sock, chatId, message, matchText);
}

async function handleLeaveEvent(sock, id, participants) {
    try {
        console.log(`[GOODBYE] Leave event triggered for group ${id} with ${participants.length} participant(s)`);
        const isGoodbyeEnabled = await isGoodByeOn(id);
        if (!isGoodbyeEnabled) {
            console.log(`[GOODBYE] Goodbye is disabled for group ${id}, skipping`);
            return;
        }

        const customMessage = await getGoodbye(id);
        const groupMetadata = await sock.groupMetadata(id);
        const groupName = groupMetadata.subject;
        const memberCount = groupMetadata.participants.length;
        const botName = getBotName();

        let ppgroup;
        try {
            ppgroup = await sock.profilePictureUrl(id, 'image');
        } catch {
            ppgroup = 'https://i.ibb.co/Z2Fyf4t/default-avatar.png';
        }

        for (const participant of participants) {
            try {
                const participantString = typeof participant === 'string' ? participant : (participant.id || participant.toString());
                const resolvedNumber = await resolveNumber(sock, participantString);

                const mentionJid = /^\d{7,15}$/.test(resolvedNumber) ? resolvedNumber + '@s.whatsapp.net' : participantString;

                let goodbyeText;
                if (customMessage) {
                    goodbyeText = customMessage
                        .replace(/{user}/g, `@${resolvedNumber}`)
                        .replace(/{group}/g, groupName)
                        .replace(/{bot}/g, botName)
                        .replace(/{members}/g, String(memberCount));
                } else {
                    goodbyeText = `Goodbye @${resolvedNumber}!\nFrom *${groupName}*\n\nWe'll miss you!`;
                }

                await sock.sendMessage(id, {
                    text: goodbyeText,
                    contextInfo: {
                        mentionedJid: [mentionJid],
                        externalAdReply: {
                            title: 'Goodbye! See you soon!',
                            body: botName,
                            thumbnailUrl: ppgroup,
                            sourceUrl: 'https://whatsapp.com/channel/0029VbApvFQ2Jl84lhONkc3k',
                            mediaType: 1,
                            renderLargerThumbnail: true
                        }
                    }
                });

                console.log(`[GOODBYE] Sent goodbye for ${resolvedNumber} in ${groupName}`);
            } catch (error) {
                console.error('Goodbye error:', error.message);
                const participantString = typeof participant === 'string' ? participant : (participant.id || participant.toString());
                let user;
                try { user = await resolveNumber(sock, participantString); } catch { user = participantString.split('@')[0]; }

                await sock.sendMessage(id, {
                    text: `Goodbye @${user} from ${groupName}!`,
                    mentions: [participantString]
                });
            }
        }
    } catch (err) {
        console.error('handleLeaveEvent error:', err.message);
    }
}

module.exports = { goodbyeCommand, handleLeaveEvent };
