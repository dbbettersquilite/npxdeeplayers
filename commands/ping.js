const os = require('os');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const twoWordQuotes = [
  "Stay strong", "Never quit", "Dream big", "Keep going", "Work hard",
  "Be brave", "Think positive", "Stay focused", "Move forward", "Believe yourself",
  "Take action", "Stay humble", "Choose happiness", "Embrace change", "Trust process",
  "Create value", "Be kind", "Stay curious", "Find balance", "Make impact",
  "Stay motivated", "Push boundaries", "Seek growth", "Live fully", "Chase dreams",
  "Build legacy", "Stay authentic", "Inspire others", "Own it", "Hustle hard",
  "Stay positive", "Break barriers", "Rise up", "Stay hungry", "Think different",
  "Be fearless", "Stay committed", "Create magic", "Win together", "Stay resilient"
];

async function pingCommand(sock, chatId, message) {
  try {
    const senderId = message.key.participant || message.key.remoteJid;
    const fkontak = createFakeContact(senderId);

    const start = Date.now();
    const sentMsg = await sock.sendMessage(chatId, {
      text: 'Speed testing...'}, { quoted: fkontak }
    );

    const ping = Date.now() - start;

    const detailedPing = generatePrecisePing(ping);

    // Get random quote
    const randomQuote = twoWordQuotes[Math.floor(Math.random() * twoWordQuotes.length)];

    // Replaced the "I hate iddle people" line with the random quote
    const botName = getBotName();
    const response = `*${botName}*\nSpeed: ${detailedPing} ms\n${randomQuote}`;

    await sock.sendMessage(chatId, {
      text: response,
      edit: sentMsg.key,
      quoted: fkontak
    });   

  } catch (error) {
    console.error('Ping error:', error);
    const senderId = message.key.participant || message.key.remoteJid;
    const fkontak = createFakeContact(senderId);
    await sock.sendMessage(chatId, { text: 'Failed.', quoted: fkontak });
  }
}

function generatePrecisePing(ping) {
  const performance = global.performance || {};
  const microTime = typeof performance.now === 'function' ? performance.now() : ping;

  const microOffset = (microTime % 1).toFixed(6);
  const calculatedOffset = parseFloat(microOffset) * 0.999;

  const precisePing = (ping + calculatedOffset).toFixed(3);

  return precisePing;
}

module.exports = pingCommand;
