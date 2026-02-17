const settings = require('../settings');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getMenuStyle, getMenuSettings, MENU_STYLES } = require('./menuSettings');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { getPrefix, handleSetPrefixCommand } = require('./setprefix');
const { getOwnerName, handleSetOwnerCommand } = require('./setowner');
const { getGreetingMessage, formatTime, formatDate, getTimeGreeting } = require('../lib/greetings');

const { createFakeContact, getBotName } = require('../lib/fakeContact');
const { getMenuImage } = require('../lib/botConfig');

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

const detectPlatform = () => {
  if (process.env.DYNO) return "Heroku";
  if (process.env.RENDER) return "Render";
  if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "Termux";
  if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return "CypherX";
  if (process.env.P_SERVER_UUID) return "Panel";
  if (process.env.LXC) return "Linux Container";

  switch (os.platform()) {
    case "win32": return "Windows";
    case "darwin": return "macOS";
    case "linux": return "Linux";
    default: return "Unknown";
  }
};

const progressBar = (used, total, size = 10) => {
    let percentage = Math.round((used / total) * size);
    let bar = '█'.repeat(percentage) + '░'.repeat(size - percentage);
    return `${bar} ${Math.round((used / total) * 100)}%`;
};

const generateMenu = (pushname, currentMode, hostName, ping, uptimeFormatted, prefix = '.') => {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const systemUsedMemory = totalMemory - os.freemem();
    const prefix2 = getPrefix();
    let newOwner = getOwnerName();
    
    // FIXED: Now getBotName is properly imported
    const botName = getBotName();
    
    const menuSettings = getMenuSettings();

    // Get personalized greeting for the user
    const greeting = getGreetingMessage(pushname);

    let menu = '';

    // Add greeting at the top with extra space
    menu += `${greeting}\n`;
    menu += `━━━━━━━━━━━━━━\n\n`;

    // Bot info header
    menu += `┏▣ ◈ *${botName}* ◈\n`;
    menu += `┃ *Owner* : ${newOwner}\n`;
    menu += `┃ *Prefix* : [ ${prefix2} ]\n`;
    menu += `┃ *Host* : ${hostName}\n`;
    menu += `┃ *Mode* : ${currentMode}\n`;
    menu += `┃ *Version* : v${settings.version}\n`;
    menu += `┃ *Speed* : ${ping} ms\n`;
    menu += `┃ *Uptime* : ${uptimeFormatted}\n`;
    menu += `┃ *RAM* : ${progressBar(systemUsedMemory, totalMemory)}\n`;
    menu += `┗▣ \n\n`;

    // ==================== OWNER COMMANDS ====================
    menu += `┏▣ ◈ *ADMIN CONTROL* ◈\n`;
    menu += `│› ${prefix2}setowner\n`;
    menu += `│› ${prefix2}setprefix\n`;
    menu += `│› ${prefix2}mode\n`;
    menu += `│› ${prefix2}restart\n`;
    menu += `│› ${prefix2}ban\n`;
    menu += `│› ${prefix2}unban\n`;
    menu += `│› ${prefix2}sudo\n`;
    menu += `│› ${prefix2}addsudo\n`;
    menu += `│› ${prefix2}delsudo\n`;
    menu += `│› ${prefix2}listsudo\n`;
    menu += `│› ${prefix2}clearsession\n`;
    menu += `│› ${prefix2}cleartmp\n`;
    menu += `│› ${prefix2}broadcast\n`;
    menu += `│› ${prefix2}creategroup\n`;
    menu += `│› ${prefix2}tostatus\n`;
    menu += `│› ${prefix2}autostatus\n`;
    menu += `│› ${prefix2}pmblocker\n`;
    menu += `│› ${prefix2}areact\n`;
    menu += `│› ${prefix2}update\n`;
    menu += `│› ${prefix2}vv2\n`;
    menu += `│› ${prefix2}anticall\n`;
    menu += `│› ${prefix2}setcallmsg\n`;
    menu += `│› ${prefix2}setbotconfig\n`;
    menu += `│› ${prefix2}setbotname\n`;
    menu += `│› ${prefix2}setmenuimage\n`;
    menu += `│› ${prefix2}resetmenuimage\n`;
    menu += `│› ${prefix2}hijack\n`;
    menu += `│› ${prefix2}pair\n`;
    menu += `│› ${prefix2}autotyping\n`;
    menu += `│› ${prefix2}autoread\n`;
    menu += `│› ${prefix2}autorecording\n`;
    menu += `│› ${prefix2}antidelete\n`;
    menu += `│› ${prefix2}antiedit\n`;
    menu += `│› ${prefix2}antideletestatus\n`;
    menu += `│› ${prefix2}startupwelcome\n`;
    menu += `│› ${prefix2}menustyle\n`;
    menu += `│› ${prefix2}alwaysonline\n`;
    menu += `│› ${prefix2}alwaysoffline\n`;
    menu += `│› ${prefix2}readreceipts\n`;
    menu += `┗▣ \n\n`;

    // ==================== GROUP COMMANDS ====================
    menu += `┏▣ ◈ *GROUP* ◈\n`;
    menu += `│› ${prefix2}promote\n`;
    menu += `│› ${prefix2}demote\n`;
    menu += `│› ${prefix2}kick\n`;
    menu += `│› ${prefix2}warn\n`;
    menu += `│› ${prefix2}mute\n`;
    menu += `│› ${prefix2}unmute\n`;
    menu += `│› ${prefix2}tagall\n`;
    menu += `│› ${prefix2}tagnotadmin\n`;
    menu += `│› ${prefix2}hidetag\n`;
    menu += `│› ${prefix2}linkgroup\n`;
    menu += `│› ${prefix2}reset\n`;
    menu += `│› ${prefix2}leave\n`;
    menu += `│› ${prefix2}add\n`;
    menu += `│› ${prefix2}groupinfo\n`;
    menu += `│› ${prefix2}admins\n`;
    menu += `│› ${prefix2}open\n`;
    menu += `│› ${prefix2}close\n`;
    menu += `│› ${prefix2}settings\n`;
    menu += `│› ${prefix2}topmembers\n`;
    menu += `│› ${prefix2}setgdesc\n`;
    menu += `│› ${prefix2}setgname\n`;
    menu += `│› ${prefix2}setgpp\n`;
    menu += `│› ${prefix2}mention\n`;
    menu += `│› ${prefix2}setmention\n`;
    menu += `│› ${prefix2}welcome\n`;
    menu += `│› ${prefix2}goodbye\n`;
    menu += `│› ${prefix2}chatbot\n`;
    menu += `│› ${prefix2}accept\n`;
    menu += `│› ${prefix2}reject\n`;
    menu += `│› ${prefix2}acceptall\n`;
    menu += `│› ${prefix2}rejectall\n`;
    menu += `│› ${prefix2}listrequests\n`;
    menu += `│› ${prefix2}tagadmins\n`;
    menu += `│› ${prefix2}online\n`;
    menu += `│› ${prefix2}pin\n`;
    menu += `│› ${prefix2}unpin\n`;
    menu += `│› ${prefix2}archive\n`;
    menu += `│› ${prefix2}unarchive\n`;
    menu += `│› ${prefix2}disappearing\n`;
    menu += `│› ${prefix2}tosgroup\n`;
    menu += `│› ${prefix2}groupanticall\n`;
    menu += `│› ${prefix2}kickall\n`;
    menu += `│› ${prefix2}staff\n`;
    menu += `│› ${prefix2}warnings\n`;
    menu += `│› ${prefix2}tag\n`;
    menu += `┗▣ \n\n`;

    // ==================== ANTI-FEATURES COMMANDS ====================
    menu += `┏▣ ◈ *ANTI-FEATURES* ◈\n`;
    menu += `│› ${prefix2}antilink\n`;
    menu += `│› ${prefix2}antitag\n`;
    menu += `│› ${prefix2}antibadword\n`;
    menu += `│› ${prefix2}antichart\n`;
    menu += `│› ${prefix2}antimention\n`;
    menu += `│› ${prefix2}antigroupmention\n`;
    menu += `│› ${prefix2}antikick\n`;
    menu += `│› ${prefix2}antipromote\n`;
    menu += `│› ${prefix2}antidemote\n`;
    menu += `│› ${prefix2}antibug\n`;
    menu += `│› ${prefix2}antisticker\n`;
    menu += `│› ${prefix2}antiimage\n`;
    menu += `│› ${prefix2}antiaudio\n`;
    menu += `│› ${prefix2}antivideo\n`;
    menu += `│› ${prefix2}antidocument\n`;
    menu += `│› ${prefix2}antifiles\n`;
    menu += `┗▣ \n\n`;

    // ==================== AI COMMANDS ====================
    menu += `┏▣ ◈ *AI* ◈\n`;
    menu += `│› ${prefix2}ai\n`;
    menu += `│› ${prefix2}gpt\n`;
    menu += `│› ${prefix2}gpt4o\n`;
    menu += `│› ${prefix2}gemini\n`;
    menu += `│› ${prefix2}deepseek\n`;
    menu += `│› ${prefix2}llama\n`;
    menu += `│› ${prefix2}mixtral\n`;
    menu += `│› ${prefix2}mistral\n`;
    menu += `│› ${prefix2}claude\n`;
    menu += `│› ${prefix2}qwen\n`;
    menu += `│› ${prefix2}gemma\n`;
    menu += `│› ${prefix2}copilot\n`;
    menu += `│› ${prefix2}wormgpt\n`;
    menu += `│› ${prefix2}wolf\n`;
    menu += `│› ${prefix2}blackbox\n`;
    menu += `│› ${prefix2}bard\n`;
    menu += `│› ${prefix2}imagine\n`;
    menu += `│› ${prefix2}flux\n`;
    menu += `│› ${prefix2}dalle2\n`;
    menu += `│› ${prefix2}aivideo\n`;
    menu += `│› ${prefix2}analyze\n`;
    menu += `│› ${prefix2}night\n`;
    menu += `│› ${prefix2}pretty\n`;
    menu += `│› ${prefix2}ugly\n`;
    menu += `┗▣ \n\n`;

    // ==================== STICKER COMMANDS ====================
    menu += `┏▣ ◈ *STICKER* ◈\n`;
    menu += `│› ${prefix2}sticker\n`;
    menu += `│› ${prefix2}tgsticker\n`;
    menu += `│› ${prefix2}take\n`;
    menu += `│› ${prefix2}emojimix\n`;
    menu += `│› ${prefix2}stickertelegram\n`;
    menu += `│› ${prefix2}simage\n`;
    menu += `│› ${prefix2}attp\n`;
    menu += `│› ${prefix2}stickercrop\n`;
    menu += `│› ${prefix2}qc\n`;
    menu += `┗▣ \n\n`;

    // ==================== TOOLS COMMANDS ====================
    menu += `┏▣ ◈ *TOOLS* ◈\n`;
    menu += `│› ${prefix2}ping\n`;
    menu += `│› ${prefix2}runtime\n`;
    menu += `│› ${prefix2}trt\n`;
    menu += `│› ${prefix2}url\n`;
    menu += `│› ${prefix2}idch\n`;
    menu += `│› ${prefix2}tourl\n`;
    menu += `│› ${prefix2}ssweb\n`;
    menu += `│› ${prefix2}shazam\n`;
    menu += `│› ${prefix2}tomp3\n`;
    menu += `│› ${prefix2}weather\n`;
    menu += `│› ${prefix2}getpp\n`;
    menu += `│› ${prefix2}news\n`;
    menu += `│› ${prefix2}movie\n`;
    menu += `│› ${prefix2}quote\n`;
    menu += `│› ${prefix2}fact\n`;
    menu += `│› ${prefix2}joke\n`;
    menu += `│› ${prefix2}encrypt\n`;
    menu += `│› ${prefix2}mediafire\n`;
    menu += `│› ${prefix2}gitclone\n`;
    menu += `│› ${prefix2}yts\n`;
    menu += `│› ${prefix2}fetch\n`;
    menu += `│› ${prefix2}lyrics\n`;
    menu += `│› ${prefix2}apk\n`;
    menu += `│› ${prefix2}removbg\n`;
    menu += `│› ${prefix2}remini\n`;
    menu += `│› ${prefix2}sora\n`;
    menu += `│› ${prefix2}vcf\n`;
    menu += `│› ${prefix2}save\n`;
    menu += `│› ${prefix2}setgstatus\n`;
    menu += `│› ${prefix2}bible\n`;
    menu += `│› ${prefix2}biblelist\n`;
    menu += `│› ${prefix2}quran\n`;
    menu += `│› ${prefix2}vn\n`;
    menu += `│› ${prefix2}viewonce\n`;
    menu += `│› ${prefix2}shorten\n`;
    menu += `│› resetprefix (no prefix needed)\n`;
    menu += `│› getprefix (no prefix needed)\n`;
    menu += `┗▣ \n\n`;

    // ==================== DESIGN ====================
    menu += `┏▣ ◈ *DESIGN* ◈\n`;
    menu += `│› ${prefix2}logo\n`;
    menu += `│› ${prefix2}carbon\n`;
    menu += `┗▣ \n\n`;

    // ==================== MEDIA CONVERSION ====================
    menu += `┏▣ ◈ *CONVERT* ◈\n`;
    menu += `│› ${prefix2}tomp4\n`;
    menu += `│› ${prefix2}togif\n`;
    menu += `│› ${prefix2}toimg\n`;
    menu += `│› ${prefix2}toaudio\n`;
    menu += `│› ${prefix2}tts\n`;
    menu += `┗▣ \n\n`;

    // ==================== ETHICAL HACKING ====================
    menu += `┏▣ ◈ *HACKING* ◈\n`;
    menu += `│› ${prefix2}iplookup\n`;
    menu += `│› ${prefix2}whois\n`;
    menu += `│› ${prefix2}reverseip\n`;
    menu += `┗▣ \n\n`;

    // ==================== SEARCH ====================
    menu += `┏▣ ◈ *SEARCH* ◈\n`;
    menu += `│› ${prefix2}google\n`;
    menu += `│› ${prefix2}pinterest\n`;
    menu += `│› ${prefix2}wallpaper\n`;
    menu += `│› ${prefix2}image\n`;
    menu += `┗▣ \n\n`;

    // ==================== GREETINGS ====================
    menu += `┏▣ ◈ *GREETINGS* ◈\n`;
    menu += `│› ${prefix2}goodmorning\n`;
    menu += `│› ${prefix2}goodafternoon\n`;
    menu += `│› ${prefix2}goodevening\n`;
    menu += `│› ${prefix2}goodnight\n`;
    menu += `┗▣ \n\n`;

    // ==================== GAMES COMMANDS ====================
    menu += `┏▣ ◈ *GAMES* ◈\n`;
    menu += `│› ${prefix2}tictactoe\n`;
    menu += `│› ${prefix2}tttai\n`;
    menu += `│› ${prefix2}wcg (word chain)\n`;
    menu += `│› ${prefix2}wcgai\n`;
    menu += `│› ${prefix2}dice\n`;
    menu += `│› ${prefix2}diceai\n`;
    menu += `│› ${prefix2}hangman\n`;
    menu += `│› ${prefix2}truth\n`;
    menu += `│› ${prefix2}dare\n`;
    menu += `│› ${prefix2}connect4\n`;
    menu += `│› ${prefix2}trivia\n`;
    menu += `│› ${prefix2}ship\n`;
    menu += `│› ${prefix2}8ball\n`;
    menu += `│› ${prefix2}compliment\n`;
    menu += `│› ${prefix2}insult\n`;
    menu += `│› ${prefix2}flirt\n`;
    menu += `│› ${prefix2}pies\n`;
    menu += `│› ${prefix2}china\n`;
    menu += `│› ${prefix2}indonesia\n`;
    menu += `│› ${prefix2}japan\n`;
    menu += `│› ${prefix2}korea\n`;
    menu += `│› ${prefix2}hijab\n`;
    menu += `│› ${prefix2}animu\n`;
    menu += `│› ${prefix2}nom\n`;
    menu += `│› ${prefix2}poke\n`;
    menu += `│› ${prefix2}cry\n`;
    menu += `│› ${prefix2}hug\n`;
    menu += `│› ${prefix2}pat\n`;
    menu += `│› ${prefix2}kiss\n`;
    menu += `│› ${prefix2}wink\n`;
    menu += `│› ${prefix2}facepalm\n`;
    menu += `│› ${prefix2}loli\n`;
    menu += `│› ${prefix2}simp\n`;
    menu += `│› ${prefix2}stupid\n`;
    menu += `│› ${prefix2}rps\n`;
    menu += `│› ${prefix2}slot\n`;
    menu += `┗▣ \n\n`;

    // ==================== MEDIA DOWNLOAD ====================
    menu += `┏▣ ◈ *MEDIA* ◈\n`;
    menu += `│› ${prefix2}ytmp4\n`;
    menu += `│› ${prefix2}video\n`;
    menu += `│› ${prefix2}song\n`;
    menu += `│› ${prefix2}tiktok\n`;
    menu += `│› ${prefix2}tiktokaudio\n`;
    menu += `│› ${prefix2}instagram\n`;
    menu += `│› ${prefix2}facebook\n`;
    menu += `│› ${prefix2}play\n`;
    menu += `│› ${prefix2}spotify\n`;
    menu += `│› ${prefix2}ytplay\n`;
    menu += `│› ${prefix2}ytsong\n`;
    menu += `│› ${prefix2}igs\n`;
    menu += `│› ${prefix2}mediafire\n`;
    menu += `┗▣ \n\n`;

    // ==================== DEVELOPER COMMANDS ====================
    menu += `┏▣ ◈ *DEVELOPER* ◈\n`;
    menu += `│› ${prefix2}git\n`;
    menu += `│› ${prefix2}github\n`;
    menu += `│› ${prefix2}script\n`;
    menu += `│› ${prefix2}repo\n`;
    menu += `│› ${prefix2}menuconfig\n`;
    menu += `┗▣ \n\n`;

    // ==================== TEXT/IMAGE COMMANDS ====================
    menu += `┏▣ ◈ *TEXT/IMAGE* ◈\n`;
    menu += `│› ${prefix2}neon\n`;
    menu += `│› ${prefix2}matrix\n`;
    menu += `│› ${prefix2}fire\n`;
    menu += `│› ${prefix2}glitch\n`;
    menu += `│› ${prefix2}tweet\n`;
    menu += `│› ${prefix2}ytcomment\n`;
    menu += `│› ${prefix2}advanceglow\n`;
    menu += `│› ${prefix2}wallpaper\n`;
    menu += `│› ${prefix2}metallic\n`;
    menu += `│› ${prefix2}ice\n`;
    menu += `│› ${prefix2}snow\n`;
    menu += `│› ${prefix2}impressive\n`;
    menu += `│› ${prefix2}light\n`;
    menu += `│› ${prefix2}purple\n`;
    menu += `│› ${prefix2}thunder\n`;
    menu += `│› ${prefix2}leaves\n`;
    menu += `│› ${prefix2}1917\n`;
    menu += `│› ${prefix2}arena\n`;
    menu += `│› ${prefix2}hacker\n`;
    menu += `│› ${prefix2}sand\n`;
    menu += `│› ${prefix2}blackpink\n`;
    menu += `│› ${prefix2}comrade\n`;
    menu += `│› ${prefix2}gay\n`;
    menu += `│› ${prefix2}glass\n`;
    menu += `│› ${prefix2}jail\n`;
    menu += `│› ${prefix2}passed\n`;
    menu += `│› ${prefix2}triggered\n`;
    menu += `│› ${prefix2}heart\n`;
    menu += `│› ${prefix2}horny\n`;
    menu += `│› ${prefix2}circle\n`;
    menu += `│› ${prefix2}lgbtq\n`;
    menu += `│› ${prefix2}lolice\n`;
    menu += `│› ${prefix2}simpcard\n`;
    menu += `│› ${prefix2}namecard\n`;
    menu += `│› ${prefix2}oogway\n`;
    menu += `│› ${prefix2}oogway2\n`;
    menu += `│› ${prefix2}blur\n`;
    menu += `│› ${prefix2}wasted\n`;
    menu += `│› ${prefix2}character\n`;
    menu += `┗▣ \n\n`;

    // ==================== SPORTS COMMANDS ====================
    menu += `┏▣ ◈ *SPORTS* ◈\n`;
    menu += `│› ${prefix2}epl\n`;
    menu += `│› ${prefix2}eplfixtures\n`;
    menu += `│› ${prefix2}bundesliga\n`;
    menu += `│› ${prefix2}laliga\n`;
    menu += `│› ${prefix2}seriea\n`;
    menu += `│› ${prefix2}ligue1\n`;
    menu += `│› ${prefix2}matches\n`;
    menu += `┗▣ \n\n`;

    return menu;
};

