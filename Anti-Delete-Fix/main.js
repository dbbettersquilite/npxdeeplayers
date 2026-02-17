const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

// ========== TEMP FOLDER SETUP ==========
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Clean temp folder every 3 hours
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
    console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

// ========== CONSOLE FILTER SETUP (Only filter noise, keep all messages) ==========
const originalWrite = process.stdout.write;
process.stdout.write = function (chunk, encoding, callback) {
    const message = chunk.toString();
    // Only filter out session closing noise, keep all other logs including messages
    if (message.includes('Closing session: SessionEntry') || 
        message.includes('SessionEntry {') ||
        message.includes('unreadCount') ||
        message.includes('presence') ||
        message.includes('Received call') ||
        message.includes('Call duration')) {
        return;
    }
    return originalWrite.apply(this, arguments);
};

const originalWriteError = process.stderr.write;
process.stderr.write = function (chunk, encoding, callback) {
    const message = chunk.toString();
    if (message.includes('Closing session: SessionEntry')) {
        return;
    }
    return originalWriteError.apply(this, arguments);
};

// Store original console.log
const originalConsoleLog = console.log;

// ========== GROUP NAME & LID RESOLUTION CACHES ==========
const groupNameCache = new Map();
const GROUP_CACHE_TTL = 5 * 60 * 1000;
async function getGroupName(sock, chatId) {
    const cached = groupNameCache.get(chatId);
    if (cached && Date.now() - cached.ts < GROUP_CACHE_TTL) return cached.name;
    try {
        const meta = await sock.groupMetadata(chatId);
        const name = meta?.subject || chatId.split('@')[0];
        groupNameCache.set(chatId, { name, ts: Date.now() });
        return name;
    } catch {
        return chatId.split('@')[0];
    }
}

const lidPhoneCache = new Map();
const LID_CACHE_TTL = 30 * 60 * 1000;
let lidGroupScanDone = false;
let lidGroupScanTs = 0;

function cacheLidPhone(lidNum, phoneNum) {
    if (!lidNum || !phoneNum || lidNum === phoneNum) return;
    if (phoneNum.includes('lid')) return;
    if (lidNum.length <= 15 && /^\d+$/.test(lidNum)) return;
    lidPhoneCache.set(lidNum, { phone: phoneNum, ts: Date.now() });
}

function isLidJid(jid) {
    if (!jid) return false;
    if (jid.includes('@lid')) return true;
    const num = jid.split('@')[0].split(':')[0];
    if (num.length > 15) return true;
    if (!/^\d+$/.test(num)) return true;
    return false;
}

async function resolvePhoneFromLid(sock, lidJid) {
    if (!lidJid) return null;
    const lidNum = lidJid.split('@')[0].split(':')[0];

    const cached = lidPhoneCache.get(lidNum);
    if (cached && Date.now() - cached.ts < LID_CACHE_TTL) return cached.phone;

    if (sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const formats = [
                lidJid,
                `${lidNum}:0@lid`,
                `${lidNum}@lid`
            ];
            for (const fmt of formats) {
                try {
                    const pn = await sock.signalRepository.lidMapping.getPNForLID(fmt);
                    if (pn) {
                        const num = String(pn).split('@')[0].replace(/[^0-9]/g, '');
                        if (num.length >= 7 && num.length <= 15 && num !== lidNum) {
                            cacheLidPhone(lidNum, num);
                            return num;
                        }
                    }
                } catch {}
            }
        } catch {}
    }

    if (!lidGroupScanDone || Date.now() - lidGroupScanTs > 10 * 60 * 1000) {
        try {
            const groups = await sock.groupFetchAllParticipating();
            for (const gid of Object.keys(groups)) {
                const participants = groups[gid].participants || [];
                for (const p of participants) {
                    const pid = (p.id || '').split('@')[0].split(':')[0];
                    const pLid = (p.lid || '').split('@')[0].split(':')[0];

                    let phoneNum = null;
                    if (pid && !pid.includes('lid') && pid.length >= 7 && pid.length <= 15 && /^\d+$/.test(pid)) {
                        phoneNum = pid;
                    }

                    let lidVal = null;
                    if (pLid && pLid.length >= 5) lidVal = pLid;
                    if (!lidVal && (p.id || '').includes('@lid')) lidVal = pid;
                    if (!lidVal && pid.length > 15) lidVal = pid;

                    if (phoneNum && lidVal) {
                        cacheLidPhone(lidVal, phoneNum);
                    }

                    if (lidVal && !phoneNum && sock?.signalRepository?.lidMapping?.getPNForLID) {
                        try {
                            const fullLid = p.lid || p.id;
                            const pn = await sock.signalRepository.lidMapping.getPNForLID(fullLid);
                            if (pn) {
                                const num = String(pn).split('@')[0].replace(/[^0-9]/g, '');
                                if (num.length >= 7 && num.length <= 15) {
                                    cacheLidPhone(lidVal, num);
                                }
                            }
                        } catch {}
                    }
                }
            }
            lidGroupScanDone = true;
            lidGroupScanTs = Date.now();
        } catch (e) {}
    }

    const resolved = lidPhoneCache.get(lidNum);
    if (resolved) return resolved.phone;

    if (sock?.onWhatsApp) {
        try {
            const results = await sock.onWhatsApp(lidJid);
            if (results?.[0]?.jid) {
                const num = results[0].jid.split('@')[0].replace(/[^0-9]/g, '');
                if (num.length >= 7 && num.length <= 15 && num !== lidNum) {
                    cacheLidPhone(lidNum, num);
                    return num;
                }
            }
        } catch {}
    }

    return lidNum;
}

async function resolveParticipantNumber(sock, participant) {
    if (!participant) return '';
    const num = participant.split('@')[0].split(':')[0];
    if (isLidJid(participant)) {
        const resolved = await resolvePhoneFromLid(sock, participant);
        return resolved || num;
    }
    return num;
}

// ========== GLITCH TEXT FUNCTION ==========
const glitchText = (text) => {
    return chalk.hex('#00ffff').bold(text) + chalk.hex('#ff00ff')('_');
};

// ========== MODULE IMPORTS ==========
const { getBotName, createFakeContact } = require('./lib/fakeContact');
const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer, smsg, fetchJson, sleep, formatSize, randomKarakter } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { jidDecode } = require('@whiskeysockets/baileys');
const { isSudo } = require('./lib/index');
const isAdmin = require('./lib/isAdmin');

// Message Handler
const {
    getMessageText,
    isEditedMessage,
    getEditedMessageText,
    extractCommand,
    shouldProcessEditedMessage
} = require('./lib/messageHandler');

// ========== COMMAND IMPORTS ==========

// === CORE & BOT MANAGEMENT ===
const { getPrefix, handleSetPrefixCommand } = require('./commands/setprefix');
const { getOwnerName, handleSetOwnerCommand } = require('./commands/setowner');
const { 
    setbotconfigCommand,
    setbotnameCommand,
    setmenuimageCommand 
} = require('./commands/setbotconfig');
const ownerCommand = require('./commands/owner');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const updateCommand = require('./commands/update');
const settingsCommand = require('./commands/settings');
const { sudoCommand } = require('./commands/sudo');
const clearSessionCommand = require('./commands/clearsession');
const menuConfigCommand = require('./commands/menuConfig');
const helpCommand = require('./commands/help');

// === MODERATION COMMANDS ===
const banCommand = require('./commands/ban');
const unbanCommand = require('./commands/unban');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const kickCommand = require('./commands/kick');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const { promoteCommand, handlePromotionEvent } = require('./commands/promote');
const { demoteCommand, handleDemotionEvent } = require('./commands/demote');
const { clearCommand } = require('./commands/clear');
const kickAllCommand = require('./commands/kickall');
const { blockCommand, unblockCommand, blocklistCommand } = require('./commands/blockUnblock');

// === GROUP MANAGEMENT ===
const groupInfoCommand = require('./commands/groupinfo');
const staffCommand = require('./commands/staff');
const resetlinkCommand = require('./commands/resetlink');
const linkgroupCommand = require('./commands/linkgroup');
const creategroupCommand = require('./commands/creategroup');
const leaveGroupCommand = require('./commands/leave');
const { 
    setGroupDescription, 
    setGroupName, 
    setGroupPhoto 
} = require('./commands/groupmanage');
const { tagAllCommand } = require('./commands/tagall');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const { addMemberCommand } = require('./commands/addmember');

