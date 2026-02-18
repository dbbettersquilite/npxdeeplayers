const config = require('./config');
require('dotenv').config();

const fs = require('fs')
const chalk = require('chalk').default || require('chalk')
const path = require('path')
const axios = require('axios')
const os = require('os')
const PhoneNumber = require('awesome-phonenumber')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay 
} = require("@whiskeysockets/baileys")

const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')

// --- OPTIMIZATION: Smaller cache sizes for low memory ---
const MSG_CACHE_SIZE = 20; // Reduced from 30
const MSG_AGE_HOURS = 3; // Reduced from 6
const MEMORY_THRESHOLD = 250; // Lower threshold for cleanup (was 350)
const CRITICAL_MEMORY = 320; // Lower critical threshold (was 420)
const SESSION_CLEANUP_HOURS = 24; // More aggressive session cleanup (was 48)

// --- LOGGING (minimal for performance) ---
function log(message, color = 'white', isError = false) {
    // Skip detailed logs when memory is high
    const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (memMB > MEMORY_THRESHOLD && !isError && !message.includes('Connected')) {
        return; // Skip non-critical logs when memory is high
    }
    
    const prefix = chalk.magenta.bold('[ DAVE - X ]');
    const logFunc = isError ? console.error : console.log;
    const coloredMessage = chalk[color](message);
    if (message.includes('\n') || message.includes('════')) {
        logFunc(prefix, coloredMessage);
    } else {
         logFunc(`${prefix} ${coloredMessage}`);
    }
}

// --- OPTIMIZATION: Faster noise filtering with Set ---
const noisyPatterns = new Set([
    'Failed to decrypt', 'Bad MAC', 'Session error', 'decryptWithSessions',
    'doDecryptWhisperMessage', 'session_cipher', 'retryCount exceeded',
    'Closing stale open', 'Decryption failed', 'SignalProtocolStore',
    'PreKeyWhisperMessage', 'Connection Closed', 'closing session',
    'recv ', 'stream:', 'handling frame', 'query:', 'prekey',
    'session record', 'identity key', 'sender key', 'ciphertext',
    'got notification', 'msg:ack', 'writing data', 'got ack',
    'processing message', 'updating prekeys', 'next pre key',
    'ws open', 'ws close', 'ws error', 'opened ws', 'frame buffered',
    'connect:', 'pairing configured', 'noise', 'handshake'
]);

function isNoisyLog(...args) {
    const str = args.map(a => {
        if (a instanceof Error) return a.message;
        return typeof a === 'string' ? a : '';
    }).join(' ');
    // Faster check with Set.has() instead of array includes
    for (const pattern of noisyPatterns) {
        if (str.includes(pattern)) return true;
    }
    return false;
}

// --- OPTIMIZATION: Streamlined console methods ---
const _origConsoleLog = console.log;
const _origConsoleError = console.error;
const _origConsoleWarn = console.warn;

console.log = function(...args) {
    if (isNoisyLog(...args)) return;
    _origConsoleLog.apply(console, args);
};

console.error = function(...args) {
    if (isNoisyLog(...args)) return;
    _origConsoleError.apply(console, args);
};

console.warn = function(...args) {
    if (isNoisyLog(...args)) return;
    _origConsoleWarn.apply(console, args);
};

// --- GLOBALS ---
global.isBotConnected = false;
global.errorRetryCount = 0;
global.lastMemoryCheck = Date.now();

// --- DYNAMIC IMPORTS ---
let smsg, handleMessages, handleGroupParticipantUpdate, handleStatus, store, settings;

// --- OPTIMIZATION: Reduced message backup ---
const MESSAGE_STORE_FILE = path.join(__dirname, 'message_backup.json');
const SESSION_ERROR_FILE = path.join(__dirname, 'sessionErrorCount.json');
global.messageBackup = {};

const MAX_BACKUP_CHATS = 15; // Reduced from 30
const MAX_BACKUP_MESSAGES_PER_CHAT = 3; // Reduced from 5
const MAX_BACKUP_AGE = 3 * 60 * 60; // Reduced from 6 hours

