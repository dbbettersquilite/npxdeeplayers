const fs = require('fs');
const config = require('./config');
require('dotenv').config()
const chalk = require('chalk');
const path = require('path');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    jidNormalizedUser, 
    makeCacheableSignalKeyStore, 
    delay 
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const pino = require("pino");
const readline = require("readline");
const { rmSync } = require('fs');
require('dotenv').config();

// --- Global Setup ---
global.isBotConnected = false;
global.errorRetryCount = 0;
global.lastMemoryCheck = Date.now();
global.sock = null;
global.messageBackup = {};
global.botname = "DAVE-X";
global.themeemoji = "•";

let smsg, handleMessages, handleGroupParticipantUpdate, handleStatus, store, settings;

// --- Paths ---
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');
const loginFile = path.join(__dirname, 'login.json');
const MESSAGE_STORE_FILE = path.join(__dirname, 'message_backup.json');
const SESSION_ERROR_FILE = path.join(__dirname, 'sessionErrorCount.json');

// --- Logging ---
function log(message, color = 'white', isError = false) {
    try {
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        if (memMB > 250 && !isError && !message.includes('Connected')) {
            return;
        }

        const prefix = chalk.cyan.bold('[ DAVE - X ]');
        const logFunc = isError ? console.error : console.log;
        
        let coloredMessage = message;
        try {
            if (chalk && chalk[color]) {
                coloredMessage = chalk[color](message);
            }
        } catch (e) {}

        logFunc(`${prefix} ${coloredMessage}`);
    } catch (e) {
        console.log(`[ DAVE - X ] ${message}`);
    }
}

// --- Noisy patterns suppression ---
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
    for (const pattern of noisyPatterns) {
        if (str.includes(pattern)) return true;
    }
    return false;
}

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

// --- File Management ---
function loadStoredMessages() {
    try {
        if (fs.existsSync(MESSAGE_STORE_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGE_STORE_FILE, 'utf-8'));
        }
    } catch (error) { log(`Error loading message store: ${error.message}`, 'red', true); }
    return {};
}

function saveStoredMessages(data) {
    try {
        fs.writeFileSync(MESSAGE_STORE_FILE, JSON.stringify(data, null, 2));
    } catch (error) { log(`Error saving message store: ${error.message}`, 'red', true); }
}

function loadErrorCount() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            return JSON.parse(fs.readFileSync(SESSION_ERROR_FILE, 'utf-8'));
        }
    } catch (error) { log(`Error loading error count: ${error.message}`, 'red', true); }
    return { count: 0, last_error_timestamp: 0 };
}

function saveErrorCount(data) {
    try {
        fs.writeFileSync(SESSION_ERROR_FILE, JSON.stringify(data, null, 2));
    } catch (error) { log(`Error saving error count: ${error.message}`, 'red', true); }
}

function deleteErrorCountFile() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) fs.unlinkSync(SESSION_ERROR_FILE);
    } catch (e) { log(`Failed to delete error file: ${e.message}`, 'red', true); }
}

function clearSessionFiles() {
    try {
        rmSync(sessionDir, { recursive: true, force: true, maxRetries: 3 });
        if (fs.existsSync(loginFile)) fs.unlinkSync(loginFile);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        log('✅ Session cleaned', 'green');
    } catch (e) { log(`Failed to clear session: ${e.message}`, 'red', true); }
}

// --- Login Management (EXACT from original) ---
async function saveLoginMethod(method) {
    await fs.promises.mkdir(path.dirname(loginFile), { recursive: true });
    await fs.promises.writeFile(loginFile, JSON.stringify({ method }, null, 2));
}

async function getLastLoginMethod() {
    if (fs.existsSync(loginFile)) {
        return JSON.parse(fs.readFileSync(loginFile, 'utf-8')).method;
    }
    return null;
}

function sessionExists() {
    return fs.existsSync(credsPath);
}

async function downloadSessionData() {
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true });
        if (!fs.existsSync(credsPath) && global.SESSION_ID) {
            const base64Data = global.SESSION_ID.includes("DAVE-AI:~") ? 
                global.SESSION_ID.split("DAVE-AI:~")[1] : global.SESSION_ID;
            await fs.promises.writeFile(credsPath, Buffer.from(base64Data, 'base64'));
            log('✅ Session saved', 'green');
        }
    } catch (err) { log(`Error downloading session: ${err.message}`, 'red', true); }
}