// === ANTI-FEATURES ===
const { handleAntiLinkDetection, handleAntilinkCommand } = require('./commands/antilink');
const { handleAntiStatusMention, antigroupmentionCommand } = require('./commands/antigroupmention');
const { handleChartDetection, antichartCommand } = require('./commands/antichart');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { handleAntiBadwordCommand, handleBadwordDetection, antibadwordCommand } = require('./commands/antibadword');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const { antimentionCommand, handleMentionDetection: handleNewMentionDetection } = require('./commands/antimention');
const { antipromoteCommand, handleAntipromote } = require('./commands/antipromote');
const { antidemoteCommand, handleAntidemote } = require('./commands/antidemote');
const { antibugCommand, handleBugDetection } = require('./commands/antibug');
const { antivideoCommand, handleVideoDetection } = require('./commands/antivideo');
const { antidocumentCommand, handleDocumentDetection } = require('./commands/antidocument');
const { antifilesCommand, handleFilesDetection } = require('./commands/antifiles');
const { antistickerCommand, handleStickerDetection } = require('./commands/antisticker');
const { antiimageCommand, handleImageDetection } = require('./commands/antiimage');
const { antiaudioCommand, handleAudioDetection } = require('./commands/antiaudio');
const { antikickCommand, handleAntikick, getGroupConfig: getAntikickConfig } = require('./commands/antikick');
const { getGroupConfig } = require('./Database/settingsStore');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const { antieditCommand, handleMessageUpdate, storeOriginalMessage } = require('./commands/antiedit');
const { handleStatusAntideleteCommand, handleStatusDeletion, storeStatusMessage } = require('./commands/antideletestatus');

// === AUTOMATION FEATURES ===
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');
const { autorecordingCommand, isAutorecordingEnabled, handleAutorecordingForMessage } = require('./commands/autorecording');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const { addCommandReaction, handleAreactCommand } = require('./lib/reactions');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const { pmblockerCommand } = require('./commands/pmblocker');
const { anticallCommand, setcallmsgCommand, handleIncomingCall, readState: readAnticallState } = require('./commands/anticall');
const { groupanticallCommand, handleGroupCall } = require('./commands/groupanticall');
const { startupWelcomeCommand } = require('./commands/startupwelcome');
const { broadcastCommand } = require('./commands/broadcast');
const { alwaysonlineCommand, alwaysofflineCommand, initPresenceOnConnect } = require('./commands/alwaysonline');
const { pinCommand, unpinCommand, archiveCommand, unarchiveCommand, disappearingCommand } = require('./commands/chatmanage');
const { autoreadReceiptsCommand } = require('./commands/autoReadReciepts');

// === MEDIA & ENTERTAINMENT ===
const stickerCommand = require('./commands/sticker');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const emojimixCommand = require('./commands/emojimix');
const stickerTelegramCommand = require('./commands/stickertelegram');
const stickercropCommand = require('./commands/stickercrop');
const { qcCommand } = require('./commands/quotesticker');
const ttsCommand = require('./commands/tts');
const memeCommand = require('./commands/meme');
const songCommand = require('./commands/song');
const videoCommand = require('./commands/video');
const playCommand = require('./commands/play');
const { ytplayCommand, ytsongCommand } = require('./commands/ytdl');
const ytsCommand = require('./commands/yts');
const { tiktokCommand } = require('./commands/tiktok');
const tiktokaudioCommand = require('./commands/tiktokaudio');
const spotifyCommand = require('./commands/spotify');
const shazamCommand = require('./commands/shazam');
const instagramCommand = require('./commands/instagram');
const { igsCommand } = require('./commands/igs');
const facebookCommand = require('./commands/facebook');
const movieCommand = require('./commands/movie');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const imagineCommand = require('./commands/imagine');
const soraCommand = require('./commands/sora');
const mediafireCommand = require('./commands/mediafire');

// === AI & TOOLS ===
const aiCommand = require('./commands/ai');
const gpt4Command = require('./commands/aiGpt4');
const wormgptCommand = require('./commands/wormgpt');
const copilotCommand = require('./commands/copilot');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const googleCommand = require('./commands/google');
const githubCommand = require('./commands/github');
const gitcloneCommand = require('./commands/gitclone');
const apkCommand = require('./commands/apk');
const urlCommand = require('./commands/url');
const { shortenUrlCommand } = require('./commands/tinyurl');
const { analyzeCommand } = require('./commands/analyze');
const encryptCommand = require('./commands/encrypt');
const fetchCommand = require('./commands/fetch');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { nightCommand, prettyCommand, uglyCommand } = require('./commands/imageedit');
const blurCommand = require('./commands/img-blur');
const textmakerCommand = require('./commands/textmaker');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const setProfilePicture = require('./commands/setpp');
const getppCommand = require('./commands/getpp');
const viewOnceCommand = require('./commands/viewonce');
const toAudioCommand = require('./commands/toAudio');
const setGroupStatusCommand = require('./commands/setGroupStatus');
const imageCommand = require('./commands/image');
const hijackCommand = require('./commands/hijack');

// === GAMES & FUN ===
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { tictactoeCommand, tictactoeAICommand, handleTicTacToeMove, handleTicTacToeJoin, tictactoeEndCommand } = require('./commands/tictactoe');
const { connectFourCommand, handleConnectFourMove } = require('./commands/connect4');
const { wcgCommand, wcgAICommand, wcgBeginCommand, wcgEndCommand, wcgScoresCommand, handleWcgJoin, handleWcgWord, hasWcgGame, hasWaitingWcgGame } = require('./commands/wordchain');
const { diceCommand, diceAICommand, handleDiceJoin, handleDiceBegin, handleDiceRoll, diceEndCommand, hasDiceGame } = require('./commands/dice');
const { acceptCommand, rejectCommand, acceptAllCommand, rejectAllCommand, listRequestsCommand } = require('./commands/joinrequests');
const tagAdminsCommand = require('./commands/tagadmins');
const onlineCommand = require('./commands/online');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { flirtCommand } = require('./commands/flirt');
const shipCommand = require('./commands/ship');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const pairCommand = require('./commands/pair');

// === UTILITIES ===
const deleteCommand = require('./commands/delete');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const channelidCommand = require('./commands/channelid');
const { chaneljidCommand } = require('./commands/chanel');
const vcfCommand = require('./commands/vcf');
const wallpaperCommand = require('./commands/wallpaper');
const takeCommand = require('./commands/take');
const clearTmpCommand = require('./commands/cleartmp');
const { tostatusCommand } = require('./commands/tostatus');
const saveStatusCommand = require('./commands/saveStatus');
const vv2Command = require('./commands/vv2');
const { vnCommand } = require('./commands/vn');

// === MISC COMMANDS ===
const { miscCommand } = require('./commands/misc');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');

// === SPORTS ===
const {
    eplStandingsCommand,
    bundesligaStandingsCommand,
    laligaStandingsCommand,
    serieAStandingsCommand,
    ligue1StandingsCommand,
    matchesCommand
} = require('./commands/sports');

// === RELIGIOUS ===
const {
    bibleCommand,
    bibleListCommand,
    quranCommand
} = require('./commands/bible');

// === DEV REACT ===
const handleDevReact = require('./commands/devReact');

// === NEW COMMANDS ===
const wolfCommand = require('./commands/wolf');
const dalleCommand = require('./commands/dalle');
const blackboxCommand = require('./commands/blackbox');
const bardCommand = require('./commands/bard');
const { deepseekCommand, llamaCommand, mixtralCommand, qwenCommand, claudeCommand, gpt4oCommand, mistralCommand, gemmaCommand } = require('./commands/aimodels');
const aivideoCommand = require('./commands/aivideo');
const { goodmorningCommand, goodafternoonCommand, goodeveningCommand } = require('./commands/greetings');
const { logoCommand, carbonCommand } = require('./commands/design');
const { tomp4Command } = require('./commands/tomp4');
const { togifCommand } = require('./commands/togif');
const toimgCommand = require('./commands/toimg');
const { ipLookupCommand, whoIsCommand, reverseipCommand } = require('./commands/ethicalhacking');
const resetMenuImageCommand = require('./commands/resetmenuimage');
const pinterestCommand = require('./commands/pinterest');
const rpsCommand = require('./commands/rps');
const slotCommand = require('./commands/slot');

// ========== GLOBAL SETTINGS ==========
global.packname = settings?.packname || "DAVE-X";
global.author = settings?.author || "DAVE-X BOT";
global.channelLink = "https://whatsapp.com/channel/0029VbApvFQ2Jl84lhONkc3k";
global.ytchanel = "";

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363400480173280@newsletter',
            newsletterName: 'DAVE-X',
            serverMessageId: -1
        }
    }
};

