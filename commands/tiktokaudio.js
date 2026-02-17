const fetch = require("node-fetch");
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function tiktokaudioCommand(sock, chatId, message) {
    const fake = createFakeContact(message);

    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';

    const query = text.split(' ').slice(1).join(' ').trim();

    if (!query) {
        return sock.sendMessage(chatId, { 
            text: "Example: .tiktokaudio https://vm.tiktok.com/abc123\nProvide TikTok link for audio"
        }, { quoted: fake });
    }

    if (!query.includes("tiktok.com")) {
        return sock.sendMessage(chatId, { 
            text: "That is not a valid TikTok link!"
        }, { quoted: fake });
    }

    try {
        await sock.sendMessage(chatId, { 
            text: "Downloading TikTok audio..."
        }, { quoted: fake });

        // FIXED: Using a working API service
        const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(query)}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();

        // Check for audio in the new API response format
        if (!data || !data.audio || !data.audio.url) {
            throw new Error("No audio found in the API response");
        }

        const tikAudioUrl = data.audio.url;

        const audioResponse = await fetch(tikAudioUrl);
        
        if (!audioResponse.ok) {
            throw new Error(`Failed to download audio file: ${audioResponse.status}`);
        }
        
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: "audio/mp4",  // TikTok audio is usually MP4 format
            ptt: false,
            caption: "🎵 TikTok Audio - Downloaded by DAVE-X BOT"
        }, { quoted: fake });

    } catch (error) {
        console.error("TikTok Audio Error:", error);
        await sock.sendMessage(chatId, { 
            text: `❌ Error: ${error.message || "Failed to download TikTok audio"}\n\nTry using a different TikTok link format.`
        }, { quoted: fake });
    }
}

module.exports = tiktokaudioCommand;