function loadStoredMessages() {
    try {
        if (fs.existsSync(MESSAGE_STORE_FILE)) {
            const data = fs.readFileSync(MESSAGE_STORE_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            return trimMessageBackup(parsed);
        }
    } catch (error) {
        // Silent fail
    }
    return {};
}

function trimMessageBackup(backup) {
    const now = Math.floor(Date.now() / 1000);
    const trimmed = {};
    const chatIds = Object.keys(backup);
    const recentChats = chatIds.slice(-MAX_BACKUP_CHATS);
    for (const chatId of recentChats) {
        const msgs = backup[chatId];
        if (!msgs || typeof msgs !== 'object') continue;
        const msgIds = Object.keys(msgs);
        const kept = {};
        const recent = msgIds.slice(-MAX_BACKUP_MESSAGES_PER_CHAT);
        for (const msgId of recent) {
            const msg = msgs[msgId];
            if (msg && msg.timestamp && (now - msg.timestamp) <= MAX_BACKUP_AGE) {
                kept[msgId] = msg;
            }
        }
        if (Object.keys(kept).length > 0) {
            trimmed[chatId] = kept;
        }
    }
    return trimmed;
}

let _messageBackupDirty = false;
function saveStoredMessages(data) {
    _messageBackupDirty = true;
}
function _flushMessageBackup() {
    if (!_messageBackupDirty) return;
    try {
        global.messageBackup = trimMessageBackup(global.messageBackup);
        fs.writeFileSync(MESSAGE_STORE_FILE, JSON.stringify(global.messageBackup));
        _messageBackupDirty = false;
    } catch (error) {
        // Silent fail
    }
}
setInterval(_flushMessageBackup, 120000); // Increased to 2 minutes (was 1 min)

function getMemoryMB() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

// --- OPTIMIZATION: More aggressive memory cleanup ---
function memoryCleanup() {
    const now = Date.now();
    // Check every 30 seconds but only log every 2 minutes
    if (now - global.lastMemoryCheck < 30000) return;
    global.lastMemoryCheck = now;
    
    const memMB = getMemoryMB();
    
    if (memMB > MEMORY_THRESHOLD) {
        log(`[MEM] ${memMB}MB - cleaning up`, 'yellow');
        global.messageBackup = trimMessageBackup(global.messageBackup);
        
        // Clear Node.js cache if needed
        if (memMB > CRITICAL_MEMORY) {
            log(`[MEM] Critical: ${memMB}MB - clearing caches`, 'red');
            global.messageBackup = {};
            
            // Clear require cache for non-essential modules
            const keepModules = new Set(['./main', './settings', './config']);
            for (const module in require.cache) {
                if (!keepModules.has(module) && module.includes('commands/')) {
                    delete require.cache[module];
                }
            }
            
            if (typeof store !== 'undefined' && store && store.messages) {
                store.messages = {};
            }
        }
        
        if (global.gc) global.gc();
    }
}
setInterval(memoryCleanup, 30000); // Check every 30 seconds (was 60)

// --- ERROR COUNTER (unchanged) ---
function loadErrorCount() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            const data = fs.readFileSync(SESSION_ERROR_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        log(`Error loading error count: ${error.message}`, 'red', true);
    }
    return { count: 0, last_error_timestamp: 0 };
}

function saveErrorCount(data) {
    try {
        fs.writeFileSync(SESSION_ERROR_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        log(`Error saving error count: ${error.message}`, 'red', true);
    }
}

function deleteErrorCountFile() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            fs.unlinkSync(SESSION_ERROR_FILE);
        }
    } catch (e) {}
}

// --- OPTIMIZATION: Faster session cleanup ---
function clearSessionFiles() {
    try {
        log('🗑️ Clearing session folder...', 'blue');
        rmSync(sessionDir, { recursive: true, force: true, maxRetries: 3 });
        if (fs.existsSync(loginFile)) fs.unlinkSync(loginFile);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        log('Session files cleaned.', 'green');
    } catch (e) {
        log(`Failed to clear session: ${e.message}`, 'red', true);
    }
}

