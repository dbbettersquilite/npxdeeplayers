const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function getppCommand(sock, chatId, message) {
    try {
        const fake = createFakeContact(message);
        const botName = getBotName();
        
        // Check if user is owner
        const isOwner = message.key.fromMe;
        if (!isOwner) {
            const authMsgs = [
                `*${botName}*\nOwner only command.`,
                `*${botName}*\nSorry, only the boss can use this.`,
                `*${botName}*\nPrivileges required.`
            ];
            await sock.sendMessage(chatId, { 
                text: authMsgs[Math.floor(Math.random() * authMsgs.length)]
            }, { quoted: fake });
            return;
        }

        let userToAnalyze;
        
        // Check for mentioned users
        if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            userToAnalyze = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        // Check for replied message
        else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
            userToAnalyze = message.message.extendedTextMessage.contextInfo.participant;
        }
        
        if (!userToAnalyze) {
            const usageMsgs = [
                `*${botName}*\nMention someone or reply to their message.`,
                `*${botName}*\nWho's pp? Tag or reply to them.`,
                `*${botName}*\nPlease specify a user.`
            ];
            await sock.sendMessage(chatId, { 
                text: usageMsgs[Math.floor(Math.random() * usageMsgs.length)]
            }, { quoted: fake });

            await sock.sendMessage(chatId, {
                react: { text: '🗑️', key: message.key }
            });
            return;
        }

        try {
            // Get user's profile picture
            let profilePic;
            try {
                profilePic = await sock.profilePictureUrl(userToAnalyze, 'image');
            } catch {
                profilePic = 'https://files.catbox.moe/lvcwnf.jpg'; // Default image
            }

            const username = userToAnalyze.split('@')[0];
            
            const captionMsgs = [
                `@${username}'s profile picture:`,
                `PP for @${username}:`,
                `Here's @${username}:`
            ];

            // Send the profile picture to the chat
            await sock.sendMessage(chatId, {
                image: { url: profilePic },
                caption: captionMsgs[Math.floor(Math.random() * captionMsgs.length)],
                mentions: [userToAnalyze]
            }, { quoted: fake });

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: message.key }
            });

        } catch (error) {
            console.error('Error in getpp command:', error);
            
            const errorMsgs = [
                `*${botName}*\nCouldn't fetch that profile.`,
                `*${botName}*\nNo profile picture found.`,
                `*${botName}*\nUser might not have a pp set.`
            ];
            
            await sock.sendMessage(chatId, {
                text: errorMsgs[Math.floor(Math.random() * errorMsgs.length)]
            }, { quoted: fake });
        }
    } catch (error) {
        console.error('Unexpected error in getppCommand:', error);
        const fake = createFakeContact(message);
        const botName = getBotName();
        
        const fatalMsgs = [
            `*${botName}*\nSomething went wrong.`,
            `*${botName}*\nUnexpected error.`,
            `*${botName}*\nCommand failed.`
        ];
        
        await sock.sendMessage(chatId, {
            text: fatalMsgs[Math.floor(Math.random() * fatalMsgs.length)]
        }, { quoted: fake });
    }
}

module.exports = getppCommand;