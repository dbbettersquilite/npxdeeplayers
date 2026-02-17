const axios = require('axios');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const LYRICS_API = {
    baseURL: "https://iamtkm.vercel.app",
    endpoint: "/search/lyrics",
    apiKey: "tkm"
};

async function lyricsCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text;

        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "Lyrics Search\n\nUse: !lyrics [song name]\nExample: !lyrics shape of you" 
            });
        }

        const parts = text.split(' ');
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, { 
                text: "Need song name after !lyrics\nExample: !lyrics gift" 
            });
        }

        const loadingMsg = await sock.sendMessage(chatId, { 
            text: `Searching lyrics for: "${query}"` 
        });

        const results = await searchLyrics(query);
        
        if (!results || results.length === 0) {
            await sock.sendMessage(chatId, { 
                text: `No lyrics found for: ${query}` 
            });
            return;
        }

        if (results.length === 1) {
            const lyrics = await getLyricsText(results[0].songLyricsUrl);
            await sock.sendMessage(chatId, { 
                text: formatLyrics(results[0], lyrics) 
            });
        } else {
            await sock.sendMessage(chatId, { 
                text: formatResultsList(results, query) 
            });
        }

    } catch (error) {
        console.error('Lyrics error:', error);
        await sock.sendMessage(chatId, {
            text: "Lyrics service error. Try again."
        });
    }
}

async function searchLyrics(query) {
    try {
        const url = `${LYRICS_API.baseURL}${LYRICS_API.endpoint}?apikey=${LYRICS_API.apiKey}&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        
        if (response.data.status && response.data.data) {
            return response.data.data;
        }
        return [];
    } catch (error) {
        console.error('Search error:', error.message);
        return [];
    }
}

async function getLyricsText(lyricsUrl) {
    try {
        const response = await axios.get(lyricsUrl);
        return response.data.lyrics || response.data.result || "Lyrics not available";
    } catch (error) {
        console.error('Fetch lyrics error:', error.message);
        return "Could not fetch lyrics";
    }
}

function formatResultsList(results, query) {
    let message = `🎵 *Multiple Results Found*\n\nSearch: "${query}"\n\n`;
    
    results.slice(0, 10).forEach((song, index) => {
        message += `${index + 1}. ${song.songTitle}\n   👤 ${song.artist.replace('·', '').trim()}\n\n`;
    });
    
    message += `\nReply with number to get lyrics (1-${Math.min(results.length, 10)})`;
    return message;
}

function formatLyrics(song, lyrics) {
    return `🎵 *${song.songTitle}*\n` +
           `👤 *Artist:* ${song.artist.replace('·', '').trim()}\n\n` +
           lyrics.substring(0, 3000);
}

module.exports = { lyricsCommand };