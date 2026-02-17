const { getBotName, createFakeContact } = require('../lib/fakeContact');

async function acceptCommand(sock, chatId, senderId, args, message, fake) {
    if (!args || !args.trim()) {
        await sock.sendMessage(chatId, {
            text: '*Usage:* .accept 254712345678\n\nProvide the phone number of the person whose join request you want to approve.'
        }, { quoted: fake });
        return;
    }

    try {
        const number = args.replace(/[^0-9]/g, '');
        const userJid = `${number}@s.whatsapp.net`;

        await sock.groupRequestParticipantsUpdate(chatId, [userJid], 'approve');
        await sock.sendMessage(chatId, {
            text: `Approved @${number}'s join request!`,
            mentions: [userJid]
        }, { quoted: fake });
    } catch (error) {
        if (error.message?.includes('not-found') || error.message?.includes('item-not-found')) {
            await sock.sendMessage(chatId, { text: 'No pending join request found for this number.' }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, { text: `Failed to accept request: ${error.message}` }, { quoted: fake });
        }
    }
}

async function rejectCommand(sock, chatId, senderId, args, message, fake) {
    if (!args || !args.trim()) {
        await sock.sendMessage(chatId, {
            text: '*Usage:* .reject 254712345678\n\nProvide the phone number of the person whose join request you want to decline.'
        }, { quoted: fake });
        return;
    }

    try {
        const number = args.replace(/[^0-9]/g, '');
        const userJid = `${number}@s.whatsapp.net`;

        await sock.groupRequestParticipantsUpdate(chatId, [userJid], 'reject');
        await sock.sendMessage(chatId, {
            text: `Rejected @${number}'s join request.`,
            mentions: [userJid]
        }, { quoted: fake });
    } catch (error) {
        if (error.message?.includes('not-found') || error.message?.includes('item-not-found')) {
            await sock.sendMessage(chatId, { text: 'No pending join request found for this number.' }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, { text: `Failed to reject request: ${error.message}` }, { quoted: fake });
        }
    }
}

async function acceptAllCommand(sock, chatId, senderId, message, fake) {
    try {
        const pendingRequests = await sock.groupRequestParticipantsList(chatId);

        if (!pendingRequests || pendingRequests.length === 0) {
            await sock.sendMessage(chatId, { text: 'No pending join requests found.' }, { quoted: fake });
            return;
        }

        const jids = pendingRequests.map(r => r.jid);
        await sock.groupRequestParticipantsUpdate(chatId, jids, 'approve');

        await sock.sendMessage(chatId, {
            text: `Approved all ${jids.length} pending join request(s)!`
        }, { quoted: fake });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `Failed to accept all requests: ${error.message}` }, { quoted: fake });
    }
}

async function rejectAllCommand(sock, chatId, senderId, message, fake) {
    try {
        const pendingRequests = await sock.groupRequestParticipantsList(chatId);

        if (!pendingRequests || pendingRequests.length === 0) {
            await sock.sendMessage(chatId, { text: 'No pending join requests found.' }, { quoted: fake });
            return;
        }

        const jids = pendingRequests.map(r => r.jid);
        await sock.groupRequestParticipantsUpdate(chatId, jids, 'reject');

        await sock.sendMessage(chatId, {
            text: `Rejected all ${jids.length} pending join request(s).`
        }, { quoted: fake });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `Failed to reject all requests: ${error.message}` }, { quoted: fake });
    }
}

async function listRequestsCommand(sock, chatId, senderId, message, fake) {
    try {
        const pendingRequests = await sock.groupRequestParticipantsList(chatId);

        if (!pendingRequests || pendingRequests.length === 0) {
            await sock.sendMessage(chatId, { text: 'No pending join requests.' }, { quoted: fake });
            return;
        }

        const requestList = pendingRequests.map((r, i) => {
            const number = r.jid.split('@')[0];
            return `${i + 1}. @${number}`;
        }).join('\n');

        const mentions = pendingRequests.map(r => r.jid);

        await sock.sendMessage(chatId, {
            text: `*PENDING JOIN REQUESTS*\n\nTotal: *${pendingRequests.length}* request(s)\n\n${requestList}\n\n_Use .accept <number> or .acceptall to approve_\n_Use .reject <number> or .rejectall to decline_`,
            mentions: mentions
        }, { quoted: fake });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `Failed to list requests: ${error.message}` }, { quoted: fake });
    }
}

module.exports = {
    acceptCommand,
    rejectCommand,
    acceptAllCommand,
    rejectAllCommand,
    listRequestsCommand,
};
