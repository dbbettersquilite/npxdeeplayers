const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const GPT_API = {
    baseURL: "https://iamtkm.vercel.app",
    endpoint: "/ai/gpt5",
    apiKey: "tkm"
};

async function aiCommand(sock, chatId, message) {
    try {
        const fakeContact = createFakeContact(message);
        const text = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text;

        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "GPT-5 Assistant\n\nUse: !ai [your question]\nExample: !ai explain machine learning" 
            }, { quoted: fakeContact });
        }

        const parts = text.split(' ');
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, { 
                text: "Need a question after !ai\nExample: !ai what is quantum physics" 
            }, { quoted: fakeContact });
        }

        await sock.sendMessage(chatId, {
            react: { text: '⚡', key: message.key }
        });

        await processAIRequest(sock, chatId, message, query);

    } catch (error) {
        console.error('AI Command Error:', error);
        await sock.sendMessage(chatId, {
            text: "AI service down. Try again later."
        }, { quoted: fakeContact });
    }
}

async function processAIRequest(sock, chatId, message, query) {
    try {
        const fakeContact = createFakeContact(message);
        const apiUrl = `${GPT_API.baseURL}${GPT_API.endpoint}?apikey=${GPT_API.apiKey}&text=${encodeURIComponent(query)}`;
        
        const response = await axios.get(apiUrl, { 
            timeout: 30000,
            headers: {
                'User-Agent': 'WhatsApp-Bot/1.0',
                'Accept': 'application/json'
            }
        });
        
        const data = response.data;
        
        if (data.status && data.statusCode === 200 && data.result) {
            await sock.sendMessage(chatId, {
                text: data.result
            }, { quoted: fakeContact });
            
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: message.key }
            });
        } else {
            await sock.sendMessage(chatId, {
                text: "AI couldn't generate a response. Try a different question."
            }, { quoted: fakeContact });
        }

    } catch (error) {
        console.error('AI API Error:', error.message);
        
        if (error.response?.status === 429) {
            await sock.sendMessage(chatId, {
                text: "Rate limit. Wait 5 minutes."
            }, { quoted: fakeContact });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            await sock.sendMessage(chatId, {
                text: "Request timeout. Try shorter question."
            }, { quoted: fakeContact });
        } else {
            await sock.sendMessage(chatId, {
                text: "AI service error. Try later."
            }, { quoted: fakeContact });
        }

        await sock.sendMessage(chatId, {
            react: { text: '❌', key: message.key }
        });
    }
}

module.exports = aiCommand;