// --- OPTIMIZATION: Faster message cleanup ---
function cleanupOldMessages() {
    let storedMessages = loadStoredMessages();
    let now = Math.floor(Date.now() / 1000);
    const maxMessageAge = 12 * 60 * 60; // Reduced from 24 hours
    let cleanedMessages = {};
    
    for (let chatId in storedMessages) {
        let newChatMessages = {};
        for (let messageId in storedMessages[chatId]) {
            let message = storedMessages[chatId][messageId];
            if (now - message.timestamp <= maxMessageAge) {
                newChatMessages[messageId] = message;
            }
        }
        if (Object.keys(newChatMessages).length > 0) {
            cleanedMessages[chatId] = newChatMessages;
        }
    }
    saveStoredMessages(cleanedMessages);
}
setInterval(cleanupOldMessages, 2 * 60 * 60 * 1000); // Run every 2 hours (was 1 hour)

// --- OPTIMIZATION: Faster junk cleanup with batch delete ---
function cleanupJunkFiles(botSocket) {
    const memMB = getMemoryMB();
    if (memMB < 200) return; // Skip if memory is fine
    
    let directoryPath = path.join();
    fs.readdir(directoryPath, async function (err, files) {
        if (err) return;
        const junkExtensions = new Set(['.gif', '.png', '.mp3', '.mp4', '.opus', '.jpg', '.webp', '.webm', '.zip']);
        const filteredArray = files.filter(item => junkExtensions.has(path.extname(item)));
        
        if (filteredArray.length > 10) { // Only notify if more than 10 files
            if (botSocket && botSocket.user && botSocket.user.id) {
                botSocket.sendMessage(botSocket.user.id.split(':')[0] + '@s.whatsapp.net', { 
                    text: `Cleaned ${filteredArray.length} junk files` 
                }).catch(() => {});
            }
            
            // Batch delete for speed
            filteredArray.forEach(function (file) {
                const filePath = path.join(directoryPath, file);
                try {
                    if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch(e) {}
            });
        }
    });
}
setInterval(() => cleanupJunkFiles(global.sock), 15 * 60 * 1000); // Run every 15 minutes (was 10)

// --- PATHS ---
global.botname = "DAVE X"
global.themeemoji = "•"
const pairingCode = !!global.phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(resolve => rl.question(text, resolve)) : Promise.resolve(settings?.ownerNumber || global.phoneNumber)

const sessionDir = path.join(__dirname, 'session')
const credsPath = path.join(sessionDir, 'creds.json')
const loginFile = path.join(sessionDir, 'login.json')
const envPath = path.join(process.cwd(), '.env');

// --- LOGIN PERSISTENCE ---
async function saveLoginMethod(method) {
    await fs.promises.mkdir(sessionDir, { recursive: true });
    await fs.promises.writeFile(loginFile, JSON.stringify({ method }, null, 2));
}

async function getLastLoginMethod() {
    if (fs.existsSync(loginFile)) {
        const data = JSON.parse(fs.readFileSync(loginFile, 'utf-8'));
        return data.method;
    }
    return null;
}

function sessionExists() {
    return fs.existsSync(credsPath);
}

// --- OPTIMIZATION: Faster session format check ---
async function checkAndHandleSessionFormat() {
    const sessionId = process.env.SESSION_ID;
    if (sessionId && sessionId.trim() !== '') {
        if (!sessionId.trim().startsWith('DAVE-AI') && !sessionId.trim().startsWith('DAVE-X')) {
            log('[ERROR]: Invalid SESSION_ID in .env', 'red');
            log('[SESSION ID] MUST start with "DAVE-AI" or "DAVE-X".', 'red');
            
            try {
                let envContent = fs.readFileSync(envPath, 'utf8');
                envContent = envContent.replace(/^SESSION_ID=.*$/m, 'SESSION_ID=');
                fs.writeFileSync(envPath, envContent);
            } catch (e) {}
            
            await delay(5000); // Reduced from 20 seconds
            process.exit(1);
        }
    }
}

// --- LOGIN METHOD ---
async function getLoginMethod() {
    const lastMethod = await getLastLoginMethod();
    if (lastMethod && sessionExists()) {
        log(`Last login method: ${lastMethod}. Using it automatically.`, 'yellow');
        return lastMethod;
    }

    if (!sessionExists() && fs.existsSync(loginFile)) {
        log(`Session files missing. Removing old login preference.`, 'yellow');
        fs.unlinkSync(loginFile);
    }

    const envPhone = process.env.PHONE_NUMBER?.replace(/[^0-9]/g, '');
    if (envPhone && envPhone.length >= 10) {
        log(`Using phone number from environment: +${envPhone}`, 'green');
        global.phoneNumber = envPhone;
        await saveLoginMethod('number');
        return 'number';
    }

    if (!process.stdin.isTTY) {
        log("No session found. Set SESSION_ID or PHONE_NUMBER environment variable.", 'red');
        log("Waiting 30 seconds before exit...", 'yellow');
        await delay(30000);
        process.exit(1);
    }

    log("", 'white');
    log("╔══════════════════════════════════════╗", 'cyan');
    log("║        LOGIN METHOD SELECTION         ║", 'cyan');
    log("╠══════════════════════════════════════╣", 'cyan');
    log("║  1) Enter WhatsApp Number (Pair Code) ║", 'cyan');
    log("║  2) Paste Session ID                  ║", 'cyan');
    log("╚══════════════════════════════════════╝", 'cyan');
    log("", 'white');

    let choice = await question("Enter option number (1 or 2): ");
    choice = choice.trim();

    if (choice === '1') {
        log("Enter your WhatsApp number in international format.", 'yellow');
        log("Examples: 254712345678, 12025551234, 447911123456", 'blue');
        log("Do NOT include + sign or spaces.", 'yellow');
        let phone = await question(chalk.bgBlack(chalk.greenBright(`Your WhatsApp number: `)));
        phone = phone.replace(/[^0-9]/g, '');
        if (phone.length < 10 || phone.length > 15) {
            log('Invalid number. Must be 10-15 digits in international format.', 'red');
            return getLoginMethod();
        }
        global.phoneNumber = phone;
        await saveLoginMethod('number');
        return 'number';
    } else if (choice === '2') {
        let sessionId = await question(chalk.bgBlack(chalk.greenBright(`Paste your Session ID: `)));
        sessionId = sessionId.trim();
        if (!sessionId.includes("DAVE-AI:~") && !sessionId.includes("DAVE-X:~")) {
            log("Invalid Session ID format! Must contain 'DAVE-AI:~' or 'DAVE-X:~'.", 'red');
            process.exit(1);
        }
        global.SESSION_ID = sessionId;
        await saveLoginMethod('session');
        return 'session';
    } else {
        log("Invalid option! Please choose 1 or 2.", 'red');
        return getLoginMethod();
    }
}

// --- OPTIMIZATION: Faster session download ---
async function downloadSessionData() {
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true });
        if (!fs.existsSync(credsPath) && global.SESSION_ID) {
            let base64Data = global.SESSION_ID;
            if (base64Data.includes("DAVE-AI:~")) base64Data = base64Data.split("DAVE-AI:~")[1];
            else if (base64Data.includes("DAVE-X:~")) base64Data = base64Data.split("DAVE-X:~")[1];
            const sessionData = Buffer.from(base64Data, 'base64');
            await fs.promises.writeFile(credsPath, sessionData);
            log(`Session saved.`, 'green');
        }
    } catch (err) { 
        log(`Error downloading session: ${err.message}`, 'red', true); 
    }
}

