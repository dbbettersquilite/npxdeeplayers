const config = require('./config');
require('dotenv').config();

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const os = require('os')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay,
    Browsers
} = require("@whiskeysockets/baileys")

const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')

let chalk;
try {
    chalk = require('chalk');
    if (typeof chalk.green !== 'function') {
        chalk = require('chalk').default || chalk;
    }
} catch (e) {
    chalk = {
        green: (t) => t,
        red: (t) => t,
        yellow: (t) => t,
        blue: (t) => t,
        magenta: (t) => t,
        cyan: (t) => t,
        white: (t) => t,
        bgRed: { black: (t) => t },
        bgGreen: { black: (t) => t },
        bgBlue: { black: (t) => t },
        bgYellow: { black: (t) => t },
        hex: () => ({ bold: (t) => t }),
        bold: (t) => t
    };
}

function log(message, color = 'white', isError = false) {
    try {
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        if (memMB > 250 && !isError && !message.includes('Connected')) {
            return;
        }

        const prefix = '[ DAVE - X ]';
        const logFunc = isError ? console.error : console.log;

        let coloredMessage = message;
        try {
            if (chalk && chalk[color]) {
                coloredMessage = chalk[color](message);
            } else if (chalk && chalk.hex && color.startsWith('#')) {
                coloredMessage = chalk.hex(color)(message);
            }
        } catch (e) {}

        logFunc(`${prefix} ${coloredMessage}`);
    } catch (e) {
        console.log(`[ DAVE - X ] ${message}`);
    }
}

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

global.isBotConnected = false;
global.errorRetryCount = 0;
global.lastMemoryCheck = Date.now();
global.sock = null;
global.pairingCodeRequested = false;

let smsg, handleMessages, handleGroupParticipantUpdate, handleStatus, store, settings;

const MESSAGE_STORE_FILE = path.join(__dirname, 'message_backup.json');
const SESSION_ERROR_FILE = path.join(__dirname, 'sessionErrorCount.json');
global.messageBackup = {};

const MAX_BACKUP_CHATS = 15;
const MAX_BACKUP_MESSAGES_PER_CHAT = 3;
const MAX_BACKUP_AGE = 3 * 60 * 60;

