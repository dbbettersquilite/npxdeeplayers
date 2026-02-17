const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function gpt4Command(sock, chatId, message) {
  const botName = getBotName();
  try {
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || 
                 message.text;

    if (!text) {
      const fake = createFakeContact(message);
      return sock.sendMessage(chatId, { text: `*${botName}*\nType your question after the command\nExample: .ai explain quantum physics` }, { quoted: fake });
    }

    const [command, ...rest] = text.split(' ');
    const query = rest.join(' ').trim();

    if (!query) {
      const fake = createFakeContact(message);
      return sock.sendMessage(chatId, { text: `*${botName}*\nMissing question\nExample: .ai what is AI?` }, { quoted: fake });
    }

    await sock.sendMessage(chatId, { react: { text: '>', key: message.key } });
    await handleAI(sock, chatId, message, query);

  } catch (err) {
    console.error('AI Command Error:', err);
    const fake = createFakeContact(message);
    await sock.sendMessage(chatId, { text: `*${botName}*\nAI service error` }, { quoted: fake });
  }
}

async function handleAI(sock, chatId, message, query) {
  const botName = getBotName();
  const fake = createFakeContact(message);
  
  const apis = [
    { url: `https://bk9.fun/ai/GPT4o?q=${encodeURIComponent(query)}`, parse: d => d.BK9 || d.result },
    { url: `https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(query)}`, parse: d => d.result },
    { url: `https://iamtkm.vercel.app/ai/gpt5?apikey=tkm&text=${encodeURIComponent(query)}`, parse: d => d.result },
  ];

  for (const api of apis) {
    try {
      const res = await axios.get(api.url, { timeout: 15000 });
      const result = api.parse(res.data);
      if (result && result.trim()) {
        await sock.sendMessage(chatId, { text: result.substring(0, 3000) }, { quoted: fake });
        await sock.sendMessage(chatId, { react: { text: '>', key: message.key } });
        return;
      }
    } catch {}
  }

  await sock.sendMessage(chatId, { text: `*${botName}*\nAI services are currently down. Try again later.` }, { quoted: fake });
}

module.exports = gpt4Command;
