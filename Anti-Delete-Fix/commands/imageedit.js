const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function nightCommand(sock, chatId, message, text) {
    try {
        const fake = createFakeContact(message);
        
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image with .night command'
            }, { quoted: fake });
            return;
        }

        const imageMessage = quoted.imageMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image file (JPEG/PNG)'
            }, { quoted: fake });
            return;
        }

        const mimeType = imageMessage.mimetype;
        if (!mimeType || !/image\/(jpe?g|png)/.test(mimeType)) {
            await sock.sendMessage(chatId, {
                text: 'Only JPEG/JPG/PNG images are supported!'
            }, { quoted: fake });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: '🌙 Processing image to night mode...'
        }, { quoted: fake });

        // Download the image
        const stream = await sock.downloadMediaMessage(quoted);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const base64Image = buffer.toString('base64');
        const promptText = text || "ubah jadi malam hari";

        const genAI = new GoogleGenerativeAI("AIzaSyDE7R-5gnjgeqYGSMGiZVjA5VkSrQvile8");
        
        const contents = [
            { text: promptText },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
        ];
        
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ["Text", "Image"]
            },
        });
        
        const response = await model.generateContent(contents);
        
        let resultImage = null;
        let resultText = "";
        
        for (const part of response.response.candidates[0].content.parts) {
            if (part.text) {
                resultText += part.text;
            } else if (part.inlineData) {
                const imageData = part.inlineData.data;
                resultImage = Buffer.from(imageData, "base64");
            }
        }
        
        if (resultImage) {
            const tempPath = path.join(process.cwd(), "temp", `gemini_night_${Date.now()}.png`);
            
            // Ensure temp directory exists
            if (!fs.existsSync(path.join(process.cwd(), "temp"))) {
                fs.mkdirSync(path.join(process.cwd(), "temp"), { recursive: true });
            }
            
            fs.writeFileSync(tempPath, resultImage);
            
            await sock.sendMessage(chatId, { 
                image: { url: tempPath },
                caption: '🌙 Night mode edited image'
            }, { quoted: fake });
            
            // Clean up after 30 seconds
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            }, 30000);
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to edit image. Please try again.'
            }, { quoted: fake });
        }

    } catch (error) {
        console.error('Error in night command:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing image. Please try again.'
        }, { quoted: fake });
    }
}

async function prettyCommand(sock, chatId, message, text) {
    try {
        const fake = createFakeContact(message);
        
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image with .pretty command'
            }, { quoted: fake });
            return;
        }

        const imageMessage = quoted.imageMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image file (JPEG/PNG)'
            }, { quoted: fake });
            return;
        }

        const mimeType = imageMessage.mimetype;
        if (!mimeType || !/image\/(jpe?g|png)/.test(mimeType)) {
            await sock.sendMessage(chatId, {
                text: 'Only JPEG/JPG/PNG images are supported!'
            }, { quoted: fake });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: '✨ Making image pretty with Korean style...'
        }, { quoted: fake });

        const stream = await sock.downloadMediaMessage(quoted);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const base64Image = buffer.toString('base64');
        const promptText = text || "edit wajah karakter menjadi wajah orang Korea";

        const genAI = new GoogleGenerativeAI("AIzaSyDE7R-5gnjgeqYGSMGiZVjA5VkSrQvile8");
        
        const contents = [
            { text: promptText },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
        ];
        
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ["Text", "Image"]
            },
        });
        
        const response = await model.generateContent(contents);
        
        let resultImage = null;
        let resultText = "";
        
        for (const part of response.response.candidates[0].content.parts) {
            if (part.text) {
                resultText += part.text;
            } else if (part.inlineData) {
                const imageData = part.inlineData.data;
                resultImage = Buffer.from(imageData, "base64");
            }
        }
        
        if (resultImage) {
            const tempPath = path.join(process.cwd(), "temp", `gemini_pretty_${Date.now()}.png`);
            
            if (!fs.existsSync(path.join(process.cwd(), "temp"))) {
                fs.mkdirSync(path.join(process.cwd(), "temp"), { recursive: true });
            }
            
            fs.writeFileSync(tempPath, resultImage);
            
            await sock.sendMessage(chatId, { 
                image: { url: tempPath },
                caption: '✨ Pretty Korean style edited image'
            }, { quoted: fake });
            
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            }, 30000);
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to edit image. Please try again.'
            }, { quoted: fake });
        }

    } catch (error) {
        console.error('Error in pretty command:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing image. Please try again.'
        }, { quoted: fake });
    }
}

async function uglyCommand(sock, chatId, message, text) {
    try {
        const fake = createFakeContact(message);
        
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image with .ugly command'
            }, { quoted: fake });
            return;
        }

        const imageMessage = quoted.imageMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, {
                text: 'Please reply to an image file (JPEG/PNG)'
            }, { quoted: fake });
            return;
        }

        const mimeType = imageMessage.mimetype;
        if (!mimeType || !/image\/(jpe?g|png)/.test(mimeType)) {
            await sock.sendMessage(chatId, {
                text: 'Only JPEG/JPG/PNG images are supported!'
            }, { quoted: fake });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: '😈 Making image ugly...'
        }, { quoted: fake });

        const stream = await sock.downloadMediaMessage(quoted);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const base64Image = buffer.toString('base64');
        const promptText = text || "edit wajah karakter menjadi jelek";

        const genAI = new GoogleGenerativeAI("AIzaSyDE7R-5gnjgeqYGSMGiZVjA5VkSrQvile8");
        
        const contents = [
            { text: promptText },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
        ];
        
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ["Text", "Image"]
            },
        });
        
        const response = await model.generateContent(contents);
        
        let resultImage = null;
        let resultText = "";
        
        for (const part of response.response.candidates[0].content.parts) {
            if (part.text) {
                resultText += part.text;
            } else if (part.inlineData) {
                const imageData = part.inlineData.data;
                resultImage = Buffer.from(imageData, "base64");
            }
        }
        
        if (resultImage) {
            const tempPath = path.join(process.cwd(), "temp", `gemini_ugly_${Date.now()}.png`);
            
            if (!fs.existsSync(path.join(process.cwd(), "temp"))) {
                fs.mkdirSync(path.join(process.cwd(), "temp"), { recursive: true });
            }
            
            fs.writeFileSync(tempPath, resultImage);
            
            await sock.sendMessage(chatId, { 
                image: { url: tempPath },
                caption: '😈 Ugly edited image'
            }, { quoted: fake });
            
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            }, 30000);
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to edit image. Please try again.'
            }, { quoted: fake });
        }

    } catch (error) {
        console.error('Error in ugly command:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing image. Please try again.'
        }, { quoted: fake });
    }
}

module.exports = {
    nightCommand,
    prettyCommand,
    uglyCommand
};