// Override console.log with glitch frame for message logging
console.log = function(...args) {
    // Skip if it's our custom logs (to avoid recursion)
    if (args[0] && typeof args[0] === 'string' && args[0].includes('┌─────────────────')) {
        originalConsoleLog.apply(console, args);
        return;
    }
    
    // Check if this is a message/command log
    const message = args.join(' ');
    if (message.includes('[CMD]') || message.includes('[MSG]')) {
        // These are handled separately in the message handler
        originalConsoleLog.apply(console, args);
    } else {
        originalConsoleLog.apply(console, args);
    }
};

// ========== MESSAGE HANDLER ==========
async function handleMessages(sock, messageUpdate, printLog) {
    try {
        global.sock = sock;

        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        // Handle automation features
        await handleAutoread(sock, message);
        await handleDevReact(sock, message);
        
        // Store messages for anti-features - MOVED UP for proper functionality
        if (message.message) {
            storeMessage(sock, message);
            await storeStatusMessage(sock, message);
        }
        
        // Store for antiedit - do this BEFORE processing edits
        storeOriginalMessage(message);
        
        // Handle message update (antiedit) - check for edits
        await handleMessageUpdate(sock, message);
        
        // Handle status deletions
        await handleStatusDeletion(sock, message);

        // Handle message revocation (delete) - check for deletions
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return; // Stop processing deleted messages
        }

        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        let senderNumber = (senderId || '').split(':')[0].split('@')[0];
        
        if (isLidJid(senderId)) {
            try {
                const resolved = await resolvePhoneFromLid(sock, senderId);
                if (resolved && resolved !== senderNumber && /^\d{7,15}$/.test(resolved)) {
                    senderNumber = resolved;
                }
            } catch {}
        }
        
        const pushName = message.pushName || senderNumber;

        const prefix = getPrefix();
        const isPrefixless = prefix === '';
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);

        const msgType = Object.keys(message.message || {}).find(k => 
            k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage'
        ) || 'unknown';

        let userMessage = getMessageText(message);

        // Check for edited messages
        if (shouldProcessEditedMessage(message, prefix)) {
            const editedText = getEditedMessageText(message);
            if (editedText) {
                userMessage = editedText;
                console.log(chalk.cyan(`[EDIT] Processed edited message: ${userMessage}`));
            }
        }

        let groupName = '';
        if (isGroup) {
            groupName = await getGroupName(sock, chatId);
        }

        // ========== GLITCH FRAME LOGGING FOR EVERY MESSAGE ==========
        if (message.message) {
            const mtype = Object.keys(message.message)[0].replace('Message', '').replace('ExtendedText', 'Text');
            const messageContent = userMessage || mtype || 'Unknown';
            
            console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('┌───────────────── MESSAGE ─────────────────┐'));
            console.log(chalk.bgHex('#0a0a0a').hex('#ff00ff')(`   ⚡ ${glitchText('INCOMING TRANSMISSION')}`));
            console.log(chalk.bgHex('#0a0a0a').hex('#00ffff')('├─────────────────────────────────────────────┤'));
            
            const entries = [
                ['🕐', 'TIMESTAMP', new Date().toLocaleString()],
                ['📡', 'CONTENT', messageContent.substring(0, 50) + (messageContent.length > 50 ? '...' : '')],
                ['👤', 'USER', pushName],
                ['🔢', 'NUMBER', `+${senderNumber}`], // Shows real number with + prefix
                ...(isGroup ? [
                    ['👥', 'GROUP', groupName],
                    ['🔗', 'GROUP_ID', chatId.split('@')[0]]
                ] : [
                    ['💬', 'CHAT', 'PRIVATE']
                ]),
                ['📱', 'TYPE', mtype]
            ];

            entries.forEach(([icon, label, value]) => {
                console.log(
                    chalk.bgHex('#0a0a0a').hex('#ffff00')(`   ${icon} `) +
                    chalk.bgHex('#0a0a0a').hex('#00ff00')(`${label}:`) +
                    chalk.bgHex('#0a0a0a').hex('#ffffff')(` ${value}`)
                );
            });
            
            console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('└─────────────────────────────────────────────┘\n'));
        }

        const fake = createFakeContact(message);

        // Check bot mode access
        try {
            const data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (data.mode === 'group' && !isGroup) return;
            if (data.mode === 'pm' && isGroup) return;
            if (data.mode === 'private' && !message.key.fromMe && !senderIsSudo) return;
        } catch (error) {
            console.error('Error checking access mode:', error);
        }

        // Check if user is banned
        if (isBanned(senderId) && !userMessage.startsWith(`${prefix}unban`)) {
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: 'You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // Handle game moves (Tic Tac Toe & Connect Four)
        if (/^[1-9]$/.test(userMessage)) {
            const tttResult = await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            if (!tttResult && parseInt(userMessage) <= 7) {
                await handleConnectFourMove(sock, chatId, senderId, userMessage);
            }
        }

        // Handle Word Chain game words (single words during active game)
        if (hasWcgGame && hasWcgGame(chatId) && /^[a-zA-Z]+$/.test(userMessage.trim())) {
            await handleWcgWord(sock, chatId, senderId, userMessage.trim(), fake);
        }

        // Increment message count for top members
        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // ====== ANTI FEATURES DETECTION ======
        if (isGroup) {
            // Run anti-link detection
            await handleAntiLinkDetection(sock, message);

            // Run anti status mention detection
            await handleAntiStatusMention(sock, message);

            // Check message type for anti-features
            const isSticker = message.message?.stickerMessage;
            const isImage = message.message?.imageMessage;
            const isVideo = message.message?.videoMessage;
            const isAudio = message.message?.audioMessage || message.message?.pttMessage;
            const isDocument = message.message?.documentMessage;
            const hasText = userMessage && userMessage.trim() !== '';

            // Anti-sticker detection
            if (isSticker) {
                await handleStickerDetection(sock, chatId, message, senderId);
            }

            // Anti-image detection
            if (isImage) {
                await handleImageDetection(sock, chatId, message, senderId);
            }

            // Anti-video detection
            if (isVideo) {
                await handleVideoDetection(sock, chatId, message, senderId);
            }

            // Anti-audio detection
            if (isAudio) {
                await handleAudioDetection(sock, chatId, message, senderId);
            }

            // Anti-document detection
            if (isDocument) {
                await handleDocumentDetection(sock, chatId, message, senderId);
            }

            // Anti-files detection (for any file)
            if (isSticker || isImage || isVideo || isAudio || isDocument) {
                await handleFilesDetection(sock, chatId, message, senderId);
            }

            // ANTICHART DETECTION - handles multiple content types
            const isContactCard = message.message?.contactMessage;
            const isTemplate = message.message?.templateMessage;
            const isButtons = message.message?.buttonsMessage;
            const isList = message.message?.listMessage;
            const isProduct = message.message?.productMessage;
            const isPoll = message.message?.pollCreationMessage;
            const isLocation = message.message?.locationMessage;
            const isGif = isImage && message.message?.imageMessage?.gifPlayback;

            // Call antichart for all detectable content types
            if (isContactCard || isTemplate || isButtons || isList || isProduct || isPoll || isLocation || isGif) {
                await handleChartDetection(sock, chatId, message, senderId);
            }

            // Bug detection runs on ALL message types (not just text)
            await handleBugDetection(sock, chatId, message, senderId);

            // Run text-based detections
            if (hasText) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
                await handleNewMentionDetection(sock, chatId, message, senderId);

                // Also check for text messages and links for antichart
                await handleChartDetection(sock, chatId, message, senderId);
            }
        }
        // ====== END ANTI FEATURES DETECTION ======

        // PM Blocker check
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        // Auto typing and recording features
        if (isAutotypingEnabled()) {
            await handleAutotypingForMessage(sock, chatId);
        }

        if (isAutorecordingEnabled()) {
            await handleAutorecordingForMessage(sock, chatId);
        }

        if (userMessage) {
            const lowerMsg = userMessage.trim().toLowerCase();
            if (lowerMsg === 'resetprefix' || lowerMsg === 'getprefix' || lowerMsg === 'prefix') {
                const currentPrefix = getPrefix() || '.';
                const botName = getBotName();
                const isOwner = message.key.fromMe || senderId === `${settings.ownerNumber}@s.whatsapp.net` || senderIsSudo;
                if (lowerMsg === 'resetprefix' && isOwner) {
                    const { setPrefix } = require('./commands/setprefix');
                    setPrefix('.');
                    await sock.sendMessage(chatId, { text: `*${botName}*\nPrefix has been reset to: .` }, { quoted: fake });
                } else {
                    await sock.sendMessage(chatId, { text: `*${botName}*\nCurrent prefix: ${currentPrefix === '' ? 'None (prefixless)' : currentPrefix}\n\nType "resetprefix" to reset to default (.)` }, { quoted: fake });
                }
                return;
            }
        }

        // Extract command
        let command, args, fullArgs;
        if (userMessage) {
            const extracted = extractCommand(userMessage, prefix);
            command = extracted.command;
            args = extracted.args;
            fullArgs = extracted.fullArgs;
            
            if (command) {
                const chatLabel = isGroup ? chatId.split('@')[0] : 'DM';
                const typeLabel = msgType.replace('Message', '').replace('extendedText', 'text');
                const cmdLine = `${prefix}${command}${fullArgs ? ' ' + fullArgs.substring(0, 50) + (fullArgs.length > 50 ? '...' : '') : ''}`;
                
                // Command log with glitch frame
                console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('┌───────────────── COMMAND ─────────────────┐'));
                console.log(chalk.bgHex('#0a0a0a').hex('#ff00ff')(`   ⚡ ${glitchText('COMMAND EXECUTED')}`));
                console.log(chalk.bgHex('#0a0a0a').hex('#00ffff')('├─────────────────────────────────────────────┤'));
                
                const cmdEntries = [
                    ['🕐', 'TIME', new Date().toLocaleString()],
                    ['⚡', 'COMMAND', `${prefix}${command}`],
                    ['📝', 'ARGS', fullArgs || 'None'],
                    ['👤', 'USER', pushName],
                    ['🔢', 'NUMBER', `+${senderNumber}`],
                    ['📍', 'CHAT', chatLabel],
                    ['📱', 'TYPE', typeLabel]
                ];

                cmdEntries.forEach(([icon, label, value]) => {
                    console.log(
                        chalk.bgHex('#0a0a0a').hex('#ffff00')(`   ${icon} `) +
                        chalk.bgHex('#0a0a0a').hex('#00ff00')(`${label}:`) +
                        chalk.bgHex('#0a0a0a').hex('#ffffff')(` ${value}`)
                    );
                });
                
                console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('└─────────────────────────────────────────────┘\n'));
            }
        }

        // If no command but has text, handle chatbot/tag detection
        if (!command && userMessage) {
            if (isGroup) {
                await handleAntiLinkDetection(sock, message);
                await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                await handleTagDetection(sock, message);
                await handleMentionDetection(sock, chatId, message);
            }
            return;
        }

        if (!command) return;

        // Define command categories
        const adminCommands = [
            'mute', 'unmute', 'ban', 'unban', 'promote', 'demote', 'kick', 
            'linkgroup', 'linkgc', 'tagall', 'tagnotadmin', 'hidetag', 'antilink', 
            'antitag', 'setgdesc', 'setgname', 'setgpp', 'antikick', 
            'antipromote', 'antidemote', 'antibug', 'antigroupmention', 'groupmention',
            'antimention', 'antiaudio', 'antivideo', 'antidocument', 
            'antifiles', 'antisticker', 'antiimage', 'antibadword', 
            'antichart', 'antiforward', 'welcome', 'goodbye',
            'add', 'groupinfo', 'infogroup', 'infogrupo', 'admin', 'listadmin',
            'staff', 'reset', 'revoke', 'resetlink', 'tagadmins', 'admins',
            'accept', 'approve', 'reject', 'decline', 'acceptall', 'rejectall',
            'listrequests', 'requests', 'joinrequests', 'online',
            'warn', 'warnings', 'kickall', 'tag', 'clear',
            'chatbot', 'ship'
        ];
        
        const ownerCommands = [
            'mode', 'autostatus', 'antidelete', 'cleartmp', 'setpp', 
            'tostatus', 'clearsession', 'areact', 'autoreact', 'autotyping', 
            'autoread', 'pmblocker', 'setbotconfig', 'setbotname', 
            'setmenuimage', 'hijack', 'pair', 'autorecording', 'chatbot',
            'autocall', 'broadcast', 'creategroup', 'setowner', 'setprefix',
            'vv2', 'antiedit', 'antideletestatus', 'sad', 'ads', 'startupwelcome',
            'alwaysonline', 'alwaysoffline', 'pin', 'unpin', 'archive',
            'unarchive', 'disappearing', 'readreceipts', 'autoreadreceipts'
        ];

        const isAdminCommand = adminCommands.includes(command);
        const isOwnerCommand = ownerCommands.includes(command);

        if (!isGroup && isAdminCommand) {
            await sock.sendMessage(chatId, {
                text: 'This command can only be used in groups, not in private chats!'
            }, { quoted: fake });
            return;
        }

        let isSenderAdmin = false;
        let isBotAdmin = false;

        if (isGroup && isAdminCommand) {
            const adminStatus = await isAdmin(sock, chatId, senderId, message);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin && command !== 'welcome' && command !== 'goodbye') {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.' }, { quoted: fake });
                return;
            }

            if (
                ['mute', 'unmute', 'ban', 'unban', 'promote', 'demote', 'kick', 'hijack', 
                'antilink', 'antitag', 'antikick', 'antipromote', 'antidemote', 'antibug',
                'antigroupmention', 'groupmention', 'antimention', 'antiaudio', 'antivideo', 'antidocument',
                'antifiles', 'antisticker', 'antiimage', 'antibadword', 'antichart', 'antiforward', 'add',
                'kickall', 'resetlink', 'reset', 'revoke', 'setgdesc', 'setgname', 'setgpp',
                'accept', 'approve', 'reject', 'decline', 'acceptall', 'rejectall',
                'listrequests', 'requests', 'joinrequests', 'warn'].includes(command)
            ) {
                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, {
                        text: 'Sorry, only group admins can use this command.',
                        ...channelInfo
                    }, { quoted: fake });
                    return;
                }
            }
        }

        if (isOwnerCommand) {
            if (!message.key.fromMe && !senderIsSudo) {
                await sock.sendMessage(chatId, { text: 'This command is only available for the owner or sudo!' }, { quoted: fake });
                return;
            }
        }

        let commandExecuted = false;

        // ========== COMMAND SWITCH CASE ==========
        switch (command) {
            // === BOT MANAGEMENT ===
            case 'setprefix':
                await handleSetPrefixCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setowner':
                await handleSetOwnerCommand(sock, chatId, senderId, message, userMessage, prefix);
                commandExecuted = true;
                break;
                
            case 'owner':
                await ownerCommand(sock, chatId);
                commandExecuted = true;
                break;
                
            case 'ping':
            case 'dave':
                await pingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'uptime':
            case 'alive':
            case 'runtime':
                await aliveCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'help':
            case 'menu':
            case 'h':
            case 'pesh':
                await helpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'menuconfig':
            case 'menustyle':
            case 'menuset':
            case 'setmenu':
                await menuConfigCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
                
            case 'settings':
            case 'getsettings':
                await settingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'sudo':
            case 'addsudo':
            case 'delsudo':
            case 'removesudo':
            case 'listsudo':
                if (command === 'addsudo') {
                    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
                    const rest = rawText.trim().split(/\s+/).slice(1).join(' ');
                    message.message = message.message || {};
                    if (message.message.conversation !== undefined) {
                        message.message.conversation = `${prefix}sudo add ${rest}`;
                    } else if (message.message.extendedTextMessage) {
                        message.message.extendedTextMessage.text = `${prefix}sudo add ${rest}`;
                    }
                } else if (command === 'delsudo' || command === 'removesudo') {
                    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
                    const rest = rawText.trim().split(/\s+/).slice(1).join(' ');
                    message.message = message.message || {};
                    if (message.message.conversation !== undefined) {
                        message.message.conversation = `${prefix}sudo del ${rest}`;
                    } else if (message.message.extendedTextMessage) {
                        message.message.extendedTextMessage.text = `${prefix}sudo del ${rest}`;
                    }
                } else if (command === 'listsudo') {
                    message.message = message.message || {};
                    if (message.message.conversation !== undefined) {
                        message.message.conversation = `${prefix}sudo list`;
                    } else if (message.message.extendedTextMessage) {
                        message.message.extendedTextMessage.text = `${prefix}sudo list`;
                    }
                }
                await sudoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'clearsession':
            case 'clearsesi':
                await clearSessionCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'mode':
                {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!' }, { quoted: fake });
                        return;
                    }

                    let data;
                    try {
                        data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
                    } catch (error) {
                        console.error('Error reading access mode:', error);
                        await sock.sendMessage(chatId, { text: 'Failed to read bot mode status' }, { quoted: fake });
                        return;
                    }

                    const action = args[0]?.toLowerCase();
                    const validModes = ['private', 'public', 'group', 'pm'];

                    const modeDescriptions = {
                        private: 'successfully enabled private mode',
                        public: 'successfully enabled public mode',
                        group: 'Only Group mode enabled',
                        pm: 'Successfully enabled only pc mode'
                    };

                    if (!action) {
                        const currentMode = data.mode || (data.isPublic ? 'public' : 'private');
                        await sock.sendMessage(chatId, {
                            text: `*Bot Mode Configuration*\n\nCurrent mode: *${currentMode}*\n\n📋 *Available Modes:*\n• ${prefix}mode private - Only owner can use bot\n• ${prefix}mode public - Everyone can use bot\n• ${prefix}mode group - Bot can only be used in groups\n• ${prefix}mode pm - Bot can only be used in pm mode\n\nExample:\n${prefix}mode group`
                        }, { quoted: fake });
                        return;
                    }

                    if (!validModes.includes(action)) {
                        await sock.sendMessage(chatId, {
                            text: `Invalid mode!\n\n🦥 *Available Modes:*\n• ${prefix}mode private - Only owner can use bot\n• ${prefix}mode public - Everyone can use bot\n• ${prefix}mode group - Bot can only be used in groups\n• ${prefix}mode pm - Bot can only be used in pm mode\n\nExample:\n${prefix}mode group`
                        }, { quoted: fake });
                        return;
                    }

                    try {
                        data.mode = action;
                        data.isPublic = (action === 'public');

                        fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));

                        await sock.sendMessage(chatId, {
                            text: `*Bot Mode updated successfully!*\n\n${modeDescriptions[action]}`            
                        }, { quoted: fake });
                    } catch (error) {
                        console.error('Error updating access mode:', error);
                        await sock.sendMessage(chatId, { text: 'Failed to update bot mode' }, { quoted: fake });
                    }
                }
                commandExecuted = true;
                break;
                
            case 'update':
            case 'start':
            case 'restart':
                {
                    const zipArg = args[0] && args[0].startsWith('http') ? args[0] : '';
                    await updateCommand(sock, chatId, message, senderIsSudo, zipArg);
                }
                commandExecuted = true;
                break;

            // === MODERATION COMMANDS ===
            case 'ban':
                await banCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'unban':
                await unbanCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'mute':
                {
                    const muteArg = args[0];
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.' }, { quoted: fake });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                }
                commandExecuted = true;
                break;
                
            case 'unmute':
                await unmuteCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;
                
            case 'kick':
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                commandExecuted = true;
                break;
                
            case 'warn':
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                commandExecuted = true;
                break;
                
            case 'warnings':
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                commandExecuted = true;
                break;
                
            case 'promote':
                const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                commandExecuted = true;
                break;
                
            case 'demote':
                const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                commandExecuted = true;
                break;
                
            case 'clear':
                if (isGroup) await clearCommand(sock, chatId);
                commandExecuted = true;
                break;
                
            case 'removeall':
            case 'killall':
                await kickAllCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'block':
                await blockCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'unblock':
                await unblockCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'blocklist':
            case 'listblock':
                await blocklistCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === GROUP MANAGEMENT ===
            case 'groupinfo':
            case 'infogroup':
            case 'infogrupo':
                await groupInfoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'admin':
            case 'listadmin':
            case 'staff':
                await staffCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'reset':
            case 'revoke':
            case 'resetlink':
                await resetlinkCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;
                
            case 'linkgroup':
            case 'linkgc':
                await linkgroupCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'creategroup':
            case 'creategc':
                await creategroupCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'left':
            case 'leave':
                await leaveGroupCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setgdesc':
                await setGroupDescription(sock, chatId, senderId, fullArgs, message);
                commandExecuted = true;
                break;
                
            case 'setgname':
                await setGroupName(sock, chatId, senderId, fullArgs, message);
                commandExecuted = true;
                break;
                
            case 'setgpp':
                await setGroupPhoto(sock, chatId, senderId, message);
                commandExecuted = true;
                break;
                
            case 'tagall':
                if (isSenderAdmin || message.key.fromMe) {
                    await tagAllCommand(sock, chatId, senderId, message);
                } else {
                    await sock.sendMessage(chatId, { text: '_Only admins can use this command_' }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'tagnotadmin':
                await tagNotAdminCommand(sock, chatId, senderId, message);
                commandExecuted = true;
                break;
                
            case 'hidetag':
                {
                    const messageText = fullArgs;
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                commandExecuted = true;
                break;
                
            case 'tag':
                const messageText = fullArgs;
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                commandExecuted = true;
                break;

            case 'tagadmins':
            case 'admins':
                await tagAdminsCommand(sock, chatId, senderId, message, fullArgs);
                commandExecuted = true;
                break;

            case 'online':
                await onlineCommand(sock, chatId, senderId, message);
                commandExecuted = true;
                break;

            case 'accept':
            case 'approve':
                await acceptCommand(sock, chatId, senderId, fullArgs, message, fake);
                commandExecuted = true;
                break;

            case 'reject':
            case 'decline':
                await rejectCommand(sock, chatId, senderId, fullArgs, message, fake);
                commandExecuted = true;
                break;

            case 'acceptall':
                await acceptAllCommand(sock, chatId, senderId, message, fake);
                commandExecuted = true;
                break;

            case 'rejectall':
                await rejectAllCommand(sock, chatId, senderId, message, fake);
                commandExecuted = true;
                break;

            case 'listrequests':
            case 'requests':
            case 'joinrequests':
                await listRequestsCommand(sock, chatId, senderId, message, fake);
                commandExecuted = true;
                break;

            case 'add':
                await addMemberCommand(sock, chatId, message, fullArgs, prefix, senderId, isSenderAdmin, isBotAdmin, isGroup);
                commandExecuted = true;
                break;

            // === ANTI-FEATURES ===
            case 'antilink':
                const antilinkAdminStatus = await isAdmin(sock, chatId, senderId);
                const antilinkIsSenderAdmin = antilinkAdminStatus.isSenderAdmin;
                const antilinkIsBotAdmin = antilinkAdminStatus.isBotAdmin;

                if (!antilinkIsBotAdmin) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Bot must be admin to use anti-link!' 
                    }, { quoted: fake });
                    return;
                }

                const antilinkSubCmd = args[0]?.toLowerCase();
                if (!['status', 'help'].includes(antilinkSubCmd) && !antilinkIsSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Only group admins can configure anti-link!' 
                    }, { quoted: fake });
                    return;
                }

                await handleAntilinkCommand(sock, chatId, userMessage, senderId, antilinkIsSenderAdmin);
                commandExecuted = true;
                break;
                
            case 'antigroupmention':
            case 'groupmention':
                const agmAdminStatus = await isAdmin(sock, chatId, senderId);
                const agmIsSenderAdmin = agmAdminStatus.isSenderAdmin;
                const agmIsBotAdmin = agmAdminStatus.isBotAdmin;

                if (!agmIsBotAdmin) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Bot must be admin to use anti-group mention!' 
                    }, { quoted: fake });
                    return;
                }

                if (!agmIsSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Only group admins can configure anti-group mention!' 
                    }, { quoted: fake });
                    return;
                }

                await antigroupmentionCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
                
            case 'antichart':
            case 'antiforward':
                const antichartAdminStatus = await isAdmin(sock, chatId, senderId);
                const antichartIsSenderAdmin = antichartAdminStatus.isSenderAdmin;
                const antichartIsBotAdmin = antichartAdminStatus.isBotAdmin;

                if (!antichartIsBotAdmin) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Bot must be admin to use anti-chart!' 
                    }, { quoted: fake });
                    return;
                }

                if (!antichartIsSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Only group admins can configure anti-chart!' 
                    }, { quoted: fake });
                    return;
                }

                await antichartCommand(sock, chatId, userMessage, senderId, antichartIsSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antitag':
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: fake });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antiedit':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { 
                        text: `Owner only command!` 
                    }, { quoted: fake });
                    return;
                }
                await antieditCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'antideletestatus':
            case 'antistatus delete':
            case 'ads':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ This command is only available for the owner or sudo!' 
                    }, { quoted: fake });
                    return;
                }
                await handleStatusAntideleteCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'antidelete':
                await handleAntideleteCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'mention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await mentionToggleCommand(sock, chatId, message, fullArgs, isOwner);
                }
                commandExecuted = true;
                break;
                
            case 'setmention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await setMentionCommand(sock, chatId, message, isOwner);
                }
                commandExecuted = true;
                break;
                
            case 'antibadword':
                await antibadwordCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'antimention':
                await antimentionCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
                
            case 'antipromote':
                await antipromoteCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
                
            case 'antidemote':
                await antidemoteCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
                
            case 'antibug':
                await antibugCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antikick':
                await antikickCommand(sock, chatId, message, senderId, isSenderAdmin);
                commandExecuted = true;
                break;
                
            case 'antiaudio':
                await antiaudioCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antivideo':
                await antivideoCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antidocument':
                await antidocumentCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antifiles':
                await antifilesCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antisticker':
                await antistickerCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;
                
            case 'antiimage':
                await antiimageCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                commandExecuted = true;
                break;

            // === AUTOMATION FEATURES ===
            case 'autotyping':
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'autoread':
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'autorecording':
                await autorecordingCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'alwaysonline':
                await alwaysonlineCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'alwaysoffline':
                await alwaysofflineCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'pin':
                await pinCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'unpin':
                await unpinCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'archive':
                await archiveCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'unarchive':
                await unarchiveCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'disappearing':
                await disappearingCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;

            case 'readreceipts':
            case 'autoreadreceipts':
                await autoreadReceiptsCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'autostatus':
            case 'autoviewstatus':
            case 'autostatusview':
                await autoStatusCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
                
            case 'welcome':
                if (isGroup) {
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await welcomeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' }, { quoted: fake });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'goodbye':
                if (isGroup) {
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await goodbyeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' }, { quoted: fake });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'chatbot':
                const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
                if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*' }, { quoted: fake });
                    return;
                }
                await handleChatbotCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'topmembers':
                topMembers(sock, chatId, isGroup, message);
                commandExecuted = true;
                break;
                
            case 'pmblocker':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner or sudo can use pmblocker.' }, { quoted: fake });
                    commandExecuted = true;
                    break;
                }
                await pmblockerCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'anticall':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use anticall.' }, { quoted: fake });
                    break;
                }
                await anticallCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'setcallmsg':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use setcallmsg.' }, { quoted: fake });
                    break;
                }
                await setcallmsgCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'groupanticall':
            case 'ganticall':
                await groupanticallCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'startupwelcome':
            case 'startupmsg':
                await startupWelcomeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'broadcast':
            case 'bc':
                await broadcastCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'areact':
            case 'autoreact':
            case 'autoreaction':
                const isOwnerOrSudo = message.key.fromMe || senderIsSudo;
                await handleAreactCommand(sock, chatId, message, isOwnerOrSudo);
                commandExecuted = true;
                break;

            // === MEDIA & ENTERTAINMENT ===
            case 'sticker':
            case 's':
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'simage':
            case 'toimage':
                {
                    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (quotedMessage?.stickerMessage) {
                        await simageCommand(sock, quotedMessage, chatId);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the toimage command to convert it.' }, { quoted: fake });
                    }
                    commandExecuted = true;
                }
                break;
                
            case 'attp':
                await attpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'emojimix':
            case 'emix':
                await emojimixCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'tg':
            case 'tgsticker':
                await stickerTelegramCommand(sock, chatId, message);            
                commandExecuted = true;
                break;
                
            case 'crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'qc':
            case 'qcstc':
            case 'qcstick':
            case 'quotesticker':
                await qcCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'tts':
                const ttsText = fullArgs;
                await ttsCommand(sock, chatId, ttsText, message);
                commandExecuted = true;
                break;
                
            case 'meme':
                await memeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'song':
            case 'mp3':
                await songCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'video':
                await videoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'play':
                await playCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'ytmp4':
            case 'ytv':
                await ytplayCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'ytaudio':
            case 'ytplay':
                await ytsongCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'yts':
            case 'ytsearch':
                await ytsCommand(sock, chatId, senderId, message, userMessage);
                commandExecuted = true;
                break;
                
            case 'tiktok':
            case 'tt':
                await tiktokCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'tiktokaudio':
            case 'ttaudio':
            case 'ttm':
            case 'tiktokmusic':
                await tiktokaudioCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'spotify': 
                await spotifyCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'shazam':
            case 'whatsong':
            case 'find':
                await shazamCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'instagram':
            case 'insta':
            case 'ig':
                await instagramCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'igs':
                await igsCommand(sock, chatId, message, true);
                commandExecuted = true;
                break;
                
            case 'fb':
            case 'facebook':
                await facebookCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'movie':
                await movieCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'animu':
                await animeCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
                
            case 'nom':
            case 'poke':
            case 'cry':
            case 'hug':
            case 'pat':
            case 'kiss':
            case 'wink':
            case 'facepalm':
            case 'face-palm':
            case 'loli':
                let animeSub = command;
                if (animeSub === 'facepalm') animeSub = 'face-palm';
                await animeCommand(sock, chatId, message, [animeSub]);
                commandExecuted = true;
                break;
                
            case 'pies':
                await piesCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
                
            case userMessage === '.china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.hijab':
                await piesAlias(sock, chatId, message, 'hijab');
                commandExecuted = true;
                break;
                
            case 'imagine':
            case 'flux':
            case 'dalle': 
                await imagineCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'sora':
                await soraCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'mediafire':
                await mediafireCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === AI & TOOLS ===
            case 'ai':
                await gpt4Command(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'gpt':
            case 'gemini':
                await aiCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'wormgpt':
                await wormgptCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'copilot':
                await copilotCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'deepseek':
                await deepseekCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'llama':
                await llamaCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'mixtral':
                await mixtralCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'qwen':
                await qwenCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'claude':
                await claudeCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'gpt4o':
                await gpt4oCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'mistral':
                await mistralCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'gemma':
                await gemmaCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            case 'translate':
            case 'trt':
                await handleTranslateCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'ss':
            case 'ssweb':
            case 'screenshot':
                await handleSsCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            // === NEW AI COMMANDS ===
            case 'davex':
                await wolfCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'dalle2':
                await dalleCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'blackbox':
            case 'bb':
                await blackboxCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'bard':
                await bardCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'aivideo':
            case 'avideo':
                await aivideoCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            // === GREETINGS ===
            case 'goodmorning':
            case 'gm':
                await goodmorningCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case 'goodafternoon':
            case 'ga':
                await goodafternoonCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case 'goodevening':
            case 'ge':
                await goodeveningCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === DESIGN TOOLS ===
            case 'logo':
                await logoCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'carbon':
                await carbonCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            // === MEDIA CONVERSION ===
            case 'tomp4':
            case 'tovideo':
                await tomp4Command(sock, chatId, message);
                commandExecuted = true;
                break;
            case 'togif':
                await togifCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case 'toimg':
            case 'toimage':
                await toimgCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === ETHICAL HACKING ===
            case 'iplookup':
            case 'ip':
                await ipLookupCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'whois':
                await whoIsCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'reverseip':
                await reverseipCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            // === SEARCH ===
            case 'pinterest':
            case 'pin':
                await pinterestCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;

            // === GAMES ===
            case 'rps':
                await rpsCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'slot':
            case 'slots':
                await slotCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === OWNER TOOLS ===
            case 'resetmenuimage':
                await resetMenuImageCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'google':
            case 'search':
            case 'g':
                await googleCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'git':
            case 'github':
            case 'sc':
            case 'script':
            case 'repo':
                await githubCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'gitclone':
                await gitcloneCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'apk':
                await apkCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'tourl':
            case 'url':
                await urlCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'shorten':
            case 'shortlink':
            case 'tinyurl':
            case 'short':
                const urlText = userMessage.slice(command.length).trim();
                await shortenUrlCommand(sock, chatId, message, urlText);
                commandExecuted = true;
                break;
                
            case 'analyze':
            case 'analysis':
            case 'analyzer':
                await analyzeCommand(sock, chatId, message, fullArgs, prefix);
                commandExecuted = true;
                break;
                
            case 'encrypt':
                await encryptCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'fetch':
            case 'inspect':
                await fetchCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'removebg':
            case 'rmbg':
            case 'nobg':
                await removebgCommand.exec(sock, message, args);
                commandExecuted = true;
                break;
                
            case 'remini':
            case 'enhance':
            case 'upscale':
                await reminiCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
                
            case 'night':
                await nightCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'pretty':
            case 'beautiful':
                await prettyCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'ugly':
                await uglyCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;
                
            case 'blur':
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                await blurCommand(sock, chatId, message, quotedMessage);
                commandExecuted = true;
                break;
                
            case 'textmaker':
                // Handle all textmaker styles
                const style = command;
                if ([
                    'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light', 
                    'neon', 'devil', 'purple', 'thunder', 'leaves', '1917', 
                    'arena', 'hacker', 'sand', 'blackpink', 'glitch', 'fire'
                ].includes(style)) {
                    await textmakerCommand(sock, chatId, message, userMessage, style);
                }
                commandExecuted = true;
                break;
                
            case 'character':
                await characterCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'waste':
                await wastedCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setpp':
                await setProfilePicture(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'getpp':
                await getppCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'tovv':
            case 'vo':
            case 'viewonce':
                await viewOnceCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'toaudio':
            case 'tomp3':
                await toAudioCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setstatus':
            case 'setgstatus':
            case 'togroupstatus':
            case 'tosgroup':
                await setGroupStatusCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case 'viewstatus':
                await viewStatusCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'img':
            case 'image':
                await imageCommand(sock, chatId, message, senderId, userMessage);
                commandExecuted = true;
                break;
                
            case 'hijack':
                await hijackCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;

            // === GAMES & FUN ===
            case 'hangman':
                startHangman(sock, chatId);
                commandExecuted = true;
                break;
                
            case 'guess':
                const guessedLetter = args[0];
                if (guessedLetter) {
                    guessLetter(sock, chatId, guessedLetter);
                } else {
                    sock.sendMessage(chatId, { text: `Please guess a letter using ${prefix}guess <letter>` }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'trivia':
                startTrivia(sock, chatId);
                commandExecuted = true;
                break;
                
            case 'answer':
                const answer = fullArgs;
                if (answer) {
                    answerTrivia(sock, chatId, answer);
                } else {
                    sock.sendMessage(chatId, { text: `Please provide an answer using ${prefix}answer <answer>` }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'ttt':
            case 'tictactoe':
                await tictactoeCommand(sock, chatId, senderId, fullArgs);
                commandExecuted = true;
                break;
                
            case 'move':
                const position = parseInt(args[0]);
                if (isNaN(position)) {
                    await sock.sendMessage(chatId, { 
                        text: 'Please provide a valid position number for Tic-Tac-Toe move.', 
                         
                    });
                } else {
                    await handleTicTacToeMove(sock, chatId, senderId, position);
                }
                commandExecuted = true;
                break;
                
            case 'connect4':
            case 'cf':
                await connectFourCommand(sock, chatId, senderId, fullArgs);
                commandExecuted = true;
                break;
                
            case 'drop':
                const column = parseInt(args[0]);
                if (isNaN(column)) {
                    await sock.sendMessage(chatId, { 
                        text: 'Please provide a valid column number (1-7) for Connect Four move.', 
                         
                    });
                } else {
                    const handled = await handleConnectFourMove(sock, chatId, senderId, column.toString());
                    if (!handled) {
                        await sock.sendMessage(chatId, { 
                            text: 'You are not in an active Connect Four game. Start one with .connectfour',
                            
                        });
                    }
                }
                commandExecuted = true;
                break;
                
            case 'tttai':
            case 'tictactoeai':
                await tictactoeAICommand(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'tttjoin':
                await handleTicTacToeJoin(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'tttend':
                await tictactoeEndCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'wcg':
            case 'wordchain':
                await wcgCommand(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'wcgai':
            case 'wordchainai':
                await wcgAICommand(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'wcgjoin':
                await handleWcgJoin(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'wcgbegin':
            case 'wcgstart':
                await wcgBeginCommand(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'wcgend':
                await wcgEndCommand(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'wcgscores':
                await wcgScoresCommand(sock, chatId, senderId, fake);
                commandExecuted = true;
                break;

            case 'dice':
                await diceCommand(sock, chatId, senderId, fullArgs);
                commandExecuted = true;
                break;

            case 'diceai':
                await diceAICommand(sock, chatId, senderId, fullArgs);
                commandExecuted = true;
                break;

            case 'dicejoin':
                await handleDiceJoin(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'dicebegin':
            case 'dicestart':
                await handleDiceBegin(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'roll':
                await handleDiceRoll(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'diceend':
                await diceEndCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;

            case 'forfeit':
            case 'surrender':
                const cfHandled = await handleConnectFourMove(sock, chatId, senderId, 'forfeit');
                const tttHandled = await handleTicTacToeMove(sock, chatId, senderId, 'forfeit');

                if (!cfHandled && !tttHandled) {
                    await sock.sendMessage(chatId, { 
                        text: 'You are not in any active game. Start one with .ttt or .connectfour',
                        
                    });
                }
                commandExecuted = true;
                break;
                
            case 'joke':
                await jokeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'quote':
                await quoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'fact':
                await factCommand(sock, chatId, message, message);
                commandExecuted = true;
                break;
                
            case 'compliment':
                await complimentCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'insult':
                await insultCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case '8ball':
                const question = fullArgs;
                await eightBallCommand(sock, chatId, question);
                commandExecuted = true;
                break;
                
            case 'lyrics':
                const songTitle = fullArgs;
                await lyricsCommand(sock, chatId, songTitle, message);
                commandExecuted = true;
                break;
                
            case 'dare':
                await dareCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'truth':
                await truthCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'flirt':
                await flirtCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'ship':
                await shipCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'simp':
                const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                commandExecuted = true;
                break;
                
            case 'stupid':
            case 'itssostupid':
            case 'iss':
                const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, args);
                commandExecuted = true;
                break;
                
            case 'pair':
                await pairCommand(sock, chatId, fullArgs, message);
                commandExecuted = true;
                break;

            // === UTILITIES ===
            case 'delete':
            case 'del':
                await deleteCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
                
            case 'weather':
                const city = fullArgs;
                if (city) {
                    await weatherCommand(sock, chatId, message, city);
                } else {
                    await sock.sendMessage(chatId, { text: `Please specify a city, e.g., ${prefix}weather London` }, { quoted: fake });
                }
                commandExecuted = true;
                break;
                
            case 'news':
                await newsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'channelid':
            case 'idch':
            case 'checkidch':
                await channelidCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'chanelid':
                await chaneljidCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'vcf':
            case 'vcard':
                await vcfCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'wallpaper':
                await wallpaperCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'take':
                await takeCommand(sock, chatId, message, args);
                commandExecuted = true;
                break;
            case 'tosgroup':
            case 'setgstatus':
            case 'togroupstatus':
                await setGroupStatusCommand(sock, chatId, message);
                commandExecuted = true;
                break;   
            case 'cleartemp':
                await clearTmpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'tostatus':
            case 'tos':
                await tostatusCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'save':
            case 'nitumie':
            case 'tuma':
            case 'ntumie':
            case 'li':
            case 'send':
            case 'get':
            case 'status':
                await saveStatusCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'vv':
            case 'wow':
            case '☺️':
            case 'nice':
            case '😁':
            case 'vv2':
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { 
                        text: 'This command is only available for the owner or sudo!' 
                    }, { quoted: fake });
                    return;
                }
                await vv2Command(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'vn':
            case 'voicenote':
                await vnCommand(sock, chatId, message, fullArgs, prefix);
                commandExecuted = true;
                break;

            // === MISC COMMANDS ===
            case 'heart':
                await miscCommand(sock, chatId, message, ['heart', ...args]);
                commandExecuted = true;
                break;
                
            case 'horny':
                await miscCommand(sock, chatId, message, ['horny', ...args]);
                commandExecuted = true;
                break;
                
            case 'circle':
                await miscCommand(sock, chatId, message, ['circle', ...args]);
                commandExecuted = true;
                break;
                
            case 'lgbtq':
                await miscCommand(sock, chatId, message, ['lgbtq', ...args]);
                commandExecuted = true;
                break;
                
            case 'lolice':
                await miscCommand(sock, chatId, message, ['lolice', ...args]);
                commandExecuted = true;
                break;
                
            case 'simpcard':
                await miscCommand(sock, chatId, message, ['simpcard', ...args]);
                commandExecuted = true;
                break;
                
            case 'misc':
                await miscCommand(sock, chatId, message, ['misc', ...args]);
                commandExecuted = true;
                break;
                
            case 'its-so-stupid':
                await miscCommand(sock, chatId, message, ['its-so-stupid', ...args]);
                commandExecuted = true;
                break;
                
            case 'namecard':
                await miscCommand(sock, chatId, message, ['namecard', ...args]);
                commandExecuted = true;
                break;
                
            case 'oogway2':
            case 'oogway':
                const sub = command === 'oogway2' ? 'oogway2' : 'oogway';
                await miscCommand(sock, chatId, message, [sub, ...args]);
                commandExecuted = true;
                break;
                
            case 'tweet':
                await miscCommand(sock, chatId, message, ['tweet', ...args]);
                commandExecuted = true;
                break;
                
            case 'ytcomment':
                await miscCommand(sock, chatId, message, ['youtube-comment', ...args]);
                commandExecuted = true;
                break;
                
            case 'comrade':
            case 'gay':
            case 'glass':
            case 'jail':
            case 'passed':
            case 'triggered':
                await miscCommand(sock, chatId, message, [command, ...args]);
                commandExecuted = true;
                break;
                
            case 'goodnight':
            case 'lovenight':
            case 'gn':
                await goodnightCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'shayari':
            case 'shayri':
                await shayariCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'roseday':
                await rosedayCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === SPORTS ===
            case 'epl':
            case 'eplstandings':
            case 'premierleague':
                await eplStandingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'bundesliga':
            case 'germanleague':
            case 'bl1':
                await bundesligaStandingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'laliga':
            case 'laligastandings':
            case 'spanishleague':
            case 'laligatable':
                await laligaStandingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'matches':
            case 'todaymatches':
            case 'fixtures':
            case 'games':
            case 'todaysgames':
                await matchesCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'seriea':
            case 'serie-a':
            case 'italianleague':
            case 'serieatable':
            case 'serieastandings':
                await serieAStandingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'ligue1':
            case 'ligueun':
            case 'frenchleague':
            case 'ligueone':
                await ligue1StandingsCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === RELIGIOUS ===
            case 'bible':
                await bibleCommand(sock, chatId, message, fullArgs, prefix);
                commandExecuted = true;
                break;
                
            case 'biblelist':
            case 'listbible':
                await bibleListCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'quran':
            case 'surah':
                await quranCommand(sock, chatId, message, fullArgs);
                commandExecuted = true;
                break;

            // === BOT CONFIG ===
            case 'setbotconfig':
                await setbotconfigCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setbotname':
                await setbotnameCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case 'setmenuimage':
                await setmenuimageCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            // === TEXTMAKER STYLES (individual commands) ===
            case 'metallic':
            case 'ice':
            case 'snow':
            case 'impressive':
            case 'matrix':
            case 'light':
            case 'neon':
            case 'devil':
            case 'purple':
            case 'thunder':
            case 'leaves':
            case '1917':
            case 'arena':
            case 'hacker':
            case 'sand':
            case 'blackpink':
            case 'glitch':
            case 'fire':
                await textmakerCommand(sock, chatId, message, userMessage, command);
                commandExecuted = true;
                break;

            default:
                // If no command matched, check for chatbot response
                if (isGroup && userMessage) {
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
                commandExecuted = false;
                break;
        }

        // Add reaction to commands
        if (userMessage.startsWith('.')) {
            await addCommandReaction(sock, message);
        }

    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        console.error(error.stack);
        try {
            const chatId = message?.key?.remoteJid;
            if (chatId) {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to process command!',
                    ...channelInfo
                });
            }
        } catch (err) {
            console.error('Failed to send error message:', err.message);
        }
    }
}

// ========== GROUP PARTICIPANT UPDATE HANDLER ==========
const recentAntiActions = new Set();
const processedEvents = new Map(); // Track processed events to prevent duplicates

function participantToJid(p) {
    if (typeof p === 'string') return p;
    if (p && p.id) return p.id;
    return String(p);
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, action, author } = update;
        const participants = (update.participants || []).map(participantToJid);

        if (!id.endsWith('@g.us')) return;

        // Create unique event ID to prevent duplicates
        const eventId = `${action}:${id}:${participants.sort().join(',')}:${author || 'unknown'}`;
        
        // Check if we've processed this exact event in the last 3 seconds
        if (processedEvents.has(eventId)) {
            const lastProcessed = processedEvents.get(eventId);
            if (Date.now() - lastProcessed < 3000) {
                return; // Skip duplicate event
            }
        }
        
        // Mark as processed
        processedEvents.set(eventId, Date.now());
        
        // Clean up old entries every minute
        setTimeout(() => {
            for (const [key, timestamp] of processedEvents.entries()) {
                if (Date.now() - timestamp > 10000) { // Remove after 10 seconds
                    processedEvents.delete(key);
                }
            }
        }, 60000);

        const resolvedParticipants = [];
        for (const p of participants) {
            if (isLidJid(p)) {
                try {
                    const resolved = await resolvePhoneFromLid(sock, p);
                    resolvedParticipants.push(resolved || p.split('@')[0].split(':')[0]);
                } catch {
                    resolvedParticipants.push(p.split('@')[0].split(':')[0]);
                }
            } else {
                resolvedParticipants.push(p.split('@')[0].split(':')[0]);
            }
        }

        let resolvedAuthor = author ? author.split('@')[0].split(':')[0] : 'System';
        if (author && isLidJid(author)) {
            try {
                const resolved = await resolvePhoneFromLid(sock, author);
                if (resolved) resolvedAuthor = resolved;
            } catch {}
        }

        console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('┌───────────────── GROUP EVENT ───────────────┐'));
        console.log(chalk.bgHex('#0a0a0a').hex('#ff00ff')(`   ⚡ ${glitchText('GROUP UPDATE')}`));
        console.log(chalk.bgHex('#0a0a0a').hex('#00ffff')('├─────────────────────────────────────────────┤'));
        
        const groupEntries = [
            ['🕐', 'TIME', new Date().toLocaleString()],
            ['📌', 'ACTION', action.toUpperCase()],
            ['👥', 'GROUP', id.split('@')[0]],
            ['👤', 'PARTICIPANTS', resolvedParticipants.join(', ')],
            ['👑', 'AUTHOR', resolvedAuthor]
        ];

        groupEntries.forEach(([icon, label, value]) => {
            console.log(
                chalk.bgHex('#0a0a0a').hex('#ffff00')(`   ${icon} `) +
                chalk.bgHex('#0a0a0a').hex('#00ff00')(`${label}:`) +
                chalk.bgHex('#0a0a0a').hex('#ffffff')(` ${value}`)
            );
        });
        
        console.log(chalk.bgHex('#0a0a0a').hex('#00ff00')('└─────────────────────────────────────────────┘\n'));

        console.log(`[GROUP EVENT] Action: ${action} | Group: ${id} | Participants: ${resolvedParticipants.join(', ')} | Author: ${resolvedAuthor}`);

        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // Keep default as public
        }

        // Handle ANTIKICK (when someone is removed/kicked)
        if (action === 'remove') {
            const antikickConfig = getAntikickConfig ? getAntikickConfig(id) : null;
            if (antikickConfig && antikickConfig.enabled) {
                await handleAntikick(sock, id, participants);
            }

            // Also handle goodbye messages
            await handleLeaveEvent(sock, id, participants);
            return;
        }

        const participantKey = participants.sort().join(',');
        const eventKey = `${action}:${id}:${participantKey}`;

        if (recentAntiActions.has(eventKey)) {
            console.log(`[ANTI-LOOP] Skipping ${action} event for ${participantKey} (cooldown active)`);
            return;
        }

        // Handle ANTIPROMOTE (when someone is promoted)
        if (action === 'promote') {
            const antiConfig = getGroupConfig ? getGroupConfig(id, 'antipromote') : null;
            if (antiConfig?.enabled) {
                recentAntiActions.add(`demote:${id}:${participantKey}`);
                setTimeout(() => recentAntiActions.delete(`demote:${id}:${participantKey}`), 15000);
            }

            const antipromoteResult = await handleAntipromote(sock, id, participants, author);

            if (!antipromoteResult && isPublic) {
                await handlePromotionEvent(sock, id, participants, author);
            }
            return;
        }

        // Handle ANTIDEMOTE (when someone is demoted)
        if (action === 'demote') {
            const antiConfig = getGroupConfig ? getGroupConfig(id, 'antidemote') : null;
            if (antiConfig?.enabled) {
                recentAntiActions.add(`promote:${id}:${participantKey}`);
                setTimeout(() => recentAntiActions.delete(`promote:${id}:${participantKey}`), 15000);
            }

            const antidemoteResult = await handleAntidemote(sock, id, participants, author);

            if (!antidemoteResult && isPublic) {
                await handleDemotionEvent(sock, id, participants, author);
            }
            return;
        }

        // Handle WELCOME (when someone joins)
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
            return;
        }

    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
        console.error(error.stack);
    }
}

// ========== EXPORTS ==========
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    },
    handleIncomingCall: async (sock, call) => {
        await handleIncomingCall(sock, call);
    },
    handleGroupCall: async (sock, call) => {
        await handleGroupCall(sock, call);
    },
    handleAntieditUpdate: handleMessageUpdate,
    initPresenceOnConnect
};