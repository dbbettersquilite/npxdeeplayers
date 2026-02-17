const { createFakeContact, getBotName } = require('../lib/fakeContact');
const axios = require('axios');

async function wolfCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const query = args.join(' ').trim();
    
    if (!query) {
        return sock.sendMessage(chatId, { text: `*${botName} WOLF AI*\n\nUsage: .wolf <question>\nExample: .wolf what is the meaning of life` }, { quoted: fakeContact });
    }
    
    await sock.sendMessage(chatId, { react: { text: '🐺', key: message.key } });
    
    try {
        const apis = [
            { url: `https://bk9.fun/ai/gemini?q=${encodeURIComponent(query)}`, parse: d => d.BK9 || d.result },
            { url: `https://iamtkm.vercel.app/ai/gpt5?apikey=tkm&text=${encodeURIComponent(query)}`, parse: d => d.result },
            { url: `https://apis.xwolf.space/api/ai/gemini`, method: 'POST', body: { prompt: query }, parse: d => d.result || d.response }
        ];
        
        for (const api of apis) {
            try {
                let res;
                if (api.method === 'POST') {
                    res = await axios.post(api.url, api.body, { timeout: 15000 });
                } else {
                    res = await axios.get(api.url, { timeout: 15000 });
                }
                const result = api.parse(res.data);
                if (result && result.trim()) {
                    await sock.sendMessage(chatId, { text: result.substring(0, 2000) }, { quoted: fakeContact });
                    await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                    return;
                }
            } catch {}
        }
        await sock.sendMessage(chatId, { text: `*${botName}*\nAll AI services are currently down. Try again later.` }, { quoted: fakeContact });
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

module.exports = wolfCommand;
