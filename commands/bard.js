const { createFakeContact, getBotName } = require('../lib/fakeContact');
const axios = require('axios');

async function bardCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const query = args.join(' ').trim();
    
    if (!query) {
        return sock.sendMessage(chatId, { text: `*${botName} BARD AI*\n\nUsage: .bard <question>\nExample: .bard explain quantum computing` }, { quoted: fakeContact });
    }
    
    await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
    
    try {
        const res = await axios.get(`https://bk9.fun/ai/gemini?q=${encodeURIComponent(query)}`, { timeout: 20000 });
        const result = res.data?.BK9 || res.data?.result;
        
        if (result) {
            await sock.sendMessage(chatId, { text: result.substring(0, 3000) }, { quoted: fakeContact });
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } else {
            await sock.sendMessage(chatId, { text: `*${botName}*\nNo response. Try again.` }, { quoted: fakeContact });
        }
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

module.exports = bardCommand;
