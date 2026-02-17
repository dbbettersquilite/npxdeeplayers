const { createFakeContact, getBotName } = require('../lib/fakeContact');
const axios = require('axios');

async function blackboxCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const query = args.join(' ').trim();
    
    if (!query) {
        return sock.sendMessage(chatId, { text: `*${botName} BLACKBOX AI*\n\nUsage: .blackbox <question>\nExample: .blackbox write a python hello world` }, { quoted: fakeContact });
    }
    
    await sock.sendMessage(chatId, { react: { text: '⬛', key: message.key } });
    
    try {
        const res = await axios.get(`https://bk9.fun/ai/blackbox?q=${encodeURIComponent(query)}`, { timeout: 20000 });
        const result = res.data?.BK9 || res.data?.result || res.data?.response;
        
        if (result) {
            await sock.sendMessage(chatId, { text: result.substring(0, 3000) }, { quoted: fakeContact });
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } else {
            await sock.sendMessage(chatId, { text: `*${botName}*\nNo response received. Try again.` }, { quoted: fakeContact });
        }
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

module.exports = blackboxCommand;