// --- Pairing Code Request (EXACT from original) ---
async function requestPairingCode(socket) {
    try {
        await delay(3000);
        let code = await socket.requestPairingCode(global.phoneNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        log(chalk.bgGreen.black(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`), 'white');
        log(chalk.bgGreen.black(`   Pairing Code: ${code}   `), 'white');
        log(chalk.bgGreen.black(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`), 'white');
        log('Enter code in WhatsApp: Settings → Linked Devices → Link a Device', 'blue');
        return true;
    } catch (err) { 
        log(`Failed to get pairing code: ${err.message}`, 'red', true); 
        return false; 
    }
}

// --- Session Validation (EXACT from original) ---
async function checkAndHandleSessionFormat() {
    const sessionId = process.env.SESSION_ID?.trim();
    if (sessionId && !sessionId.startsWith('DAVE-AI')) {
        log(chalk.white.bgRed('[ERROR]: SESSION_ID must start with "DAVE-AI"'), 'white');
        log('Cleaning .env...', 'red');

        try {
            let envContent = fs.readFileSync('.env', 'utf8');
            envContent = envContent.replace(/^SESSION_ID=.*$/m, 'SESSION_ID=');
            fs.writeFileSync('.env', envContent);
            log('✅ Cleaned .env', 'green');
        } catch (e) { log(`Failed to modify .env: ${e.message}`, 'red', true); }

        await delay(5000);
        process.exit(1);
    }
}

async function checkSessionIntegrityAndClean() {
    if (fs.existsSync(sessionDir) && !sessionExists()) {
        log('⚠️ Cleaning incomplete session...', 'red');
        clearSessionFiles();
        await delay(3000);
    }
}

// --- Error Handling ---
async function handle408Error(statusCode) {
    if (statusCode !== DisconnectReason.connectionTimeout) return false;

    global.errorRetryCount++;
    const MAX_RETRIES = 2;
    const errorState = { count: global.errorRetryCount, last_error_timestamp: Date.now() };
    saveErrorCount(errorState);

    log(`Timeout (408). Retry: ${global.errorRetryCount}/${MAX_RETRIES}`, 'yellow');

    if (global.errorRetryCount >= MAX_RETRIES) {
        log(chalk.white.bgRed('[MAX TIMEOUTS REACHED]'), 'white');
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        await delay(5000);
        process.exit(1);
    }
    return true;
}

// --- Memory Management (Your original functions) ---
const MAX_BACKUP_CHATS = 15;
const MAX_BACKUP_MESSAGES_PER_CHAT = 3;
const MAX_BACKUP_AGE = 3 * 60 * 60;

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
    } catch (error) {}
}
setInterval(_flushMessageBackup, 120000);

function getMemoryMB() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function memoryCleanup() {
    const now = Date.now();
    if (now - global.lastMemoryCheck < 30000) return;
    global.lastMemoryCheck = now;

    const memMB = getMemoryMB();

    if (memMB > 250) {
        log(`[MEM] ${memMB}MB - cleaning up`, 'yellow');
        global.messageBackup = trimMessageBackup(global.messageBackup);

        if (memMB > 320) {
            log(`[MEM] Critical: ${memMB}MB - clearing caches`, 'red');
            global.messageBackup = {};

            if (typeof store !== 'undefined' && store && store.messages) {
                store.messages = {};
            }
        }

        if (global.gc) global.gc();
    }
}
setInterval(memoryCleanup, 30000);

