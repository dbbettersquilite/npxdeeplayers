const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const processedMessages = new Set();

async function downloadAndValidate(downloadUrl, timeout = 60000) {
    const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: timeout,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

async function tiktokCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fake = createFakeContact(senderId);
    const botName = getBotName();

    try {
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: `*${botName}*\nProvide a TikTok link!\n\nUsage: .tiktok <url>` 
            }, { quoted: fake });
        }

        const url = text.split(' ').slice(1).join(' ').trim();
        if (!url) {
            return await sock.sendMessage(chatId, { 
                text: `*${botName}*\nProvide a TikTok link!\n\nUsage: .tiktok <url>` 
            }, { quoted: fake });
        }

        const tiktokPatterns = [/tiktok\.com\//, /vm\.tiktok\.com\//, /vt\.tiktok\.com\//];
        if (!tiktokPatterns.some(p => p.test(url))) {
            return await sock.sendMessage(chatId, { text: `*${botName}*\nInvalid TikTok link!` }, { quoted: fake });
        }

        await sock.sendMessage(chatId, { react: { text: '...', key: message.key } });

        const apis = [
            {
                name: 'iamtkm',
                url: `https://iamtkm.vercel.app/downloaders/tiktokdl?apikey=tkm&url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.result?.no_watermark || d?.result?.watermark,
                    audio: d?.result?.audio,
                    title: d?.result?.title || 'TikTok Video'
                }),
                check: d => d?.status && d?.result
            },
            {
                name: 'Keith fbdown',
                url: `https://apiskeith.top/download/tiktok?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.result?.no_watermark || d?.result?.video || d?.result?.url,
                    audio: d?.result?.audio,
                    title: d?.result?.title || 'TikTok Video'
                }),
                check: d => d?.status && d?.result
            },
            {
                name: 'BK9',
                url: `https://bk9.fun/download/tiktok?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.BK9?.no_watermark || d?.BK9?.video || d?.BK9?.url || d?.BK9,
                    audio: d?.BK9?.audio,
                    title: d?.BK9?.title || 'TikTok Video'
                }),
                check: d => d?.BK9
            },
            {
                name: 'Dreaded',
                url: `https://api.dreaded.site/api/tiktok?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.result?.no_watermark || d?.result?.video || d?.result?.url,
                    audio: d?.result?.audio,
                    title: d?.result?.title || 'TikTok Video'
                }),
                check: d => d?.result
            },
            {
                name: 'Siputzx',
                url: `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
                parse: d => ({
                    video: d?.data?.no_watermark || d?.data?.video || d?.data?.url,
                    audio: d?.data?.audio,
                    title: d?.data?.title || 'TikTok Video'
                }),
                check: d => d?.data
            }
        ];

        let result = null;

        for (const api of apis) {
            try {
                const res = await axios.get(api.url, { timeout: 15000 });
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

        const title = (result.title || 'TikTok Video').substring(0, 100);

        try {
            await sock.sendMessage(chatId, {
                video: { url: result.video },
                mimetype: "video/mp4",
                caption: `*${botName}*\n${title}\n\nUse .tiktokaudio <url> for audio only`
            }, { quoted: fake });
        } catch {
            try {
                const buffer = await downloadAndValidate(result.video);
                await sock.sendMessage(chatId, {
                    video: buffer,
                    mimetype: "video/mp4",
                    caption: `*${botName}*\n${title}\n\nUse .tiktokaudio <url> for audio only`
                }, { quoted: fake });
            } catch (dlErr) {
                return await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nFailed to send video: ${dlErr.message}` 
                }, { quoted: fake });
            }
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    } catch (error) {
        console.error('TikTok command error:', error.message);
        await sock.sendMessage(chatId, { text: `*${botName}*\nFailed to download. Try again later.` }, { quoted: fake });
    }
}

module.exports = { tiktokCommand };
