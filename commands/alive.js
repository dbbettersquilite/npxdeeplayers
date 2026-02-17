const fs = require('fs');
const path = require('path');
const settings = require("../settings");
const os = require("os");
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const detectPlatform = () => {
  if (process.env.DYNO) return "Heroku";
  if (process.env.RENDER) return "Render";
  if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "Termux";
  if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return "CypherX Platform";
  if (process.env.P_SERVER_UUID) return "Panel";
  if (process.env.LXC) return "Linux Container (LXC)";
  
  switch (os.platform()) {
    case "win32": return "Windows";
    case "darwin": return "macOS";
    case "linux": return "Linux";
    default: return "Unknown";
  }
};

function formatUptime(uptime) {
  const seconds = Math.floor(uptime / 1000);
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs > 1 ? 's' : ''}`);

  return parts.join(', ');
}

const botStartTime = Date.now();
async function aliveCommand(sock, chatId, message) {
  try {
    const uptime = Date.now() - botStartTime;
    const formattedUptime = formatUptime(uptime);
    const hostName = detectPlatform();

    const fake = createFakeContact(message);

    const messageText = `*DaveX Bot Status*\n\n` +
                       `Platform: ${hostName}\n` +
                       `Uptime: ${formattedUptime}\n` +
                       `Prefix: ${settings.prefix}\n` +
                       `Mode: ${global.public ? 'Public' : 'Private'}\n\n` +
                       `DaveX v3.0.1\n` +
                       `🤫 Quiet - New Year Mode`;

    await sock.sendMessage(chatId, { text: messageText }, { quoted: fake });

  } catch (error) {
    console.error('Error in alive command:', error);
  }
}

module.exports = aliveCommand;