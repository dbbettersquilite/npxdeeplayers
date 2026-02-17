const isAdmin = require('../lib/isAdmin');
const store = require('../lib/lightweight_store');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function deleteCommand(sock, chatId, message, senderId) {
    try {
        const fake = createFakeContact(message);
        const isGroup = chatId.endsWith('@g.us');
        let isSenderAdmin = true;
        let isBotAdmin = true;

        if (isGroup) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'I need to be an admin to delete messages in groups.' }, { quoted: fake });
                return;
            }

            if (!isSenderAdmin) {
                await sock.sendMessage(chatId, { text: 'Only group admins can use the .delete command.' }, { quoted: fake });
                return;
            }
        } else {
            if (senderId !== chatId) {
                await sock.sendMessage(chatId, { text: 'Only the chat owner can use the .delete command in private chats.' }, { quoted: fake });
                return;
            }
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const parts = text.trim().split(/\s+/);
        let countArg = 1;
        if (parts.length > 1) {
            const maybeNum = parseInt(parts[1], 10);
            if (!isNaN(maybeNum) && maybeNum > 0) countArg = Math.min(maybeNum, 50);
        }

        const ctxInfo = message.message?.extendedTextMessage?.contextInfo || {};
        const mentioned = Array.isArray(ctxInfo.mentionedJid) && ctxInfo.mentionedJid.length > 0 ? ctxInfo.mentionedJid[0] : null;
        const repliedParticipant = ctxInfo.participant || null;
        const repliedMsgId = ctxInfo.stanzaId;

        let targetUser = null;
        
        if (repliedParticipant) {
            targetUser = repliedParticipant;
        } else if (mentioned) {
            targetUser = mentioned;
        } else {
            targetUser = isGroup ? null : chatId;
        }

        if (!targetUser) {
            await sock.sendMessage(chatId, { text: 'Please reply to a users message or mention a user to delete their recent messages.' }, { quoted: fake });
            return;
        }

        // If we have a replied message ID, try direct deletion first
        if (repliedMsgId) {
            try {
                await sock.sendMessage(chatId, {
                    delete: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: repliedMsgId,
                        participant: repliedParticipant
                    }
                });
                
                // Delete the command message too
                if (message.key?.id) {
                    await sock.sendMessage(chatId, {
                        delete: {
                            remoteJid: chatId,
                            fromMe: true,
                            id: message.key.id,
                            participant: senderId
                        }
                    });
                }
                
                // Silent success - no confirmation message
                return;
            } catch (directError) {
                console.log("Direct deletion failed, trying store method:", directError.message);
                // If direct deletion fails, fall through to store method
            }
        }

        // Fallback to store method
        const chatMessages = Array.isArray(store.messages[chatId]) ? store.messages[chatId] : [];
        const toDelete = [];
        const seenIds = new Set();

        // Add the command message itself to delete
        if (message.key?.id) {
            toDelete.push({
                key: {
                    id: message.key.id,
                    participant: senderId
                }
            });
            seenIds.add(message.key.id);
        }

        if (repliedMsgId) {
            const repliedInStore = chatMessages.find(m => 
                m.key.id === repliedMsgId && 
                (m.key.participant || m.key.remoteJid) === targetUser
            );
            if (repliedInStore && !seenIds.has(repliedInStore.key.id)) {
                toDelete.push(repliedInStore);
                seenIds.add(repliedInStore.key.id);
            }
        }

        for (let i = chatMessages.length - 1; i >= 0 && toDelete.length < countArg + 1; i--) {
            const m = chatMessages[i];
            const participant = m.key.participant || m.key.remoteJid;
            if (participant === targetUser && !seenIds.has(m.key.id)) {
                if (!m.message?.protocolMessage) {
                    toDelete.push(m);
                    seenIds.add(m.key.id);
                }
            }
        }

        if (toDelete.length <= 1) { // Only command message
            await sock.sendMessage(chatId, { text: 'Could not delete messages. They might be too old.' }, { quoted: fake });
            return;
        }

        for (const m of toDelete) {
            try {
                const msgParticipant = m.key.participant || targetUser;
                await sock.sendMessage(chatId, {
                    delete: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: m.key.id,
                        participant: msgParticipant
                    }
                });
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                // continue
            }
        }

        // No confirmation message

    } catch (err) {
        console.error("Delete command error:", err);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, { text: 'Failed to delete messages.' }, { quoted: fake });
    }
}

module.exports = deleteCommand;