const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function spotifyCommand(sock, chatId, message) {
    const fkontak = createFakeContact(message);
    
    try {
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        const used = (rawText || '').split(/\s+/)[0] || '.spotify';
        const query = rawText.slice(used.length).trim();

        if (!query) {
            await sock.sendMessage(chatId, { 
                text: 'Usage: .spotify <search>' 
            }, { quoted: fkontak });
            return;
        }

        // Send initial reaction
        await sock.sendMessage(chatId, {
            react: { text: '🔍', key: message.key }
        });

        // Call API
        const apiUrl = `https://veron-apis.zone.id/downloader/spotify?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { 
            timeout: 15000,
            headers: { 
                'user-agent': 'Mozilla/5.0'
            } 
        });

        // Check if API call was successful
        if (!data?.success || !data?.result?.success || !data.result.metadata) {
            throw new Error('No results found');
        }

        const metadata = data.result.metadata;
        const downloadInfo = data.result.downloadInfo;

        // Build direct download URL
        const directDownloadUrl = `https://veron-apis.zone.id${downloadInfo.directDownload}`;

        // Build simple caption
        let caption = `${metadata.title}\n`;
        caption += `Artist: ${metadata.artist}\n`;
        caption += `Duration: ${metadata.duration}`;

        // Send thumbnail with caption if available
        if (metadata.cover) {
            await sock.sendMessage(chatId, { 
                image: { url: metadata.cover }, 
                caption 
            }, { quoted: fkontak });
        } else {
            await sock.sendMessage(chatId, { 
                text: caption 
            }, { quoted: fkontak });
        }

        // Update reaction
        await sock.sendMessage(chatId, {
            react: { text: '⬇️', key: message.key }
        });

        // Send audio file
        const safeTitle = metadata.title.replace(/[\\/:*?"<>|]/g, '');
        await sock.sendMessage(chatId, {
            audio: { url: directDownloadUrl },
            mimetype: 'audio/mpeg',
            fileName: `${safeTitle}.mp3`
        }, { quoted: fkontak });

        // Success reaction
        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

    } catch (error) {
        console.error('Spotify error:', error.message);

        let errorMsg = 'Failed to download audio.';
        if (error.message.includes('No results')) {
            errorMsg = 'No results found.';
        } else if (error.message.includes('timeout')) {
            errorMsg = 'Request timeout.';
        } else if (error.response?.status === 404) {
            errorMsg = 'Song not found.';
        }

        await sock.sendMessage(chatId, { 
            text: errorMsg
        }, { quoted: fkontak });
        
        await sock.sendMessage(chatId, {
            react: { text: '❌', key: message.key }
        });
    }
}

module.exports = spotifyCommand;