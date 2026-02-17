const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function copilotCommand(sock, chatId, message) {
    const fake = createFakeContact(message);
    
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';
    
    const query = text.split(' ').slice(1).join(' ').trim();
    
    if (!query) {
        return sock.sendMessage(chatId, { 
            text: "Microsoft Copilot\nUse: .copilot [your question]\nExample: .copilot help me code a login system"
        }, { quoted: fake });
    }

    try {
        const apiUrl = `https://iamtkm.vercel.app/ai/copilot?apikey=tkm&text=${encodeURIComponent(query)}`;
        
        const response = await axios.get(apiUrl, { 
            timeout: 30000,
            headers: {
                'User-Agent': 'WhatsApp-Bot/1.0'
            }
        });
        
        const data = response.data;
        
        if (data.status && data.statusCode === 200 && data.result) {
            await sock.sendMessage(chatId, {
                text: data.result
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, {
                text: "No response from Copilot"
            }, { quoted: fake });
        }

    } catch (error) {
        console.error('Copilot Error:', error);
        
        if (error.response?.status === 429) {
            await sock.sendMessage(chatId, {
                text: "Too many requests. Wait 5 minutes."
            }, { quoted: fake });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            await sock.sendMessage(chatId, {
                text: "Request timeout"
            }, { quoted: fake });
        } else {
            await sock.sendMessage(chatId, {
                text: "Copilot service error"
            }, { quoted: fake });
        }
    }
}

module.exports = copilotCommand;