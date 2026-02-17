const { addWelcome, delWelcome, isWelcomeOn, addGoodbye, delGoodBye, isGoodByeOn } = require('./index');
const { createFakeContact, getBotName } = require('./fakeContact');

async function handleWelcome(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();
    
    if (!match) {
        return sock.sendMessage(chatId, {
            text: `*${botName} WELCOME MESSAGE*\n\n` +
                  `.welcome on - Enable welcome messages\n` +
                  `.welcome set <message> - Set custom message\n` +
                  `.welcome off - Disable welcome messages\n\n` +
                  `*Available Variables:*\n` +
                  `{user} - Mentions the new member\n` +
                  `{group} - Shows group name\n` +
                  `{description} - Shows group description\n` +
                  `{bot} - Shows bot name`,
        }, { quoted: fake });
    }

    const [command, ...args] = match.split(' ');
    const lowerCommand = command.toLowerCase();
    const customMessage = args.join(' ');

    if (lowerCommand === 'on') {
        if (await isWelcomeOn(chatId)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nWelcome messages are already enabled.` }, { quoted: fake });
        }
        await addWelcome(chatId, true, `Welcome {user} to {group}!`);
        return sock.sendMessage(chatId, { text: `*${botName}*\nWelcome messages enabled!\nUse .welcome set <message> to customize.` }, { quoted: fake });
    }

    if (lowerCommand === 'off') {
        if (!(await isWelcomeOn(chatId))) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nWelcome messages are already disabled.` }, { quoted: fake });
        }
        await delWelcome(chatId);
        return sock.sendMessage(chatId, { text: `*${botName}*\nWelcome messages disabled for this group.` }, { quoted: fake });
    }

    if (lowerCommand === 'set') {
        if (!customMessage) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nPlease provide a custom welcome message.\nExample: .welcome set Welcome to the group {user}!` }, { quoted: fake });
        }
        await addWelcome(chatId, true, customMessage);
        return sock.sendMessage(chatId, { text: `*${botName}*\nCustom WELCOME message set!\n\nThis will be sent when someone JOINS the group.\n\nPreview:\n${customMessage}` }, { quoted: fake });
    }

    return sock.sendMessage(chatId, {
        text: `*${botName}*\nInvalid command.\nUse: .welcome on, .welcome set <message>, .welcome off`,
    }, { quoted: fake });
}

async function handleGoodbye(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();
    const lower = match?.toLowerCase();

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `*${botName} GOODBYE MESSAGE*\n\n` +
                  `.goodbye on - Enable goodbye messages\n` +
                  `.goodbye set <message> - Set custom message\n` +
                  `.goodbye off - Disable goodbye messages\n\n` +
                  `*Available Variables:*\n` +
                  `{user} - Mentions the leaving member\n` +
                  `{group} - Shows group name\n` +
                  `{bot} - Shows bot name`,
        }, { quoted: fake });
    }

    if (lower === 'on') {
        if (await isGoodByeOn(chatId)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nGoodbye messages are already enabled.` }, { quoted: fake });
        }
        await addGoodbye(chatId, true, `Goodbye {user}!`);
        return sock.sendMessage(chatId, { text: `*${botName}*\nGoodbye messages enabled!\nUse .goodbye set <message> to customize.` }, { quoted: fake });
    }

    if (lower === 'off') {
        if (!(await isGoodByeOn(chatId))) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nGoodbye messages are already disabled.` }, { quoted: fake });
        }
        await delGoodBye(chatId);
        return sock.sendMessage(chatId, { text: `*${botName}*\nGoodbye messages disabled for this group.` }, { quoted: fake });
    }

    if (lower.startsWith('set ')) {
        const customMessage = match.substring(4);
        if (!customMessage) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nPlease provide a custom goodbye message.\nExample: .goodbye set Goodbye {user}!` }, { quoted: fake });
        }
        await addGoodbye(chatId, true, customMessage);
        return sock.sendMessage(chatId, { text: `*${botName}*\nCustom GOODBYE message set!\n\nThis will be sent when someone LEAVES the group.\n\nPreview:\n${customMessage}` }, { quoted: fake });
    }

    return sock.sendMessage(chatId, {
        text: `*${botName}*\nInvalid command.\nUse: .goodbye on, .goodbye set <message>, .goodbye off`,
    }, { quoted: fake });
}

module.exports = { handleWelcome, handleGoodbye };