// --- PAIRING CODE (unchanged) ---
async function requestPairingCode(socket) {
    try {
        log("Requesting pairing code...", 'yellow');
        await delay(2000);
        let code = await socket.requestPairingCode(global.phoneNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        log(chalk.bgGreen.black(`\nYour Pairing Code: ${code}\n`), 'white');
        log(`
Please enter this code in WhatsApp app:
1. Open WhatsApp
2. Go to Settings => Linked Devices
3. Tap "Link a Device"
4. Enter the code shown above
        `, 'blue');
        return true;
    } catch (err) {
        log(`Failed to get pairing code: ${err.message}`, 'red', true);
        return false;
    }
}

// --- OPTIMIZATION: Faster welcome message with reduced delays ---
async function sendWelcomeMessage(XeonBotInc) {
    if (global.isBotConnected) return;

    global.isBotConnected = true;
    global.sock = XeonBotInc;
    log('Bot is now LIVE', 'green');

    try {
        const { getPrefix } = require('./commands/setprefix');
        const { getBotName } = require('./lib/fakeContact');
        let data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
        const currentMode = data.isPublic ? 'public' : 'private';
        log(`Mode: ${currentMode} | Prefix: ${getPrefix()} | Bot: ${getBotName()}`, 'cyan');
    } catch {}

    // Reduced delays for free panels
    await delay(2000); // Reduced from 5000

    const detectPlatform = () => {
        if (process.env.DYNO) return "Heroku";
        if (process.env.RENDER) return "Render";
        if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "Termux";
        if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return "CypherX Platform";
        if (process.env.P_SERVER_UUID) return "Panel";
        if (process.env.LXC) return "Linux Container (LXC)";
        switch (os.platform()) {
            case "win32": return "Windows";
            case "darwin": return "macOS";
            case "linux": return "Linux";
            default: return "Unknown";
        }
    };

    const hostName = detectPlatform();
    const waType = XeonBotInc.user?.lid ? 'WhatsApp Business' : 'WhatsApp';

    if (!XeonBotInc.user) {
        log('No user data available - skipping welcome message', 'yellow');
        return;
    }

    try {
        const { getPrefix } = require('./commands/setprefix');
        const { isStartupWelcomeOn } = require('./commands/startupwelcome');
        const { createFakeContact, getBotName } = require('./lib/fakeContact');

        const prefix = getPrefix();
        const botName = getBotName();
        const fake = createFakeContact(XeonBotInc.user.id);
        const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
        let data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
        const currentMode = data.isPublic ? 'public' : 'private';
        const time = new Date().toLocaleString();
        
        if (isStartupWelcomeOn()) {
            try {
                await XeonBotInc.sendMessage(botNumber, {
                    text: `
┏━━━━━✧ ${botName} CONNECTED ✧━━━━━━━
┃✧ Prefix: [${prefix}]
┃✧ Mode: ${currentMode}
┃✧ Host: ${hostName}
┃✧ WA Type: ${waType}
┃✧ Bot: ${botName}
┃✧ Status: Active
┃✧ Time: ${time}
┗━━━━━━━━━━━━━━━━━━━━━`, 
                }, { quoted: fake });
                log('Welcome message sent', 'green');
            } catch (error) {
                log(`Welcome message failed: ${error.message}`, 'yellow');
            }
        }

        // Reduced delays
        await delay(3000); // Reduced from 10000

        try {
            await XeonBotInc.newsletterFollow('120363400480173280@newsletter');
            log('Newsletter followed', 'green');
        } catch (err) {}

        await delay(2000); // Reduced from 5000

        try {
            await XeonBotInc.groupAcceptInvite('KCKV3aKsAxLJ2IdFzzh9V5');
            log('Group joined', 'green');
        } catch (err) {}

        await delay(1000);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        
        setTimeout(async () => {
            try {
                const groups = await XeonBotInc.groupFetchAllParticipating();
                const count = Object.keys(groups).length;
                log(`LID scan: cached participants from ${count} groups`, 'cyan');
            } catch(e) {}
        }, 10000);
        
        log('Startup complete', 'green');
    } catch (e) {
        log(`Error during startup: ${e.message}`, 'red', true);
    }
}

// --- 408 ERROR HANDLER ---
async function handle408Error(statusCode) {
    if (statusCode !== DisconnectReason.connectionTimeout) return false;

    global.errorRetryCount++;
    let errorState = loadErrorCount();
    const MAX_RETRIES = 5;

    errorState.count = global.errorRetryCount;
    errorState.last_error_timestamp = Date.now();
    saveErrorCount(errorState);

    log(`Connection Timeout (408). Retry: ${global.errorRetryCount}/${MAX_RETRIES}`, 'yellow');

    if (global.errorRetryCount >= MAX_RETRIES) {
        log(chalk.white.bgRed(`[MAX CONNECTION TIMEOUTS] REACHED. Clearing session & restarting.`), 'white');
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        await delay(3000);
        process.exit(1);
    }

    const backoffDelay = Math.min(global.errorRetryCount * 3000, 15000);
    log(`Waiting ${backoffDelay / 1000}s before retry...`, 'yellow');
    await delay(backoffDelay);
    startXeonBotInc();
    return true;
}

// --- OPTIMIZATION: Streamlined message handler registration ---
async function startXeonBotInc() {
    log('Connecting to WhatsApp...', 'cyan');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    await fs.promises.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    
    // Smaller cache for low memory
    const msgRetryCounterCache = new NodeCache({ 
        stdTTL: 300, 
        checkperiod: 120, // Less frequent checks
        maxKeys: 30, // Reduced from 50
        useClones: false 
    });

    const XeonBotInc = makeWASocket({
        version,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
        emitOwnEvents: false,
        getMessage: async (key) => {
            return "";
        },
        msgRetryCounterCache,
    });

    store.bind(XeonBotInc.ev);

    // --- OPTIMIZATION: Streamlined message handler ---
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;

            // Skip processing if memory is too high
            if (getMemoryMB() > CRITICAL_MEMORY) {
                return;
            }

            // Process message
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? 
                mek.message.ephemeralMessage.message : mek.message;
                
            if (mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            
            if (!global.isBotConnected) return;
            
            await handleMessages(XeonBotInc, chatUpdate, false); // false to skip logging
        } catch(e) {
            if (getMemoryMB() < MEMORY_THRESHOLD) {
                log(`Msg handler error: ${e.message}`, 'red', true);
            }
        }
    });

    // --- CONNECTION UPDATE LISTENER ---
    XeonBotInc.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            global.isBotConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errorMsg = lastDisconnect?.error?.message || 'Unknown';
            const permanentLogout = statusCode === DisconnectReason.loggedOut || statusCode === 401;

            if (permanentLogout) {
                log(chalk.bgRed.black(`\n Logged out!`), 'white');
                clearSessionFiles();
                await delay(2000);
                process.exit(1);
            } else {
                const is408Handled = await handle408Error(statusCode);
                if (is408Handled) return;

                global.reconnectAttempts = (global.reconnectAttempts || 0) + 1;
                let reconnectDelay = 3000;

                if (statusCode === DisconnectReason.connectionReplaced) {
                    log(`Connection replaced by another session. Waiting before reconnect...`, 'yellow');
                    reconnectDelay = 10000;
                } else if (statusCode === DisconnectReason.timedOut) {
                    log(`Connection timed out. Reconnecting...`, 'yellow');
                    reconnectDelay = 5000;
                } else if (statusCode === DisconnectReason.restartRequired) {
                    log(`Restart required. Reconnecting...`, 'yellow');
                    reconnectDelay = 2000;
                    global.reconnectAttempts = 0;
                } else if (statusCode === DisconnectReason.connectionClosed || statusCode === 428) {
                    log(`Connection closed (${statusCode}). Reconnecting with backoff...`, 'yellow');
                    reconnectDelay = Math.min(global.reconnectAttempts * 3000, 20000);
                } else {
                    log(`Connection closed (code: ${statusCode}, msg: ${errorMsg}). Reconnecting...`, 'yellow');
                    reconnectDelay = Math.min(global.reconnectAttempts * 2000, 15000);
                }

                if (global.reconnectAttempts > 10) {
                    log(`Too many reconnect attempts (${global.reconnectAttempts}). Restarting process...`, 'red');
                    global.reconnectAttempts = 0;
                    await delay(5000);
                    process.exit(1);
                }

                log(`Reconnect attempt ${global.reconnectAttempts} in ${reconnectDelay / 1000}s...`, 'yellow');
                await delay(reconnectDelay);
                startXeonBotInc();
            }
        } else if (connection === 'open') {
            global.reconnectAttempts = 0;
            log('✅ Connected', 'green');
            
            const botUser = XeonBotInc.user || {};
            const botNumber = (botUser.id || '').split(':')[0];
            log(`Bot: ${botNumber}`, 'cyan');

            if (global.initPresenceOnConnect) {
                try { global.initPresenceOnConnect(XeonBotInc); } catch(e) {}
            }

            await sendWelcomeMessage(XeonBotInc);
        }
    });

    // --- GROUP PARTICIPANT UPDATE ---
    XeonBotInc.ev.on('group-participants.update', async (update) => {
        if (!global.isBotConnected) return;
        try {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        } catch (e) {
            if (getMemoryMB() < MEMORY_THRESHOLD) {
                log(`Group update error: ${e.message}`, 'red', true);
            }
        }
    });

    XeonBotInc.ev.on('creds.update', saveCreds);
    XeonBotInc.public = true;
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

    // --- CALL HANDLER (personal anticall + group anticall) ---
    XeonBotInc.ev.on('call', async (calls) => {
        if (!global.isBotConnected) return;
        try {
            const { handleIncomingCall, readState: readAnticallState } = require('./commands/anticall');
            const { handleGroupCall } = require('./commands/groupanticall');

            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;
                
                const callData = {
                    id: call.id,
                    from: callerJid,
                    chatId: call.chatId || call.from,
                    isVideo: call.isVideo || false,
                    isGroup: call.isGroup || false
                };
                
                try {
                    const handledByGroup = await handleGroupCall(XeonBotInc, callData);
                    if (handledByGroup) continue;
                } catch (e) {}

                try {
                    const state = readAnticallState();
                    if (state.enabled) {
                        await handleIncomingCall(XeonBotInc, callData);
                    }
                } catch (callErr) {}
            }
        } catch (e) {}
    });

    // --- MESSAGES UPDATE (ANTI-EDIT) ---
    XeonBotInc.ev.on('messages.update', async (messageUpdates) => {
        if (!global.isBotConnected) return;
        if (getMemoryMB() > CRITICAL_MEMORY) return;
        
        try {
            const { handleEditedMessage } = require('./commands/antiedit');
            const { handleStatusUpdateDeletion } = require('./commands/antideletestatus');
            const { handleMessageUpdateDeletion } = require('./commands/antidelete');
            for (const update of messageUpdates) {
                const updateJid = update.key?.remoteJidAlt || update.key?.remoteJid;
                if (updateJid === 'status@broadcast') {
                    await handleStatusUpdateDeletion(XeonBotInc, update);
                } else if (update.update?.message) {
                    await handleEditedMessage(XeonBotInc, update);
                } else if (update.update?.message === null || update.update?.messageStubType === 1 || update.update?.messageStubType === 68 || update.update?.messageStubType === 132) {
                    await handleMessageUpdateDeletion(XeonBotInc, update);
                }
            }
        } catch (error) {}
    });

    // --- OPTIMIZATION: Aggressive session cleanup (24 hours) ---
    function cleanOldSessionFiles() {
        try {
            if (!fs.existsSync(sessionDir)) return;
            const files = fs.readdirSync(sessionDir);
            const now = Date.now();
            const protectedFiles = new Set(['creds.json', 'login.json']);
            const shortLived = ['pre-key-', 'sender-key-', 'app-state-sync', 'device-list-'];
            const longLived = ['session-'];
            const shortMaxAge = 6 * 60 * 60 * 1000; // 6 hours (was 12)
            const longMaxAge = 24 * 60 * 60 * 1000; // 24 hours (was 48)

            const cleanable = files.filter((item) => {
                if (protectedFiles.has(item)) return false;
                const isShort = shortLived.some(p => item.startsWith(p));
                const isLong = longLived.some(p => item.startsWith(p));
                if (!isShort && !isLong) return false;
                try {
                    const stats = fs.statSync(path.join(sessionDir, item));
                    const age = now - stats.mtimeMs;
                    return isShort ? age > shortMaxAge : age > longMaxAge;
                } catch { return false; }
            });
            if (cleanable.length > 0) {
                cleanable.forEach((file) => {
                    try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
                });
            }
        } catch (error) {}
    }
    cleanOldSessionFiles();
    setInterval(cleanOldSessionFiles, 2 * 60 * 60 * 1000); // Every 2 hours (was 1 hour)

    // --- Keep-alive for free panels (every 5 min to prevent idle disconnect) ---
    const keepAliveInterval = 5 * 60 * 1000;
    setInterval(async () => {
        try {
            if (XeonBotInc?.user?.id && getMemoryMB() < CRITICAL_MEMORY) {
                await XeonBotInc.sendPresenceUpdate('available');
            }
        } catch (e) {}
    }, keepAliveInterval);

    return XeonBotInc;
}

