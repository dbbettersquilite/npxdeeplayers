const { getGroupConfig, setGroupConfig } = require('../Database/settingsStore');
const db = require('../Database/database');
const isAdmin = require('../lib/isAdmin');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
const { getPrefix } = require('./setprefix');

function normalizeJid(jid) {
    if (!jid) return '';
    const str = typeof jid === 'string' ? jid : (jid.id || jid.toString());
    const num = str.split('@')[0].split(':')[0];
    return num + '@s.whatsapp.net';
}

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

async function handleAntidemote(sock, groupId, participants, author) {
    try {
        const config = getGroupConfig(groupId, 'antidemote');
        if (!config || !config.enabled) return false;

        const botName = getBotName();
        const fake = createFakeContact();
        const botJid = normalizeJid(sock.user?.id);

        let groupMetadata;
        try {
            groupMetadata = await sock.groupMetadata(groupId);
        } catch (metaErr) {
            console.error('Antidemote: Failed to fetch group metadata:', metaErr.message);
            return false;
        }

        const ownerJid = normalizeJid(groupMetadata.owner);
        const normalizedAuthor = normalizeJid(author);
        const isAuthorOwner = normalizedAuthor === ownerJid ||
                             (author && groupMetadata.owner && author === groupMetadata.owner);

        const isAuthorSudo = db.isSudo(author) || db.isSudo(normalizedAuthor);

        if (isAuthorOwner || isAuthorSudo) {
            return false;
        }

        // Bot's own actions should not trigger antidemote
        const authorNum = author?.split('@')[0]?.split(':')[0];
        const botNum = sock.user?.id?.split(':')[0]?.split('@')[0];
        const botLidNum = sock.user?.lid?.split(':')[0]?.split('@')[0];
        if (authorNum === botNum || (botLidNum && authorNum === botLidNum)) {
            return false;
        }

        const botParticipant = groupMetadata.participants.find(p =>
            normalizeJid(p.id) === botJid || p.id === botJid
        );
        const isBotAdmin = !botParticipant || (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');
        if (!isBotAdmin) {
            await sock.sendMessage(groupId, {
                text: `*${botName}*\nCannot reverse demotion - bot needs admin!`
            }, { quoted: fake });
            return false;
        }

        const participantJids = participants.map(p => typeof p === 'string' ? p : (p.id || String(p)));
        const mode = config.mode || 'revert';

        const botLid = sock.user?.lid;
        const botLidNorm = botLid ? normalizeJid(botLid) : null;
        const isBotDemoted = participantJids.some(p => {
            const norm = normalizeJid(p);
            if (norm === botJid) return true;
            if (botLidNorm && norm === botLidNorm) return true;
            const pNum = p.split('@')[0].split(':')[0];
            if (pNum === botNum) return true;
            if (botLidNum && pNum === botLidNum) return true;
            return false;
        });

        const authorNumber = await resolveToPhone(sock, author);
        const targetNumber = await resolveToPhone(sock, participantJids[0]);

        try {
            await sock.groupParticipantsUpdate(groupId, participantJids, "promote");
            console.log(`[ANTIDEMOTE] Reverted demotion of ${targetNumber} in ${groupId}`);
        } catch (promoteErr) {
            console.log('[ANTIDEMOTE] Promote call returned:', promoteErr.message, '(action may still have succeeded)');
        }

        if (isBotDemoted || mode === 'kick') {
            try {
                await sock.groupParticipantsUpdate(groupId, [author], "remove");
            } catch (e) {}
            const reason = isBotDemoted ? 'tried to demote the bot' : `tried to demote @${targetNumber}`;
            await sock.sendMessage(groupId, {
                text: `*${botName} ANTIDEMOTE*\n\n@${authorNumber} ${reason}\nDemotion reverted & offender kicked!`,
                mentions: [author, ...participantJids]
            }, { quoted: fake });
        } else if (mode === 'warn') {
            const maxWarnings = config.maxWarnings || 3;
            const warningCount = db.incrementWarning(groupId, author);
            if (warningCount >= maxWarnings) {
                try {
                    await sock.groupParticipantsUpdate(groupId, [author], "remove");
                } catch (e) {}
                db.resetWarning(groupId, author);
                await sock.sendMessage(groupId, {
                    text: `*${botName} ANTIDEMOTE*\n\n@${authorNumber} tried to demote @${targetNumber}\nDemotion reverted & offender kicked after ${maxWarnings} warnings!`,
                    mentions: [author, ...participantJids]
                }, { quoted: fake });
            } else {
                await sock.sendMessage(groupId, {
                    text: `*${botName} ANTIDEMOTE*\n\n@${authorNumber} tried to demote @${targetNumber}\nDemotion reverted! Warning ${warningCount}/${maxWarnings}`,
                    mentions: [author, ...participantJids]
                }, { quoted: fake });
            }
        } else {
            try {
                await sock.groupParticipantsUpdate(groupId, [author], "demote");
            } catch (e) {}
            await sock.sendMessage(groupId, {
                text: `*${botName} ANTIDEMOTE*\n\n@${authorNumber} tried to demote @${targetNumber}\nDemotion reverted & offender demoted!`,
                mentions: [author, ...participantJids]
            }, { quoted: fake });
        }

        return true;
    } catch (error) {
        console.error('Error in handleAntidemote:', error.message, 'Line:', error.stack?.split('\n')[1]);
        return false;
    }
}

async function antidemoteCommand(sock, chatId, message, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const prefix = getPrefix();

        const userMessage = message.message?.conversation || 
                          message.message?.extendedTextMessage?.text || '';
        const args = userMessage.split(' ');
        const subCmd = args[1]?.toLowerCase();

        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nGroup command only!`
            }, { quoted: fake });
            return;
        }

        const adminStatus = await isAdmin(sock, chatId, senderId);
        const isSenderAdmin = adminStatus.isSenderAdmin;
        const isBotAdmin = adminStatus.isBotAdmin;

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

        const config = getGroupConfig(chatId, 'antidemote') || { enabled: false, mode: 'revert' };

        if (!subCmd || subCmd === 'help') {
            await sock.sendMessage(chatId, {
                text: `*${botName} ANTIDEMOTE*\n\nStatus: ${config.enabled ? 'ON' : 'OFF'}\nMode: ${(config.mode || 'revert').toUpperCase()}\n\n*Commands:*\n${prefix}antidemote on - Enable\n${prefix}antidemote off - Disable\n${prefix}antidemote revert - Revert demotion only\n${prefix}antidemote warn - Revert & warn offender\n${prefix}antidemote kick - Revert & kick offender\n${prefix}antidemote setwarn <num> - Set max warnings\n${prefix}antidemote status - Check status\n\n*Modes:*\nREVERT - Undoes the demotion silently\nWARN - Reverts + warns (kicks after max warnings)\nKICK - Reverts + immediately kicks the offender`
            }, { quoted: fake });
            return;
        }

        if (subCmd === 'status') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAntidemote: ${config.enabled ? 'ACTIVE' : 'INACTIVE'}\nMode: ${(config.mode || 'revert').toUpperCase()}`
            }, { quoted: fake });
            return;
        }

        if (subCmd === 'setwarn') {
            const num = parseInt(args[2]);
            if (num > 0 && num <= 10) {
                setGroupConfig(chatId, 'antidemote', { ...config, maxWarnings: num });
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nMax warnings set to: ${num}`
                }, { quoted: fake });
            } else {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nInvalid number! Use 1-10`
                }, { quoted: fake });
            }
            return;
        }

        if (subCmd === 'on') {
            setGroupConfig(chatId, 'antidemote', { ...config, enabled: true });
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAntidemote ENABLED\nMode: ${(config.mode || 'revert').toUpperCase()}`
            }, { quoted: fake });
        } else if (subCmd === 'off') {
            setGroupConfig(chatId, 'antidemote', { ...config, enabled: false });
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAntidemote DISABLED`
            }, { quoted: fake });
        } else if (['revert', 'kick', 'warn'].includes(subCmd)) {
            setGroupConfig(chatId, 'antidemote', { ...config, enabled: true, mode: subCmd });
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nAntidemote mode: ${subCmd.toUpperCase()}\nFeature ENABLED`
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nInvalid option! Use: on, off, revert, kick, warn, status`
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Error in antidemoteCommand:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    handleAntidemote,
    antidemoteCommand
};
