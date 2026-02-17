const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function channelidCommand(sock, chatId, message) {
    const fake = createFakeContact(message);
    
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';
    
    const url = text.split(' ').slice(1).join(' ').trim();
    
    if (!url) {
        return sock.sendMessage(chatId, { 
            text: 'Example: .channelid https://whatsapp.com/channel/0029VbApvFQ2Jl84lhONkc3k'
        }, { quoted: fake });
    }

    if (!url.includes("https://whatsapp.com/channel/")) {
        return sock.sendMessage(chatId, { 
            text: 'Invalid WhatsApp channel link'
        }, { quoted: fake });
    }

    try {
        const channelCode = url.split('https://whatsapp.com/channel/')[1];
        
        // Try to get channel info using different methods
        let channelInfo;
        
        try {
            // Method 1: Using newsletterMetadata
            const metadata = await sock.newsletterMetadata("invite", channelCode);
            channelInfo = {
                id: metadata.id || 'N/A',
                name: metadata.name || 'Unknown',
                subscribers: metadata.subscribers || metadata.subscribersCount || 'N/A',
                state: metadata.state || 'N/A',
                verification: metadata.verification || 'UNVERIFIED'
            };
        } catch (error) {
            console.error('Newsletter metadata error:', error);
            
            // Method 2: Try to fetch channel info directly
            const channelId = `${channelCode}@newsletter`;
            channelInfo = {
                id: channelId,
                name: 'Could not fetch name',
                subscribers: 'N/A',
                state: 'N/A',
                verification: 'UNKNOWN'
            };
        }

        const info = `ID: ${channelInfo.id}\nName: ${channelInfo.name}\nFollowers: ${channelInfo.subscribers}\nStatus: ${channelInfo.state}\nVerified: ${channelInfo.verification === "VERIFIED" ? "Yes" : "No"}\n- DAVE X`;

        await sock.sendMessage(chatId, { 
            text: info
        }, { quoted: fake });

    } catch (error) {
        console.error('ChannelID Error:', error);
        await sock.sendMessage(chatId, { 
            text: 'Failed to get channel info'
        }, { quoted: fake });
    }
}

module.exports = channelidCommand;