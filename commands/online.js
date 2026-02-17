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

async function onlineCommand(sock, chatId, senderId, message) {
    const fake = createFakeContact(message);
    const botName = getBotName();

    try {
        await sock.sendMessage(chatId, { text: 'Checking online members... Please wait...' }, { quoted: fake });

        const groupMeta = await sock.groupMetadata(chatId);
        const participants = groupMeta.participants;

        const presenceData = new Map();

        const presenceHandler = (update) => {
            if (update.presences) {
                for (const [jid, presence] of Object.entries(update.presences)) {
                    presenceData.set(jid, presence);
                    const numOnly = jid.split('@')[0];
                    presenceData.set(numOnly, presence);
                }
            }
        };

        sock.ev.on('presence.update', presenceHandler);

        try {
            const batchSize = 5;
            for (let i = 0; i < participants.length; i += batchSize) {
                const batch = participants.slice(i, i + batchSize);
                await Promise.all(
                    batch.map(async (p) => {
                        try {
                            await sock.presenceSubscribe(p.id);
                        } catch (e) {}
                    })
                );
                await new Promise(r => setTimeout(r, 500));
            }

            await new Promise(r => setTimeout(r, 2000));

            const onlineMembers = [];

            for (const p of participants) {
                const participantId = p.id;
                const numOnly = participantId.split('@')[0];

                let presence = presenceData.get(participantId) || presenceData.get(numOnly);

                if (presence?.lastKnownPresence === 'available' ||
                    presence?.lastKnownPresence === 'composing' ||
                    presence?.lastKnownPresence === 'recording') {
                    const number = await resolveToPhone(sock, participantId);
                    onlineMembers.push({ jid: participantId, number });
                }
            }

            sock.ev.off('presence.update', presenceHandler);

            if (onlineMembers.length === 0) {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nNo members detected as currently online.\n\n_Note: This only detects members with "online" visibility enabled._`
                }, { quoted: fake });
                return;
            }

            const mentions = onlineMembers.map(m => m.jid);
            const memberList = onlineMembers
                .map((m, i) => `${i + 1}. @${m.number}`)
                .join('\n');

            await sock.sendMessage(chatId, {
                text: `*${botName} ONLINE MEMBERS*\n\n*${onlineMembers.length}* of *${participants.length}* members online\n\n${memberList}`,
                mentions: mentions
            }, { quoted: fake });

        } catch (innerErr) {
            sock.ev.off('presence.update', presenceHandler);
            throw innerErr;
        }
    } catch (error) {
        console.error('Online command error:', error);
        await sock.sendMessage(chatId, { text: `Failed to check online members: ${error.message}` });
    }
}

module.exports = onlineCommand;
