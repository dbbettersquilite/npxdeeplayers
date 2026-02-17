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

async function staffCommand(sock, chatId, msg) {
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        
        let pp;
        try {
            pp = await sock.profilePictureUrl(chatId, 'image');
        } catch {
            pp = 'https://i.imgur.com/2wzGhpF.jpeg';
        }

        const participants = groupMetadata.participants;
        const groupAdmins = participants.filter(p => p.admin);

        const adminLines = [];
        for (let i = 0; i < groupAdmins.length; i++) {
            const resolved = await resolveToPhone(sock, groupAdmins[i].id);
            adminLines.push(`${i + 1}. @${resolved}`);
        }
        const listAdmin = adminLines.join('\n🔵 ');
        
        const owner = groupMetadata.owner || groupAdmins.find(p => p.admin === 'superadmin')?.id || chatId.split('-')[0] + '@s.whatsapp.net';
        
        const ownerParticipant = participants.find(p => p.id === owner);
        const ownerName = ownerParticipant?.name || ownerParticipant?.notify || owner.split('@')[0];

        const groupCreation = new Date(groupMetadata.creation * 1000).toLocaleDateString();
        const groupDesc = groupMetadata.desc || 'No description available';
        const totalParticipants = participants.length;
        const adminCount = groupAdmins.length;

        const resolvedOwner = await resolveToPhone(sock, owner);

        const text = `
ℹ️ *GROUP STAFF INFORMATION*

📛 *Group Name:* ${groupMetadata.subject}
👑 *Group Owner:* @${resolvedOwner}
🆔 *Group JID:* ${chatId}
📅 *Created:* ${groupCreation}
👥 *Total Members:* ${totalParticipants}
🛡️ *Admin Count:* ${adminCount}

📝 *Group Description:*
${groupDesc}

┌───────── ADMIN LIST ────────
🔵 ${listAdmin}


💡 *Note:* Mentioning all admins for easy contact.
`.trim();

        await sock.sendMessage(chatId, {
            image: { url: pp },
            caption: text,
            mentions: [...groupAdmins.map(v => v.id), owner]
        });

    } catch (error) {
        console.error('Error in staff command:', error);
        await sock.sendMessage(chatId, { 
            text: 'Failed to get admin list! Error: ' + error.message 
        });
    }
}

module.exports = staffCommand;