function cleanupJunkFiles(botSocket) {
    const memMB = getMemoryMB();
    if (memMB < 200) return;

    let directoryPath = path.join(__dirname);
    fs.readdir(directoryPath, async function (err, files) {
        if (err) return;
        const junkExtensions = new Set(['.gif', '.png', '.mp3', '.mp4', '.opus', '.jpg', '.webp', '.webm', '.zip']);
        const filteredArray = files.filter(item => junkExtensions.has(path.extname(item)));

        if (filteredArray.length > 10) {
            if (botSocket && botSocket.user && botSocket.user.id) {
                botSocket.sendMessage(botSocket.user.id.split(':')[0] + '@s.whatsapp.net', { 
                    text: `Cleaned ${filteredArray.length} junk files` 
                }).catch(() => {});
            }

            filteredArray.forEach(function (file) {
                const filePath = path.join(directoryPath, file);
                try {
                    if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch(e) {}
            });
        }
    });
}
setInterval(() => cleanupJunkFiles(global.sock), 15 * 60 * 1000);

function cleanOldSessionFiles() {
    try {
        if (!fs.existsSync(sessionDir)) return;
        const files = fs.readdirSync(sessionDir);
        const now = Date.now();
        const protectedFiles = new Set(['creds.json', 'login.json']);
        const shortLived = ['pre-key-', 'sender-key-', 'app-state-sync', 'device-list-'];
        const longLived = ['session-'];
        const shortMaxAge = 6 * 60 * 60 * 1000;
        const longMaxAge = 24 * 60 * 60 * 1000;

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
setInterval(cleanOldSessionFiles, 2 * 60 * 60 * 1000);

// --- Interactive Login (EXACT from original) ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise(resolve => rl.question(text, resolve));

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

    console.log(chalk.cyan(`
    ╔══════════════════════════════╗
    ║       DAVE-X BOT Login       ║
    ╚══════════════════════════════╝`));

    log("Choose login method:", 'yellow');
    log("1) WhatsApp Number (Pairing Code)", 'blue');
    log("2) DAVE-AI:~ Session ID", 'blue');

    let choice = await question("Choice (1/2): ");
    choice = choice.trim();

    if (choice === '1') {
        log("Enter WhatsApp number with country code (no + or spaces):", 'yellow');
        log("Example: 254712345678", 'blue');
        let phone = await question("Number: ");
        phone = phone.replace(/[^0-9]/g, '');
        if (phone.length < 10 || phone.length > 15) {
            log('❌ Invalid number!', 'red');
            return getLoginMethod();
        }
        global.phoneNumber = phone;
        await saveLoginMethod('number');
        return 'number';
    } else if (choice === '2') {
        let sessionId = await question("Paste DAVE-AI:~ Session ID: ");
        sessionId = sessionId.trim();
        if (!sessionId.includes("DAVE-AI:~")) {
            log("❌ Invalid! Must contain 'DAVE-AI:~' prefix", 'red');
            process.exit(1);
        }
        global.SESSION_ID = sessionId;
        await saveLoginMethod('session');
        return 'session';
    } else {
        log("❌ Invalid choice! Please enter 1 or 2.", 'red');
        return getLoginMethod();
    }
}

// --- Welcome Message (Your original) ---
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

    const detectPlatform = () => {
        if (process.env.DYNO) return "Heroku";
        if (process.env.RENDER) return "Render";
        if (process.env.P_SERVER_UUID) return "Panel";
        switch (os.platform()) {
            case "win32": return "Windows";
            case "darwin": return "macOS";
            case "linux": return "Linux";
            default: return "Unknown";
        }
    };

    const hostName = detectPlatform();
    const waType = 'WhatsApp';

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

        await delay(3000);

        try {
            await XeonBotInc.newsletterFollow('120363400480173280@newsletter');
            log('Newsletter followed', 'green');
        } catch (err) {}

        await delay(2000);

        try {
            await XeonBotInc.groupAcceptInvite('JsgD8NImCO3FhdoUdusSdY');
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

// --- Main Bot Function ---
let connectionAttempt = 0;

async function startXeonBotInc() {
    connectionAttempt++;
    log(`Connecting to WhatsApp... (attempt #${connectionAttempt})`, 'cyan');

    const { version } = await fetchLatestBaileysVersion();
    await fs.promises.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const msgRetryCounterCache = new NodeCache();

    const XeonBotInc = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        getMessage: async (key) => {
            try {
                if (key?.id) {
                    const chatId = key.remoteJid;
                    if (global.messageBackup?.[chatId]?.[key.id]) {
                        return global.messageBackup[chatId][key.id].message;
                    }
                }
            } catch (e) {}
            return "";
        },
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined,
        connectTimeoutMs: 30000,
        retryRequestDelayMs: 250,
        emitOwnEvents: false,
        fireInitQueries: true,
    });

    // Load required modules
    store = require('./lib/lightweight_store');
    const { smsg: smsgFunc } = require('./lib/myfunc');
    smsg = smsgFunc;
    store.bind(XeonBotInc.ev);
    store.readFromFile();

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            if (getMemoryMB() > 320) return;

            const mek = chatUpdate.messages[0];
            if (!mek?.message) return;

            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? 
                mek.message.ephemeralMessage.message : mek.message;

            if (mek.key?.id && mek.message) {
                let chatId = mek.key.remoteJid;
                let messageId = mek.key.id;
                if (!global.messageBackup[chatId]) global.messageBackup[chatId] = {};
                
                let savedMessage = { 
                    sender: mek.key.participant || mek.key.remoteJid, 
                    message: mek.message,
                    timestamp: mek.messageTimestamp 
                };
                
                if (!global.messageBackup[chatId][messageId]) { 
                    global.messageBackup[chatId][messageId] = savedMessage; 
                    saveStoredMessages(global.messageBackup); 
                }
            }

            if (mek.key.remoteJid === 'status@broadcast') {
                try {
                    if (handleStatus) await handleStatus(XeonBotInc, chatUpdate);
                } catch (statusError) {
                    log(`Status handler error: ${statusError.message}`, 'yellow');
                }
                return;
            }

            if (!global.isBotConnected) return;

            if (handleMessages) {
                try {
                    await handleMessages(XeonBotInc, chatUpdate, false);
                } catch (handlerError) {
                    log(`Message handler error: ${handlerError.message}`, 'red', true);
                }
            }
        } catch(e) {
            log(`Msg handler error: ${e.message}`, 'red', true);
        }
    });

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            global.isBotConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const permanentLogout = statusCode === DisconnectReason.loggedOut || statusCode === 401;

            if (permanentLogout) {
                log(chalk.bgRed.black('🚨 Logged out / Invalid session'), 'white');
                clearSessionFiles();
                await delay(5000);
                process.exit(1);
            } else {
                const is408Handled = await handle408Error(statusCode);
                if (!is408Handled) {
                    const reconnectDelay = Math.min((global.errorRetryCount + 1) * 5000, 30000);
                    log(`Reconnecting in ${reconnectDelay/1000}s...`, 'yellow');
                    await delay(reconnectDelay);
                    startXeonBotInc();
                }
            }
        } else if (connection === 'open') {
            const botNumber = XeonBotInc.user.id.split(':')[0];
            console.log('');
            console.log(chalk.hex('#6C5CE7').bold('  ╔═══════════════════════════════════╗'));
            console.log(chalk.hex('#6C5CE7').bold('  ║') + chalk.hex('#00CEC9').bold('        DAVE-X BOT - ONLINE        ') + chalk.hex('#6C5CE7').bold('║'));
            console.log(chalk.hex('#6C5CE7').bold('  ╠═══════════════════════════════════╣'));
            console.log(chalk.hex('#6C5CE7').bold('  ║') + chalk.hex('#DFE6E9')(` Number  : +${botNumber}`.padEnd(34)) + chalk.hex('#6C5CE7').bold('║'));
            const _p = process.platform, _a = process.arch;
            const _plat = (process.env.DYNO) ? 'Heroku' : (process.env.P_SERVER_UUID) ? 'Panel' : _p === 'linux' ? `Linux (${_a})` : _p === 'win32' ? `Windows (${_a})` : _p === 'darwin' ? `macOS (${_a})` : `${_p} (${_a})`;
            console.log(chalk.hex('#6C5CE7').bold('  ║') + chalk.hex('#DFE6E9')(` Platform: ${_plat}`.padEnd(34)) + chalk.hex('#6C5CE7').bold('║'));
            console.log(chalk.hex('#6C5CE7').bold('  ║') + chalk.hex('#DFE6E9')(` Time    : ${new Date().toLocaleString()}`.padEnd(34)) + chalk.hex('#6C5CE7').bold('║'));
            console.log(chalk.hex('#6C5CE7').bold('  ╚═══════════════════════════════════╝'));
            console.log('');

            await sendWelcomeMessage(XeonBotInc);
        } else if (connection === 'connecting') {
            log('🔄 Connecting to WhatsApp...', 'yellow');
            
            // Request pairing code if in number mode (EXACT from original)
            if (global.phoneNumber) {
                await requestPairingCode(XeonBotInc);
            }
        }
    });

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        if (!global.isBotConnected) return;
        try {
            if (handleGroupParticipantUpdate) await handleGroupParticipantUpdate(XeonBotInc, update);
        } catch (e) {
            log(`Group update error: ${e.message}`, 'red', true);
        }
    });

    XeonBotInc.ev.on('creds.update', saveCreds);
    XeonBotInc.public = true;
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

    // Anticall handler
    XeonBotInc.ev.on('call', async (calls) => {
        if (!global.isBotConnected) return;
        try {
            const { handleIncomingCall, readState: readAnticallState } = require('./commands/anticall');
            const state = readAnticallState();
            if (!state.enabled) return;

            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;

                const callData = {
                    id: call.id,
                    from: callerJid,
                    isVideo: call.isVideo || false,
                    isGroup: call.isGroup || false
                };

                try {
                    await handleIncomingCall(XeonBotInc, callData);
                } catch (callErr) {
                    console.error('Error handling call:', callErr.message);
                }
            }
        } catch (e) {
            console.error('Error in call event:', e.message);
        }
    });

    // Anti-edit handler
    XeonBotInc.ev.on('messages.update', async (messageUpdates) => {
        if (!global.isBotConnected) return;
        try {
            const { handleMessageUpdate } = require('./commands/antiedit');
            for (const update of messageUpdates) {
                if (update.update?.message || update.update?.editedMessage || update.message) {
                    try {
                        await handleMessageUpdate(XeonBotInc, update);
                    } catch (e) {
                        console.error('[ANTIEDIT] Single update error:', e.message);
                    }
                }
            }
        } catch (error) {
            console.error('[ANTIEDIT ERROR]', error.message);
        }
    });

    return XeonBotInc;
}