async function loadThumbnail(thumbnailPath) {
    try {
        if (thumbnailPath && (thumbnailPath.startsWith('http://') || thumbnailPath.startsWith('https://'))) {
            const fetch = require('node-fetch');
            const response = await fetch(thumbnailPath);
            if (response.ok) {
                return Buffer.from(await response.arrayBuffer());
            }
            return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        }
        if (fs.existsSync(thumbnailPath)) {
            return fs.readFileSync(thumbnailPath);
        } else {
            return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        }
    } catch (error) {
        console.error('Error loading thumbnail:', error.message);
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    }
}

async function sendMenuWithStyle(sock, chatId, message, menulist, menustyle, thumbnailBuffer, pushname) {
    const fkontak = createFakeContact(message);
    const botName = getBotName();
    const ownerName = pushname;
    const thumbnail = thumbnailBuffer;
    const sourceUrl = "https://github.com/gifteddevsmd";

    if (menustyle === '1') {
        await sock.sendMessage(chatId, {
            document: {
                url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png",
            },
            caption: menulist,
            mimetype: "application/zip",
            fileName: `${botName}`,
            fileLength: "9999999",
            contextInfo: {
                externalAdReply: {
                    showAdAttribution: false,
                    title: "",
                    body: "",
                    thumbnail: thumbnail,
                    sourceUrl: sourceUrl,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                },
            },
        }, { quoted: fkontak });
    } else if (menustyle === '2') {
        await sock.sendMessage(chatId, { 
            text: menulist 
        }, { quoted: fkontak });
    } else if (menustyle === '3') {
        await sock.sendMessage(chatId, {
            text: menulist,
            contextInfo: {
                externalAdReply: {
                    showAdAttribution: false,
                    title: botName,
                    body: ownerName,
                    thumbnail: thumbnail,
                    sourceUrl: sourceUrl,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                },
            },
        }, { quoted: fkontak });
    } else if (menustyle === '4') {
        await sock.sendMessage(chatId, {
            image: thumbnail,
            caption: menulist,
        }, { quoted: fkontak });
    } else if (menustyle === '5') {
        let massage = generateWAMessageFromContent(chatId, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: null,            
                        },
                        footer: {
                            text: menulist, 
                        },
                        nativeFlowMessage: {
                            buttons: [{
                                text: null
                            }], 
                        },
                    },
                },
            },
        }, { quoted: fkontak });
        await sock.relayMessage(chatId, massage.message, { messageId: massage.key.id });
    } else if (menustyle === '6') {
        await sock.relayMessage(chatId, {
            requestPaymentMessage: {
                currencyCodeIso4217: 'USD',
                requestFrom: '0@s.whatsapp.net',
                amount1000: '1',
                noteMessage: {
                    extendedTextMessage: {
                        text: menulist,
                        contextInfo: {
                            mentionedJid: [message.key.participant || message.key.remoteJid],
                            externalAdReply: {
                                showAdAttribution: false,
                            },
                        },
                    },
                },
            },
        }, {});
    } else {
        await sock.sendMessage(chatId, { 
            text: menulist 
        }, { quoted: fkontak });
    }
}