function loadStoredMessages() {
    try {
        if (fs.existsSync(MESSAGE_STORE_FILE)) {
            const data = fs.readFileSync(MESSAGE_STORE_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            return trimMessageBackup(parsed);
        }
    } catch (error) {}
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

const sessionDir = path.join(__dirname, 'session')
const credsPath = path.join(sessionDir, 'creds.json')
const loginFile = path.join(sessionDir, 'login.json')
const envPath = path.join(process.cwd(), '.env');

function clearSessionFiles() {
    try {
        log('Clearing session folder...', 'blue');
        rmSync(sessionDir, { recursive: true, force: true, maxRetries: 3 });
        if (fs.existsSync(loginFile)) fs.unlinkSync(loginFile);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        log('Session files cleaned.', 'green');
    } catch (e) {
        log(`Failed to clear session: ${e.message}`, 'red', true);
    }
}

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise(resolve => rl.question(text, resolve));

async function requestPairingCode(socket) {
    try {
        if (!global.phoneNumber) {
            log('No phone number set for pairing', 'red', true);
            return false;
        }
        
        log('Requesting pairing code...', 'cyan');
        
        // Small delay to ensure socket is ready
        await delay(2000);
        
        let code = await socket.requestPairingCode(global.phoneNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        
        log('\n=============================', 'cyan');
        log(`  Pairing Code: ${code}`, 'white');
        log('=============================\n', 'cyan');
        log('Enter code in WhatsApp: Settings => Linked Devices => Link a Device', 'blue');
        
        global.pairingCodeRequested = true;
        return true;
    } catch (err) {
        log(`Failed to get pairing code: ${err.message}`, 'red', true);
        return false;
    }
}

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

    log("", 'white');
    log("==================================", 'cyan');
    log("     LOGIN METHOD SELECTION       ", 'cyan');
    log("==================================", 'cyan');
    log("  1) Enter WhatsApp Number (Pair Code)", 'cyan');
    log("  2) Paste Session ID", 'cyan');
    log("==================================", 'cyan');
    log("", 'white');

    let choice = await question("Enter option number (1 or 2): ");
    choice = choice.trim();

    if (choice === '1') {
        log("Enter your WhatsApp number in international format.", 'yellow');
        log("Examples: 254712345678, 12025551234, 447911123456", 'blue');
        log("Do NOT include + sign or spaces.", 'yellow');
        let phone = await question("Your WhatsApp number: ");
        phone = phone.replace(/[^0-9]/g, '');
        if (phone.length < 10 || phone.length > 15) {
            log('Invalid number. Must be 10-15 digits in international format.', 'red');
            return getLoginMethod();
        }
        global.phoneNumber = phone;
        await saveLoginMethod('number');
        return 'number';
    } else if (choice === '2') {
        let sessionId = await question("Paste your Session ID: ");
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

            await delay(5000);
            process.exit(1);
        }
    }
}

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

async function handle408Error(statusCode) {
    if (statusCode !== DisconnectReason.connectionTimeout) return false;

    global.errorRetryCount++;
    let errorState = loadErrorCount();
    const MAX_RETRIES = 2;

    errorState.count = global.errorRetryCount;
    errorState.last_error_timestamp = Date.now();
    saveErrorCount(errorState);

    log(`Connection Timeout (408). Retry: ${global.errorRetryCount}/${MAX_RETRIES}`, 'yellow');

    if (global.errorRetryCount >= MAX_RETRIES) {
        log(`[MAX CONNECTION TIMEOUTS] REACHED. Exiting.`, 'white');
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        await delay(2000);
        process.exit(1);
    }
    return true;
}

function cleanupOldMessages() {
    let storedMessages = loadStoredMessages();
    let now = Math.floor(Date.now() / 1000);
    const maxMessageAge = 12 * 60 * 60;
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
setInterval(cleanupOldMessages, 2 * 60 * 60 * 1000);

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

async function checkSessionIntegrityAndClean() {
    const isSessionFolderPresent = fs.existsSync(sessionDir);
    const isValidSession = sessionExists();

    if (isSessionFolderPresent && !isValidSession) {
        log('Detected incomplete/junk session files. Cleaning up...', 'red');
        clearSessionFiles();
        log('Cleanup complete.', 'yellow');
    }
}

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

let connectionAttempt = 0;

async function startXeonBotInc() {
    connectionAttempt++;
    log(`Connecting to WhatsApp... (attempt #${connectionAttempt})`, 'cyan');

    let version;
    try {
        const versionInfo = await fetchLatestBaileysVersion();
        version = versionInfo.version;
        log(`Using WA version: ${version.join('.')}`, 'cyan');
    } catch (vErr) {
        log(`Failed to fetch latest version, using fallback: ${vErr.message}`, 'yellow');
        version = [2, 3000, 1015901307];
    }

    await fs.promises.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const msgRetryCounterCache = new NodeCache({ 
        stdTTL: 300, 
        checkperiod: 120,
        maxKeys: 30,
        useClones: false 
    });

    const pinoLogger = pino({ level: 'silent' });

    const socketConfig = {
        version,
        logger: pinoLogger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        fireInitQueries: true,
        emitOwnEvents: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 250,
        defaultQueryTimeoutMs: 30000,
        maxRetries: 5,
        getMessage: async (key) => {
            try {
                if (key?.id) {
                    const chatId = key.remoteJid;
                    if (global.messageBackup?.[chatId]?.[key.id]) {
                        return global.messageBackup[chatId][key.id].message;
                    }
                    try {
                        const db = require('./Database/database');
                        const stored = db.getMessage(key.id);
                        if (stored?.content) {
                            try {
                                return JSON.parse(stored.content);
                            } catch {
                                return { conversation: stored.content };
                            }
                        }
                    } catch {}
                }
            } catch (e) {}
            return "";
        },
        msgRetryCounterCache,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            return message;
        }
    };

    log('Creating socket with config...', 'cyan');
    const XeonBotInc = makeWASocket(socketConfig);
    log('Socket created, waiting for events...', 'cyan');

    if (store && store.bind) {
        store.bind(XeonBotInc.ev);
    }

    // FIXED: Request pairing code with better error handling
    if (global.phoneNumber && !global.pairingCodeRequested && !sessionExists()) {
        log('Pairing mode detected - will request code in 5 seconds...', 'yellow');
        
        setTimeout(async () => {
            try {
                log('Initiating pairing code request...', 'cyan');
                const success = await requestPairingCode(XeonBotInc);
                if (success) {
                    log('✅ Pairing code sent! Please check the console above.', 'green');
                    log('⏳ Waiting for you to link your device...', 'cyan');
                } else {
                    log('❌ Failed to request pairing code. Will retry...', 'yellow');
                    setTimeout(async () => {
                        await requestPairingCode(XeonBotInc);
                    }, 10000);
                }
            } catch (err) {
                log(`❌ Error in pairing: ${err.message}`, 'red', true);
            }
        }, 5000);
    }

    const connectionTimeout = setTimeout(() => {
        if (!global.isBotConnected) {
            log('⚠️ Connection taking longer than expected...', 'yellow');
            if (global.phoneNumber && !global.pairingCodeRequested) {
                log('If you haven\'t received a pairing code, the bot may be stuck. Restart manually.', 'red');
            }
        }
    }, 90000);

    XeonBotInc.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'connecting') {
            log('Connecting...', 'cyan');
        }

        if (qr) {
            log('QR code received (ignoring, using pairing code)', 'yellow');
        }

        if (connection === 'close') {
            clearTimeout(connectionTimeout);
            global.isBotConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (lastDisconnect?.error) {
                log(`Disconnect reason: ${lastDisconnect.error.message} (code: ${statusCode})`, 'red', true);
            }

            const permanentLogout = statusCode === DisconnectReason.loggedOut || statusCode === 401;

            if (permanentLogout) {
                log(`Logged out permanently!`, 'white');
                clearSessionFiles();
                process.exit(1);
            } else {
                const is408Handled = await handle408Error(statusCode);
                if (is408Handled) return;

                const reconnectDelay = Math.min((global.errorRetryCount + 1) * 5000, 30000);
                log(`Connection closed (code: ${statusCode}). Reconnecting in ${reconnectDelay/1000}s... (Attempt ${global.errorRetryCount + 1})`, 'yellow');
                await delay(reconnectDelay);
                startXeonBotInc();
            }
        } else if (connection === 'open') {
            clearTimeout(connectionTimeout);
            log('✅ Connected to WhatsApp!', 'green');

            connectionAttempt = 0;
            global.pairingCodeRequested = false;

            const botUser = XeonBotInc.user || {};
            const botNumber = (botUser.id || '').split(':')[0];
            log(`📱 Number : +${botNumber}`, 'cyan');

            const detectPlatform = () => {
                if (process.env.DYNO) return "Heroku";
                if (process.env.P_SERVER_UUID) return "Panel";
                return os.platform();
            };
            log(`💻 Platform: ${detectPlatform()}`, 'cyan');
            log(`🕐 Time : ${new Date().toLocaleString()}`, 'cyan');

            if (global.initPresenceOnConnect) {
                try { global.initPresenceOnConnect(XeonBotInc); } catch(e) {}
            }

            await sendWelcomeMessage(XeonBotInc);
        }
    });

    XeonBotInc.ev.on('messaging-history.set', () => {
        log('History sync received - skipping to reduce load', 'yellow');
    });

    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            if (getMemoryMB() > 320) {
                return;
            }

            const mek = chatUpdate.messages[0];
            if (!mek?.message) return;

            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? 
                mek.message.ephemeralMessage.message : mek.message;

            if (mek.key?.id && mek.message) {
                let chatId = mek.key.remoteJid;
                let messageId = mek.key.id;
                if (!global.messageBackup[chatId]) { 
                    global.messageBackup[chatId] = {}; 
                }
                
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

            if (mek.message?.protocolMessage) {
                const protocolType = mek.message.protocolMessage.type;
                
                if (protocolType === 0) {
                    log('Protocol message detected - handling deletion', 'cyan');
                    if (handleMessages) {
                        try { 
                            await handleMessages(XeonBotInc, chatUpdate, true); 
                        } catch(e) { 
                            log(e.message, 'red', true); 
                        }
                    }
                    return;
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
    if (smsg) XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

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
        setInterval(() => store.writeToFile(), settings.storeWriteInterval || 30000);

        log("Core files loaded.", 'green');
    } catch (e) {
        log(`FATAL: Failed to load core files: ${e.message}`, 'red', true);
        log(`Stack: ${e.stack?.split('\n').slice(0, 3).join('\n')}`, 'red', true);
        process.exit(1);
    }

    await checkAndHandleSessionFormat();
    global.errorRetryCount = loadErrorCount().count;

    const envSessionID = process.env.SESSION_ID?.trim();

    if (envSessionID && (envSessionID.startsWith('DAVE-AI') || envSessionID.startsWith('DAVE-X'))) {
        log("Using SESSION_ID from .env", 'magenta');
        global.SESSION_ID = envSessionID;

        if (sessionExists()) {
            log("Existing session found - reusing.", 'green');
        } else {
            log("Downloading session...", 'yellow');
            clearSessionFiles();
            await downloadSessionData();
            await saveLoginMethod('session');
        }

        log("Starting bot...", 'green');
        await startXeonBotInc();
        checkEnvStatus();
        return;
    }

    log("No SESSION_ID in .env. Checking stored session...", 'yellow');

    await checkSessionIntegrityAndClean();

    if (sessionExists()) {
        log("Valid stored session found, starting bot...", 'green');
        await startXeonBotInc();
        checkEnvStatus();
        return;
    }

    const loginMethod = await getLoginMethod();

    if (loginMethod === 'session') {
        await downloadSessionData();
        await startXeonBotInc();
    } else if (loginMethod === 'number') {
        log("Starting bot in pairing mode...", 'cyan');
        const XeonBotInc = await startXeonBotInc();
        // Pairing code will be requested inside startXeonBotInc
    }

    checkEnvStatus();
}

process.on('uncaughtException', (err) => {
    if (!err.message.includes('ECONNRESET') && 
        !err.message.includes('socket hang up') &&
        !err.message.includes('chalk') &&
        !err.message.includes('EPIPE') &&
        !err.message.includes('write after end')) {
        log(`Uncaught Exception: ${err.message}`, 'red', true);
    }
});

process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    if (!msg.includes('ECONNRESET') && 
        !msg.includes('socket hang up') &&
        !msg.includes('chalk') &&
        !msg.includes('EPIPE') &&
        !msg.includes('write after end')) {
        log(`Unhandled Rejection: ${msg}`, 'red', true);
    }
});

tylor().catch(err => log(`Fatal error: ${err.message}`, 'red', true));