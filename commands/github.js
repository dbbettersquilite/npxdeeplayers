const moment = require('moment-timezone');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function githubCommand(sock, chatId, message) {
    try {
        const fakeContact = createFakeContact(message);
        
        await sock.sendMessage(chatId, { react: { text: '🌟', key: message.key } });
        
        const pushname = message.pushName || "User";
        
        const initialMsg = await sock.sendMessage(chatId, { 
            text: "Fetching DaveX repository...\n\n'Never give up' - John Cena" 
        }, { quoted: fakeContact });
        
        const res = await axios.get('https://api.github.com/repos/Davex-254/DAVE-X', {
            headers: { 'User-Agent': 'DAVE-X' }
        });
        
        const repo = res.data;
        
        let txt = `DAVE-X Repository\n\n`;
        txt += `Name: ${repo.name}\n`;
        txt += `Owner: ${repo.owner.login}\n`;
        txt += `Private: ${repo.private ? 'Yes' : 'No'}\n`;
        txt += `Size: ${(repo.size / 1024).toFixed(2)} MB\n`;
        txt += `Stars: ${repo.stargazers_count}\n`;
        txt += `Forks: ${repo.forks_count}\n`;
        txt += `Watchers: ${repo.watchers_count}\n`;
        txt += `Last Updated: ${moment(repo.updated_at).format('DD/MM/YY - HH:mm:ss')}\n`;
        txt += `URL: ${repo.html_url}\n\n`;
        txt += `Dont forget to star the repo.\n\n`;
        txt += `'The only thing thats stopping you is yourself' - John Cena\n`;
        txt += `Hey ${pushname}, thanks for choosing DaveX!`;
        
        const imgPath = path.join(__dirname, '../assets/menu2.jpg');
        const imgBuffer = fs.readFileSync(imgPath);
        
        await sock.sendMessage(chatId, {
            image: imgBuffer,
            caption: txt
        }, { quoted: fakeContact });
        
        const zipUrl = `https://github.com/Davex-254/DAVE-X/archive/refs/heads/main.zip`;
        const zipPath = path.join(__dirname, "../tmp/repo.zip");
        fs.mkdirSync(path.dirname(zipPath), { recursive: true });
        
        const zipResponse = await axios.get(zipUrl, {
            responseType: "arraybuffer",
            headers: { "User-Agent": "DAVE-MD" }
        });
        
        fs.writeFileSync(zipPath, zipResponse.data);
        
        await sock.sendMessage(chatId, {
            document: fs.readFileSync(zipPath),
            mimetype: "application/zip",
            fileName: `DAVE-X-${moment().format('DDMMYY')}.zip`,
            caption: "DAVE-X Source Code\n'Hustle,Loyalty, Respect' - John Cena"
        }, { quoted: fakeContact });
        
        fs.unlinkSync(zipPath);
        
        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });
        
    } catch (error) {
        console.error('GitHub error:', error);
        const fakeContact = createFakeContact(message);
        await sock.sendMessage(chatId, { 
            text: 'Failed to fetch repository info.' 
        }, { quoted: fakeContact });
    }
}

module.exports = githubCommand;