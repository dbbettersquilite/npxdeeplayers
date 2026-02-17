const { createFakeContact, getBotName } = require('../lib/fakeContact');
const axios = require('axios');

async function ipLookupCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const ip = args[0]?.trim();
    
    if (!ip) {
        return sock.sendMessage(chatId, { text: `*${botName} IP LOOKUP*\n\nUsage: .iplookup <ip_address>\nExample: .iplookup 8.8.8.8` }, { quoted: fakeContact });
    }
    
    await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });
    
    try {
        const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 10000 });
        const d = res.data;
        if (d.status === 'success') {
            const text = `*${botName} IP LOOKUP*\n\n*IP:* ${d.query}\n*Country:* ${d.country}\n*Region:* ${d.regionName}\n*City:* ${d.city}\n*ZIP:* ${d.zip}\n*ISP:* ${d.isp}\n*Org:* ${d.org}\n*Timezone:* ${d.timezone}\n*Lat:* ${d.lat}\n*Lon:* ${d.lon}`;
            await sock.sendMessage(chatId, { text }, { quoted: fakeContact });
        } else {
            await sock.sendMessage(chatId, { text: `*${botName}*\nInvalid IP or lookup failed.` }, { quoted: fakeContact });
        }
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

async function whoIsCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const domain = args[0]?.trim();
    
    if (!domain) {
        return sock.sendMessage(chatId, { text: `*${botName} WHOIS*\n\nUsage: .whois <domain>\nExample: .whois google.com` }, { quoted: fakeContact });
    }
    
    await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });
    
    try {
        const res = await axios.get(`https://bk9.fun/tools/whois?q=${encodeURIComponent(domain)}`, { timeout: 15000 });
        const result = res.data?.BK9 || res.data?.result;
        if (result) {
            const text = typeof result === 'object' ? `*${botName} WHOIS: ${domain}*\n\n${JSON.stringify(result, null, 2).substring(0, 2000)}` : `*${botName} WHOIS: ${domain}*\n\n${String(result).substring(0, 2000)}`;
            await sock.sendMessage(chatId, { text }, { quoted: fakeContact });
        } else {
            await sock.sendMessage(chatId, { text: `*${botName}*\nNo WHOIS data found for ${domain}` }, { quoted: fakeContact });
        }
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

async function reverseipCommand(sock, chatId, message, args) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const ip = args[0]?.trim();
    
    if (!ip) {
        return sock.sendMessage(chatId, { text: `*${botName} REVERSE IP*\n\nUsage: .reverseip <ip>\nExample: .reverseip 8.8.8.8` }, { quoted: fakeContact });
    }
    
    try {
        const res = await axios.get(`https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`, { timeout: 15000 });
        if (res.data) {
            await sock.sendMessage(chatId, { text: `*${botName} REVERSE IP: ${ip}*\n\n${String(res.data).substring(0, 2000)}` }, { quoted: fakeContact });
        }
    } catch (err) {
        await sock.sendMessage(chatId, { text: `*${botName}*\nError: ${err.message}` }, { quoted: fakeContact });
    }
}

module.exports = { ipLookupCommand, whoIsCommand, reverseipCommand };
