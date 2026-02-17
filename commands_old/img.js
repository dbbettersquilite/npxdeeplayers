const fetch = require("node-fetch");
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function imgCommand(sock, chatId, message) {
    const fake = createFakeContact(message);

    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';

    const query = text.split(' ').slice(1).join(' ').trim();

    if (!query) {
        return sock.sendMessage(chatId, { 
            text: "Example: .img cute cats\nProvide search query for images"
        }, { quoted: fake });
    }

    try {
        await sock.sendMessage(chatId, { 
            text: "Searching for images..."
        }, { quoted: fake });

        // Using a simple API for image search
        const apiUrl = `https://api.siputzx.my.id/api/search/google-image?q=${encodeURIComponent(query)}&apikey=FreeTrialKey`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!data || !data.status || !data.result || data.result.length === 0) {
            return sock.sendMessage(chatId, { 
                text: `❌ No images found for "${query}"`
            }, { quoted: fake });
        }

        // Take first 5 images
        const images = data.result.slice(0, 5);
        
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            try {
                // Send each image
                await sock.sendMessage(chatId, {
                    image: { url: img.url },
                    caption: `📸 Image ${i+1} - "${query}"`
                });
                
                // Small delay between images
                if (i < images.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (imgError) {
                console.error(`Failed to send image ${i+1}:`, imgError);
            }
        }

        await sock.sendMessage(chatId, { 
            text: `✅ Found ${images.length} images for "${query}"`
        });

    } catch (error) {
        console.error("Image Search Error:", error);
        await sock.sendMessage(chatId, { 
            text: `❌ Error: ${error.message || "Failed to search images"}`
        }, { quoted: fake });
    }
}

module.exports = imgCommand;