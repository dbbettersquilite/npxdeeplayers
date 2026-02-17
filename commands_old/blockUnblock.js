// Utility: delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function blockCommand(sock, chatId, message) {
    try {
        // Owner check
        if (!message.key.fromMe) {
            return sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!',
                quoted: message
            });
        }

        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        const mentionedJid = contextInfo?.participant;
        const quotedMessage = contextInfo?.quotedMessage;

        if (!quotedMessage && !mentionedJid) {
            return sock.sendMessage(chatId, { 
                text: '❌ Please reply to a user\'s message to block them!\n\nUsage: Reply to user\'s message with !block',
                quoted: message
            });
        }

        const userToBlock = mentionedJid;
        if (!userToBlock) {
            return sock.sendMessage(chatId, { 
                text: '❌ Could not identify user to block!',
                quoted: message
            });
        }

        // Prevent blocking the bot itself
        const botId = sock.user.id.split(':')[0];
        if (userToBlock.includes(botId)) {
            return sock.sendMessage(chatId, { 
                text: '❌ You cannot block the bot itself!',
                quoted: message
            });
        }

        await sock.updateBlockStatus(userToBlock, 'block');
        await sock.sendMessage(chatId, { 
            text: '✅ Successfully blocked user!',
            quoted: message
        });

        console.log(`✅ Blocked user: ${userToBlock}`);
    } catch (error) {
        console.error('Error in blockCommand:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to block user!',
            quoted: message
        }).catch(() => {});
    }
}

async function blocklistCommand(sock, chatId, message) {
    try {
        if (!message.key.fromMe) {
            return sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!',
                quoted: message
            });
        }

        const blockedContacts = await sock.fetchBlocklist().catch(() => []);
        if (!blockedContacts.length) {
            return sock.sendMessage(chatId, { 
                text: 'No blocked contacts found.',
                quoted: message
            });
        }

        const totalBlocked = blockedContacts.length;
        const listText = blockedContacts
            .map(jid => `• ${jid.split('@')[0]}`)
            .slice(0, 20)
            .join('\n');

        let responseText = `📋 Blocked: ${totalBlocked}\n\n${listText}`;
        if (totalBlocked > 20) {
            responseText += `\n\n... and ${totalBlocked - 20} more`;
        }

        await sock.sendMessage(chatId, { 
            text: responseText,
            quoted: message
        });
    } catch (error) {
        console.error('Error in blocklistCommand:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to fetch blocklist!',
            quoted: message
        }).catch(() => {});
    }
}

async function unblockallCommand(sock, chatId, message) {
    try {
        if (!message.key.fromMe) {
            return sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!',
                quoted: message
            });
        }

        const blockedContacts = await sock.fetchBlocklist().catch(() => []);
        if (!blockedContacts.length) {
            return sock.sendMessage(chatId, { 
                text: 'No blocked contacts to unblock.',
                quoted: message
            });
        }

        await sock.sendMessage(chatId, { 
            text: `🔄 Starting soft unblock of ${blockedContacts.length} contacts...`,
            quoted: message
        });

        let successCount = 0;
        for (const jid of blockedContacts) {
            try {
                await sock.updateBlockStatus(jid, 'unblock');
                successCount++;
                console.log(`✅ Soft-unblocked: ${jid}`);

                // Optional: send progress every 10 unblocks
                if (successCount % 10 === 0) {
                    await sock.sendMessage(chatId, { 
                        text: `🔄 Progress: ${successCount}/${blockedContacts.length} contacts unblocked...`,
                        quoted: message
                    });
                }

                // Soft pacing: wait 500ms between requests
                await delay(500);
            } catch {
                console.warn(`⚠️ Failed to unblock: ${jid}`);
            }
        }

        await sock.sendMessage(chatId, { 
            text: `✅ Finished soft unblock. Total unblocked: ${successCount}/${blockedContacts.length}`,
            quoted: message
        });

        console.log(`✅ Soft unblock complete: ${successCount}/${blockedContacts.length}`);
    } catch (error) {
        console.error('Error in unblockallCommand:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to unblock contacts!',
            quoted: message
        }).catch(() => {});
    }
}

module.exports = {
    blockCommand,
    blocklistCommand,
    unblockallCommand
};