// --- Main Flow (EXACT from original) ---
async function tylor() {
    // Load core modules
    try {
        require('./settings');
        const mainModules = require('./main');
        handleMessages = mainModules.handleMessages;
        handleGroupParticipantUpdate = mainModules.handleGroupParticipantUpdate;
        handleStatus = mainModules.handleStatus;

        const myfuncModule = require('./lib/myfunc');
        smsg = myfuncModule.smsg;

        log("✨ Core files loaded", 'green');
    } catch (e) {
        log(`FATAL: Core load failed: ${e.message}`, 'red', true);
        process.exit(1);
    }

    await checkAndHandleSessionFormat();
    global.errorRetryCount = loadErrorCount().count;

    // Priority: Environment SESSION_ID with DAVE-AI:~ prefix
    const envSessionID = process.env.SESSION_ID?.trim();
    if (envSessionID && envSessionID.startsWith('DAVE-AI')) {
        log("📌 [PRIORITY]: Using .env DAVE-AI session", 'magenta');
        clearSessionFiles();
        global.SESSION_ID = envSessionID;
        await downloadSessionData();
        await saveLoginMethod('session');
        await delay(3000);
        await startXeonBotInc();
        return;
    }

    log("📌 [ALERT] No DAVE-AI:~ session in .env, checking stored...", 'yellow');
    await checkSessionIntegrityAndClean();

    if (sessionExists()) {
        log("📌 [ALERT]: Starting with stored session...", 'green');
        await delay(3000);
        await startXeonBotInc();
        return;
    }

    // Interactive login
    const loginMethod = await getLoginMethod();

    if (loginMethod === 'session') {
        await downloadSessionData();
        await startXeonBotInc();
    } else if (loginMethod === 'number') {
        await startXeonBotInc(); // Pairing code will be requested in connection.update
    }
}

// --- Suppress noisy errors ---
const stderrNoisy = [
    /bad mac/i, /hmac/i, /decrypt/i, /failed to decrypt/i,
    /error in ws/i, /stream errored/i, /precondition/i
];

const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk, ...args) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (stderrNoisy.some(p => p.test(str))) return true;
    return origStderr(chunk, ...args);
};

// --- Process handlers ---
process.on('uncaughtException', (err) => {
    if (!err.message.includes('ECONNRESET') && 
        !err.message.includes('socket hang up') &&
        !err.message.includes('chalk') &&
        !err.message.includes('EPIPE')) {
        log(`Uncaught Exception: ${err.message}`, 'red', true);
    }
});

process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    if (!msg.includes('ECONNRESET') && 
        !msg.includes('socket hang up') &&
        !msg.includes('chalk') &&
        !msg.includes('EPIPE')) {
        log(`Unhandled Rejection: ${msg}`, 'red', true);
    }
});

// --- Start Bot ---
tylor().catch(err => log(`Fatal error: ${err.message}`, 'red', true));