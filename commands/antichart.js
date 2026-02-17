const { setAntichart, getAntichart, removeAntichart } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
const db = require('../Database/database');

async function antichartCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!isSenderAdmin && !db.isSudo(senderId)) {
            await sock.sendMessage(chatId, { text: `*${botName}*\nFor Group Admins Only` }, { quoted: fake });
            return;
        }

        const contextInfo = message.message?.extendedTextMessage?.contextInfo || {};
        const mentioned = contextInfo.mentionedJid || [];
        const quoted = contextInfo.participant;
        const quotedStanza = contextInfo.stanzaId;
        let targetUser = mentioned[0] || null;
        if (!targetUser && quoted) {
            targetUser = quoted;
        }
        if (!targetUser && quotedStanza && contextInfo.quotedMessage) {
            const quotedParticipant = contextInfo.participant;
            if (quotedParticipant) targetUser = quotedParticipant;
        }

        const args = userMessage.slice(10).toLowerCase().trim().split(' ');
        const action = args[0];

        if (!action) {
            const config = await getAntichart(chatId);
            const currentMode = config?.enabled ? config.action : 'off';
            const modeType = config?.blockedUsers?.length > 0 ? 'Targeted Mode' : 'Global Mode';
            const blockedCount = config?.blockedUsers?.length || 0;

            const usage = `*${botName} ANTI-CHART*\n\n` +
                `Current Status: ${currentMode.toUpperCase()}\n` +
                `Mode Type: ${modeType}\n` +
                `Blocked Users: ${blockedCount}\n\n` +
                `*Global Commands:*\n` +
                `.antichart delete\n` +
                `.antichart warn\n` +
                `.antichart kick\n` +
                `.antichart off\n\n` +
                `*Target User Commands:*\n` +
                `.antichart delete @user\n` +
                `.antichart warn @user\n` +
                `.antichart kick @user\n\n` +
                `*Manage Blocked Users:*\n` +
                `.antichart list\n` +
                `.antichart unblock @user`;

            await sock.sendMessage(chatId, { text: usage }, { quoted: fake });
            return;
        }

        if (action === 'list') {
            const config = await getAntichart(chatId);
            if (!config || !config.blockedUsers || config.blockedUsers.length === 0) {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nNo users are currently blocked by Anti-Chart.` 
                }, { quoted: fake });
                return;
            }

            let blockedList = `*${botName} BLOCKED USERS*\n\n`;
            config.blockedUsers.forEach((user, index) => {
                const username = user.split('@')[0];
                blockedList += `${index + 1}. @${username}\n`;
            });

            await sock.sendMessage(chatId, { 
                text: blockedList,
                mentions: config.blockedUsers
            }, { quoted: fake });
            return;
        }

        if (action === 'unblock') {
            if (!targetUser) {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nPlease mention a user to unblock.\nUsage: .antichart unblock @user` 
                }, { quoted: fake });
                return;
            }

            const config = await getAntichart(chatId);
            if (!config || !config.blockedUsers || !config.blockedUsers.includes(targetUser)) {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\n@${targetUser.split('@')[0]} is not blocked.`,
                    mentions: [targetUser]
                }, { quoted: fake });
                return;
            }

            config.blockedUsers = config.blockedUsers.filter(user => user !== targetUser);
            
            if (config.blockedUsers.length === 0 && config.action === 'off') {
                await removeAntichart(chatId);
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\n@${targetUser.split('@')[0]} unblocked.\nAnti-Chart disabled as no users remain blocked.`,
                    mentions: [targetUser]
                }, { quoted: fake });
            } else {
                await setAntichart(chatId, config.enabled, config.action, config.blockedUsers);
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\n@${targetUser.split('@')[0]} has been unblocked from Anti-Chart.`,
                    mentions: [targetUser]
                }, { quoted: fake });
            }
            return;
        }

        const validModes = ["off", "delete", "warn", "kick"];

        if (!validModes.includes(action)) {
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nInvalid mode. Use: delete, warn, kick, off, list, or unblock.` 
            }, { quoted: fake });
            return;
        }

        if (action === 'off') {
            await removeAntichart(chatId);
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nAnti-Chart DISABLED\nAll protections removed.` 
            }, { quoted: fake });
        } else {
            if (targetUser) {
                const config = await getAntichart(chatId) || { 
                    enabled: true, 
                    action: action, 
                    blockedUsers: [] 
                };

                if (!config.blockedUsers) config.blockedUsers = [];

                if (!config.blockedUsers.includes(targetUser)) {
                    config.blockedUsers.push(targetUser);
                }

                config.enabled = true;
                config.action = action;

                await setAntichart(chatId, config.enabled, config.action, config.blockedUsers);

                const actionMessages = {
                    'delete': 'All messages will be deleted',
                    'warn': 'Messages deleted + user will be warned',
                    'kick': 'Messages deleted + user will be kicked'
                };

                await sock.sendMessage(chatId, { 
                    text: `*${botName} TARGETED MODE*\n\nUser: @${targetUser.split('@')[0]}\nAction: ${action.toUpperCase()}\nStatus: Blocked\n\n${actionMessages[action]}`,
                    mentions: [targetUser]
                }, { quoted: fake });
            } else {
                await setAntichart(chatId, true, action, []);

                const actionMessages = {
                    'delete': 'All messages from non-admins will be deleted automatically',
                    'warn': 'Messages deleted + non-admins will be warned',
                    'kick': 'Messages deleted + non-admins will be kicked'
                };

                await sock.sendMessage(chatId, { 
                    text: `*${botName} GLOBAL MODE*\n\nAction: ${action.toUpperCase()}\nStatus: Active for all non-admins\n\n${actionMessages[action]}\n\nNote: Admins are exempt from Anti-Chart.` 
                }, { quoted: fake });
            }
        }
    } catch (error) {
        console.error('Error in antichart command:', error.message, 'Line:', error.stack?.split('\n')[1]);
        const botName = getBotName();
        const fake = createFakeContact(message?.key?.participant);
        await sock.sendMessage(chatId, { text: `*${botName}*\nError processing command` }, { quoted: fake });
    }
}

async function handleChartDetection(sock, chatId, message, senderId) {
    try {
        const config = await getAntichart(chatId);
        if (!config || !config.enabled || config.action === 'off') return;
        if (!chatId.endsWith('@g.us')) return;

        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isBotAdmin) return;
        if (db.isSudo(senderId)) return;

        const isBlockedUser = config.blockedUsers && config.blockedUsers.includes(senderId);
        
        let shouldAct = false;
        
        if (config.blockedUsers && config.blockedUsers.length > 0) {
            shouldAct = isBlockedUser;
        } else {
            shouldAct = !isSenderAdmin;
        }
        
        if (!shouldAct) return;

        const msg = message.message;
        if (!msg) return;

        const hasSticker = msg.stickerMessage;
        const hasImage = msg.imageMessage;
        const hasVideo = msg.videoMessage;
        const hasAudio = msg.audioMessage || msg.pttMessage;
        const hasDocument = msg.documentMessage;
        const hasText = msg.conversation || msg.extendedTextMessage?.text;
        const hasContact = msg.contactMessage;
        const hasLocation = msg.locationMessage;
        const hasPoll = msg.pollCreationMessage;
        const hasGif = msg.imageMessage?.gifPlayback;
        const hasButtons = msg.buttonsMessage;
        const hasTemplate = msg.templateMessage;
        const hasList = msg.listMessage;
        const hasReaction = msg.reactionMessage;

        const hasAnyMessage = hasSticker || hasImage || hasVideo || hasAudio || 
                            hasDocument || hasText || hasContact || hasLocation || 
                            hasPoll || hasGif || hasButtons || hasTemplate || 
                            hasList || hasReaction;

        if (!hasAnyMessage) return;

        const botName = getBotName();
        const kid = senderId;
        const userTag = `@${kid.split("@")[0]}`;

        try {
            await sock.sendMessage(chatId, {
                delete: {
                    remoteJid: chatId,
                    fromMe: false,
                    id: message.key.id,
                    participant: kid
                }
            });
        } catch (e) {
            console.error("[ANTI-CHART] Delete failed:", e.message, 'Line:', e.stack?.split('\n')[1]);
            return;
        }

        if (config.action === 'kick') {
            try {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n${userTag} has been removed from the group.`,
                    mentions: [kid]
                });
                await sock.groupParticipantsUpdate(chatId, [kid], 'remove');
            } catch (kickError) {
                console.error("[ANTI-CHART] Kick failed:", kickError.message, 'Line:', kickError.stack?.split('\n')[1]);
            }

        } else if (config.action === 'warn') {
            try {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\n\n${userTag}, messaging is prohibited in this group.`,
                    mentions: [kid]
                });
            } catch (warnError) {
                console.error("[ANTI-CHART] Warning failed:", warnError.message, 'Line:', warnError.stack?.split('\n')[1]);
            }
        }

    } catch (error) {
        console.error('Error in handleChartDetection:', error.message, 'Line:', error.stack?.split('\n')[1]);
    }
}

module.exports = {
    antichartCommand,
    handleChartDetection
};
