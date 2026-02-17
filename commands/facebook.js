const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function downloadAndValidate(downloadUrl, timeout = 60000) {
    const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: timeout,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.facebook.com/'
        },
        validateStatus: (status) => status >= 200 && status < 400
    });

    const buffer = Buffer.from(response.data);

    if (buffer.length < 5000) {
        throw new Error('File too small, likely not video');
    }

    const headerStr = buffer.slice(0, 50).toString('utf8').toLowerCase();
    if (headerStr.includes('<!doctype') || headerStr.includes('<html') || headerStr.includes('bad gateway')) {
        throw new Error('Received HTML instead of video');
    }

    return buffer;
}

async function facebookCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();

    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const url = text.split(' ').slice(1).join(' ').trim();

        if (!url) {
            return await sock.sendMessage(chatId, { 
                text: `*${botName} FACEBOOK*\n\nProvide a Facebook video URL!\n\nUsage: .facebook <url>\nAliases: .fb`
            }, { quoted: fake });
        }

        const facebookPatterns = ['facebook.com', 'fb.watch', 'fb.com', 'fb.gg'];
        if (!facebookPatterns.some(p => url.includes(p))) {
            return await sock.sendMessage(chatId, { 
                text: `*${botName}*\nInvalid Facebook video URL!`
            }, { quoted: fake });
        }

        await sock.sendMessage(chatId, { react: { text: '...', key: message.key } });

        const apis = [
            {
                name: 'Keith',
                url: `https://apiskeith.top/download/facebook?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.result?.media?.hd || d?.result?.media?.sd || d?.result?.url || d?.result?.video,
                    title: d?.result?.title || 'Facebook Video'
                }),
                check: d => d?.status && d?.result
            },
            {
                name: 'BK9',
                url: `https://bk9.fun/download/facebook?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.BK9?.hd || d?.BK9?.sd || d?.BK9?.url || d?.BK9,
                    title: d?.BK9?.title || 'Facebook Video'
                }),
                check: d => d?.BK9
            },
            {
                name: 'Dreaded',
                url: `https://api.dreaded.site/api/facebook?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.result?.hd || d?.result?.sd || d?.result?.url || d?.result?.video,
                    title: d?.result?.title || 'Facebook Video'
                }),
                check: d => d?.result
            },
            {
                name: 'Siputzx',
                url: `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.data?.hd || d?.data?.sd || d?.data?.url || d?.data?.video,
                    title: d?.data?.title || 'Facebook Video'
                }),
                check: d => d?.data
            }
        ];

        let result = null;

        for (const api of apis) {
            try {
                const res = await axios.get(api.url, { timeout: 15000, headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }});
                if (api.check(res.data)) {
                    result = api.parse(res.data);
                    if (result?.video && typeof result.video === 'string' && result.video.startsWith('http')) {
                        break;
                    }
                    result = null;
                }
            } catch {}
        }

        if (!result?.video) {
            return await sock.sendMessage(chatId, { 
                text: `*${botName}*\nFailed to download. All APIs unavailable. Try again later.`
            }, { quoted: fake });
        }

        const title = (result.title || 'Facebook Video').substring(0, 100);

        try {
            await sock.sendMessage(chatId, {
                video: { url: result.video },
                mimetype: "video/mp4",
                caption: `*${botName}*\n${title}`
            }, { quoted: fake });
        } catch {
            try {
                const buffer = await downloadAndValidate(result.video);
                await sock.sendMessage(chatId, {
                    video: buffer,
                    mimetype: "video/mp4",
                    caption: `*${botName}*\n${title}`
                }, { quoted: fake });
            } catch (dlErr) {
                return await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nFailed to send video: ${dlErr.message}`
                }, { quoted: fake });
            }
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    } catch (error) {
        console.error('Facebook command error:', error.message);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nFailed to download video.`
        }, { quoted: fake });
    }
}

module.exports = facebookCommand;