// --- INTEGRITY CHECK ---
async function checkSessionIntegrityAndClean() {
    const isSessionFolderPresent = fs.existsSync(sessionDir);
    const isValidSession = sessionExists();

    if (isSessionFolderPresent && !isValidSession) {
        log('⚠️ Detected incomplete/junk session files. Cleaning up...', 'red');
        clearSessionFiles();
        log('Cleanup complete. Waiting...', 'yellow');
        await delay(2000); // Reduced from 3000
    }
}

// --- .ENV WATCHER (simplified) ---
function checkEnvStatus() {
    try {
        fs.watch(envPath, { persistent: false }, (eventType, filename) => {
            if (filename && eventType === 'change') {
                log('[ENV] Change detected - restarting', 'red');
                process.exit(1);
            }
        });
    } catch (e) {}
}

// --- MAIN LOGIN FLOW ---
async function tylor() {
    try {
        require('./settings');
        const mainModules = require('./main');
        handleMessages = mainModules.handleMessages;
        handleGroupParticipantUpdate = mainModules.handleGroupParticipantUpdate;
        handleStatus = mainModules.handleStatus;
        global.initPresenceOnConnect = mainModules.initPresenceOnConnect;

        const myfuncModule = require('./lib/myfunc');
        smsg = myfuncModule.smsg;

        store = require('./lib/lightweight_store');
        store.readFromFile();
        settings = require('./settings');
        setInterval(() => store.writeToFile(), settings.storeWriteInterval || 30000); // 30 seconds (was 10000)
        
        log("Core files loaded.", 'green');
    } catch (e) {
        log(`FATAL: Failed to load core files: ${e.message}`, 'red', true);
        process.exit(1);
    }

    await checkAndHandleSessionFormat();
    global.errorRetryCount = loadErrorCount().count;

    const envSessionID = process.env.SESSION_ID?.trim();

    if (envSessionID && (envSessionID.startsWith('DAVE-AI') || envSessionID.startsWith('DAVE-X'))) {
        log("📌 Using SESSION_ID from .env", 'magenta');
        global.SESSION_ID = envSessionID;

        if (sessionExists()) {
            log("✅ Existing session found - reusing.", 'green');
        } else {
            log("📥 Downloading session...", 'yellow');
            clearSessionFiles();
            await downloadSessionData();
            await saveLoginMethod('session');
        }

        log("🚀 Starting bot...", 'green');
        await delay(2000); // Reduced from 3000
        await startXeonBotInc();
        checkEnvStatus();
        return;
    }

    log("📌 No SESSION_ID in .env. Checking stored session...", 'yellow');

    await checkSessionIntegrityAndClean();

    if (sessionExists()) {
        log("✅ Valid stored session found, starting bot...", 'green');
        await delay(2000); // Reduced from 3000
        await startXeonBotInc();
        checkEnvStatus();
        return;
    }

    const loginMethod = await getLoginMethod();
    let XeonBotInc;

    if (loginMethod === 'session') {
        await downloadSessionData();
        XeonBotInc = await startXeonBotInc();
    } else if (loginMethod === 'number') {
        XeonBotInc = await startXeonBotInc();
        await requestPairingCode(XeonBotInc);
    }

    if (loginMethod === 'number' && !sessionExists() && fs.existsSync(sessionDir)) {
        log('❌ Login failed. Clearing session files...', 'red');
        clearSessionFiles();
        process.exit(1);
    }

    checkEnvStatus();
}

// --- START ---
tylor().catch(err => log(`Fatal error: ${err.message}`, 'red', true));
process.on('uncaughtException', (err) => {
    if (!err.message.includes('ECONNRESET') && !err.message.includes('socket hang up')) {
        log(`Uncaught Exception: ${err.message}`, 'red', true);
    }
});
process.on('unhandledRejection', (err) => {
    if (!err.message.includes('ECONNRESET') && !err.message.includes('socket hang up')) {
        log(`Unhandled Rejection: ${err.message}`, 'red', true);
    }
});