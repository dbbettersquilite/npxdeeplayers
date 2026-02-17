const axios = require('axios');
const yts = require('yt-search');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const KEITH_API = 'https://apiskeith.top';

const keithFallbackEndpoints = [
    `${KEITH_API}/download/ytmp3`,
    `${KEITH_API}/download/audio`,
    `${KEITH_API}/download/dlmp3`,
    `${KEITH_API}/download/mp3`,
    `${KEITH_API}/download/yta`,
    `${KEITH_API}/download/yta2`,
    `${KEITH_API}/download/yta3`
];

async function getKeithDownloadUrl(videoUrl) {
    for (const endpoint of keithFallbackEndpoints) {
        try {
            const response = await axios.get(
                `${endpoint}?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 15000 }
            );
            if (response.data?.status && response.data?.result) {
                const result = response.data.result;
                const url = typeof result === 'string' ? result :
                    result.download_url || result.dl_link || result.url || result.dl || result.link;
                if (url && typeof url === 'string' && url.startsWith('http')) return url;
            }
        } catch {
            continue;
        }
    }
    return null;
}

async function downloadAndValidate(downloadUrl) {
    const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 60000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        validateStatus: (status) => status >= 200 && status < 400
    });

    const buffer = Buffer.from(response.data);

    if (buffer.length < 1000) {
        throw new Error('File too small, likely not audio');
    }

    const headerStr = buffer.slice(0, 50).toString('utf8').toLowerCase();
    if (headerStr.includes('<!doctype') || headerStr.includes('<html') || headerStr.includes('bad gateway')) {
        throw new Error('Received HTML instead of audio');
    }

    return buffer;
}

async function songCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fakeContact = createFakeContact(senderId);
    const botName = getBotName();
    try {
        await sock.sendMessage(chatId, {
            react: { text: '...', key: message.key }
        });

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const parts = text.split(' ');
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: `*${botName} SONG*\n\nProvide a song name!\nExample: .song Not Like Us`
            }, { quoted: fakeContact });
        }

        if (query.length > 100) {
            return await sock.sendMessage(chatId, {
                text: `*${botName}*\nSong name too long! Max 100 chars.`
            }, { quoted: fakeContact });
        }

        const searchResults = await yts(`${query} official audio`);
        const video = searchResults?.videos?.[0];
        if (!video) {
            return sock.sendMessage(chatId, {
                text: `*${botName}*\nCouldn't find that song. Try another one!`
            }, { quoted: fakeContact });
        }

        const apis = [
            {
                name: 'Wolf API',
                url: `https://apis.xwolf.space/download/mp3?url=${encodeURIComponent(video.url)}`,
                parse: d => {
                    if (!d?.success) return null;
                    const streamUrl = d.streamUrl ? d.streamUrl.replace('http://', 'https://') : null;
                    const dlUrl = d.downloadUrl && d.downloadUrl !== 'In Processing...' && d.downloadUrl.startsWith('http') ? d.downloadUrl : null;
                    return streamUrl || dlUrl;
                },
                buffer: true
            },
            {
                name: 'Wolf Stream',
                url: `https://apis.xwolf.space/download/stream/mp3?url=${encodeURIComponent(video.url)}`,
                parse: null,
                buffer: true
            },
            {
                name: 'Keith',
                url: null,
                keithFallback: true
            },
            {
                name: 'BK9',
                url: `https://bk9.fun/download/youtube?url=${encodeURIComponent(video.url)}&type=audio`,
                parse: d => d?.BK9?.url || d?.BK9?.downloadUrl || d?.BK9
            },
            {
                name: 'Dreaded',
                url: `https://api.dreaded.site/api/ytdl/audio?url=${encodeURIComponent(video.url)}`,
                parse: d => d?.result?.download_url || d?.result?.url
            },
            {
                name: 'Siputzx',
                url: `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(video.url)}`,
                parse: d => d?.data?.dl || d?.result?.dl || d?.data?.url
            }
        ];

        let audioBuffer = null;
        let audioUrl = null;

        for (const api of apis) {
            try {
                if (api.keithFallback) {
                    const keithUrl = await getKeithDownloadUrl(video.url);
                    if (keithUrl) {
                        try {
                            audioBuffer = await downloadAndValidate(keithUrl);
                            break;
                        } catch {
                            audioUrl = keithUrl;
                            break;
                        }
                    }
                    continue;
                }

                const res = await axios.get(api.url, {
                    timeout: 20000,
                    responseType: api.buffer && !api.parse ? 'arraybuffer' : 'json'
                });

                if (api.buffer && !api.parse) {
                    const buf = Buffer.from(res.data);
                    if (buf.length > 1000) {
                        const headerStr = buf.slice(0, 50).toString('utf8').toLowerCase();
                        if (!headerStr.includes('<!doctype') && !headerStr.includes('<html')) {
                            audioBuffer = buf;
                            break;
                        }
                    }
                    continue;
                }

                if (api.parse) {
                    const parsed = api.parse(res.data);
                    if (parsed && typeof parsed === 'string' && parsed.startsWith('http')) {
                        if (api.buffer) {
                            try {
                                audioBuffer = await downloadAndValidate(parsed);
                                break;
                            } catch {}
                        }
                        audioUrl = parsed;
                        break;
                    }
                }
            } catch {}
        }

        if (!audioBuffer && !audioUrl) {
            return await sock.sendMessage(chatId, {
                text: `*${botName}*\nAll download APIs are currently unavailable. Please try again later.`
            }, { quoted: fakeContact });
        }

        const sendPayload = audioBuffer
            ? { audio: audioBuffer, mimetype: 'audio/mpeg', fileName: `${video.title}.mp3` }
            : { audio: { url: audioUrl }, mimetype: 'audio/mpeg', fileName: `${video.title}.mp3` };

        await sock.sendMessage(chatId, sendPayload, { quoted: fakeContact });

        await sock.sendMessage(chatId, {
            react: { text: '', key: message.key }
        });

    } catch (error) {
        console.error("Song command error:", error.message);
        return await sock.sendMessage(chatId, {
            text: `*${botName}*\nError: ${error.message}`
        }, { quoted: fakeContact });
    }
}

module.exports = songCommand;