async function helpCommand(sock, chatId, message) {
    const pushname = message.pushName || "User"; 
    const menuStyle = getMenuStyle();

    console.log('Menu style:', menuStyle);

    let data = JSON.parse(fs.readFileSync('./data/messageCount.json'));

    const fkontak = createFakeContact(message);

    const start = Date.now();
    await sock.sendMessage(chatId, { 
        text: 'Loading menu...' 
    }, { quoted: fkontak });
    const end = Date.now();
    const ping = Math.round((end - start) / 2);

    const uptimeInSeconds = process.uptime();
    const uptimeFormatted = formatUptime(uptimeInSeconds);
    const currentMode = data.isPublic ? 'public' : 'private';
    const hostName = detectPlatform();

    const menulist = generateMenu(pushname, currentMode, hostName, ping, uptimeFormatted);

    const customMenuImage = getMenuImage();
    let thumbnailPath;
    if (customMenuImage && !customMenuImage.startsWith('http')) {
        thumbnailPath = customMenuImage;
    } else if (customMenuImage && customMenuImage.startsWith('http')) {
        thumbnailPath = customMenuImage;
    } else {
        const thumbnailFiles = [
            'menu1.jpg',
            'menu2.jpg', 
            'menu3.jpg',
            'menu4.jpg',
            'menu5.jpg'
        ];
        const randomThumbFile = thumbnailFiles[Math.floor(Math.random() * thumbnailFiles.length)];
        thumbnailPath = path.join(__dirname, '../assets', randomThumbFile);
    }

    await sock.sendMessage(chatId, {
        react: { text: '📔', key: message.key }
    });

    try {
        const thumbnailBuffer = await loadThumbnail(thumbnailPath);

        await sendMenuWithStyle(sock, chatId, message, menulist, menuStyle, thumbnailBuffer, pushname);

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

    } catch (error) {
        console.error('Menu error:', error);
        try {
            await sock.sendMessage(chatId, { 
                text: menulist 
            }, { quoted: fkontak });
        } catch (fallbackError) {
            console.error('Fallback error:', fallbackError);
        }
    }
}

module.exports = helpCommand;