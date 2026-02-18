const config = require('./config');
/*━━━━━━━━━━━━━━━━━━━━*/
require('dotenv').config(); // CRITICAL: Load .env variables first!

const fs = require('fs')
const chalk = require('chalk')
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

// --- Memory Usage Function ---
function getMemoryMB() {
    try {
        const used = process.memoryUsage();
        return Math.round(used.heapUsed / 1024 / 1024);
    } catch (e) {
        return 0;
    }
}

// --- 🌟 Centralized Logging Function ---
function log(message, color = 'white', isError = false) {
    const prefix = chalk.magenta.bold('[ DAVE-X ]');
    const logFunc = isError ? console.error : console.log;
    const coloredMessage = chalk[color](message);
    
    if (message.includes('\n') || message.includes('════')) {
        logFunc(prefix, coloredMessage);
    } else {
        logFunc(`${prefix} ${coloredMessage}`);
    }
}

// --- GLOBAL FLAGS ---
global.isBotConnected = false; 
global.connectDebounceTimeout = null;
global.errorRetryCount = 0;

// --- MODULE VARIABLES ---
let smsg, handleMessages, handleGroupParticipantUpdate, handleStatus, store, settings;

// --- MESSAGE STORAGE ---
const MESSAGE_STORE_FILE = path.join(__dirname, 'message_backup.json');
const SESSION_ERROR_FILE = path.join(__dirname, 'sessionErrorCount.json');
global.messageBackup = {};

function loadStoredMessages() {
    try {
        if (fs.existsSync(MESSAGE_STORE_FILE)) {
            const data = fs.readFileSync(MESSAGE_STORE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        log(`Error loading message backup store: ${error.message}`, 'red', true);
    }
    return {};
}

function saveStoredMessages(data) {
    try {
        fs.writeFileSync(MESSAGE_STORE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        log(`Error saving message backup store: ${error.message}`, 'red', true);
    }
}
global.messageBackup = loadStoredMessages();

// --- Error Counter Helpers ---
function loadErrorCount() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            const data = fs.readFileSync(SESSION_ERROR_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        log(`Error loading session error count: ${error.message}`, 'red', true);
    }
    return { count: 0, last_error_timestamp: 0 };
}

function saveErrorCount(data) {
    try {
        fs.writeFileSync(SESSION_ERROR_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        log(`Error saving session error count: ${error.message}`, 'red', true);
    }
}

function deleteErrorCountFile() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            fs.unlinkSync(SESSION_ERROR_FILE);
            log('✅ Deleted sessionErrorCount.json.', 'red');
        }
    } catch (e) {
        log(`Failed to delete sessionErrorCount.json: ${e.message}`, 'red', true);
    }
}

// --- CLEANUP FUNCTIONS ---
function clearSessionFiles() {
    try {
        log('🗑️ Clearing session folder...', 'blue');
        if (fs.existsSync(sessionDir)) {
            rmSync(sessionDir, { recursive: true, force: true });
        }
        if (fs.existsSync(loginFile)) fs.unlinkSync(loginFile);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        log('✅ Session files cleaned successfully.', 'green');
    } catch (e) {
        log(`Failed to clear session files: ${e.message}`, 'red', true);
    }
}

function cleanupOldMessages() {
    try {
        let storedMessages = loadStoredMessages();
        let now = Math.floor(Date.now() / 1000);
        const maxMessageAge = 24 * 60 * 60;
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
        log("🧹 [Msg Cleanup] Old messages removed", 'yellow');
    } catch (e) {
        log(`Error in cleanupOldMessages: ${e.message}`, 'red', true);
    }
}

function cleanupJunkFiles(botSocket) {
    try {
        let directoryPath = path.join(__dirname); 
        fs.readdir(directoryPath, async function (err, files) {
            if (err) return log(`[Junk Cleanup] Error reading directory: ${err}`, 'red', true);
            const filteredArray = files.filter(item =>
                item.endsWith(".gif") || item.endsWith(".png") || item.endsWith(".mp3") ||
                item.endsWith(".mp4") || item.endsWith(".opus") || item.endsWith(".jpg") ||
                item.endsWith(".webp") || item.endsWith(".webm") || item.endsWith(".zip")
            );
            if (filteredArray.length > 0) {
                let teks = `Detected ${filteredArray.length} junk files,\nJunk files have been deleted🚮`;
                if (botSocket && botSocket.user && botSocket.user.id) {
                    try {
                        botSocket.sendMessage(botSocket.user.id.split(':')[0] + '@s.whatsapp.net', { text: teks });
                    } catch (e) {}
                }
                filteredArray.forEach(function (file) {
                    const filePath = path.join(directoryPath, file);
                    try {
                        if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    } catch(e) {}
                });
                log(`[Junk Cleanup] ${filteredArray.length} files deleted.`, 'yellow');
            }
        });
    } catch (e) {}
}

// --- DAVE-X CONFIGURATION ---
global.botname = "DAVE-X"
global.themeemoji = "•"
const pairingCode = !!global.phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// --- Readline setup with faster response ---
const rl = process.stdin.isTTY ? readline.createInterface({ 
    input: process.stdin, 
    output: process.stdout,
    terminal: true 
}) : null

const question = (text) => rl ? new Promise(resolve => {
    rl.question(text, resolve);
}) : Promise.resolve(settings?.ownerNumber || global.phoneNumber)

// --- Paths ---
const sessionDir = path.join(__dirname, 'session')
const credsPath = path.join(sessionDir, 'creds.json')
const loginFile = path.join(sessionDir, 'login.json')
const envPath = path.join(process.cwd(), '.env');

// --- Login persistence ---
async function saveLoginMethod(method) {
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true });
        await fs.promises.writeFile(loginFile, JSON.stringify({ method }, null, 2));
    } catch (e) {}
}

async function getLastLoginMethod() {
    try {
        if (fs.existsSync(loginFile)) {
            const data = JSON.parse(fs.readFileSync(loginFile, 'utf-8'));
            return data.method;
        }
    } catch (e) {}
    return null;
}

// --- Session check ---
function sessionExists() {
    return fs.existsSync(credsPath);
}

/**
 * Check if SESSION_ID starts with "DAVE-AI~"
 */
async function checkAndHandleSessionFormat() {
    const sessionId = process.env.SESSION_ID;
    
    if (sessionId && sessionId.trim() !== '') {
        if (!sessionId.trim().startsWith('DAVE-AI:~')) {
            log(chalk.white.bgRed('[ERROR]: Invalid SESSION_ID in .env'), 'white');
            log(chalk.white.bgRed('[SESSION ID] MUST start with "DAVE-AI:~".'), 'white');
            log(chalk.white.bgRed('Cleaning .env and creating new one...'), 'white');
            
            try {
                let envContent = fs.readFileSync(envPath, 'utf8');
                envContent = envContent.replace(/^SESSION_ID=.*$/m, 'SESSION_ID=');
                fs.writeFileSync(envPath, envContent);
                log('✅ Cleaned SESSION_ID entry in .env file.', 'green');
                log('Please add a proper session ID and restart the bot.', 'yellow');
            } catch (e) {
                log(`Failed to modify .env file: ${e.message}`, 'red', true);
            }
            
            log('Bot will wait 30 seconds then restart', 'blue');
            await delay(20000);
            process.exit(1);
        }
    }
}

// --- Get login method with improved validation and speed ---
async function getLoginMethod() {
    try {
        const lastMethod = await getLastLoginMethod();
        if (lastMethod && sessionExists()) {
            log(`Last login method detected: ${lastMethod}. Using it automatically.`, 'blue');
            return lastMethod;
        }
        
        if (!sessionExists() && fs.existsSync(loginFile)) {
            log(`Session files missing. Removing old login preference.`, 'blue');
            fs.unlinkSync(loginFile);
        }

        if (!process.stdin.isTTY) {
            log("❌ No Session ID found in environment variables.", 'red');
            process.exit(1);
        }

        console.log('\n' + chalk.magenta('╔════════════════════════════════════╗'));
        console.log(chalk.magenta('║         DAVE-X BOT LOGIN           ║'));
        console.log(chalk.magenta('╚════════════════════════════════════╝\n'));

        log("Choose login method:", 'yellow');
        log("1) Enter WhatsApp Number (Pairing Code)", 'blue');
        log("2) Paste Session ID", 'blue');
        console.log('');

        let choice = await question(chalk.cyan("Enter option number (1 or 2): "));
        choice = choice.trim();

        if (choice === '1') {
            console.log('');
            log("Please enter your WhatsApp number with country code", 'yellow');
            log("Example: 254712345678 (Kenya), 919876543210 (India)", 'cyan');
            console.log('');
            
            let phone = await question(chalk.green("WhatsApp Number: "));
            phone = phone.replace(/[^0-9]/g, '');
            
            // Quick validation
            if (phone.length < 10 || phone.length > 15) {
                log('❌ Invalid phone number length. Please try again.', 'red');
                await delay(1000);
                return getLoginMethod();
            }
            
            // Use awesome-phonenumber for validation
            const pn = new PhoneNumber('+' + phone);
            if (!pn.isValid()) { 
                log('❌ Invalid phone number format. Please try again.', 'red');
                await delay(1000);
                return getLoginMethod();
            }
            
            global.phoneNumber = phone;
            await saveLoginMethod('number');
            log('✅ Phone number accepted!', 'green');
            log('⏳ Starting bot with pairing code...', 'yellow');
            await delay(500);
            return 'number';
            
        } else if (choice === '2') {
            console.log('');
            log("Paste your Session ID", 'yellow');
            log("Format: DAVE-AI:~[base64 data]", 'cyan');
            console.log('');
            
            let sessionId = await question(chalk.green("Session ID: "));
            sessionId = sessionId.trim();
            
            if (!sessionId.includes("DAVE-AI:~")) { 
                log("❌ Invalid Session ID format! Must contain 'DAVE-AI~'.", 'red'); 
                await delay(1000);
                return getLoginMethod();
            }
            
            global.SESSION_ID = sessionId;
            await saveLoginMethod('session');
            log('✅ Session ID accepted!', 'green');
            log('⏳ Downloading session data...', 'yellow');
            await delay(500);
            return 'session';
            
        } else {
            log("❌ Invalid option! Please choose 1 or 2.", 'red');
            await delay(1000);
            return getLoginMethod();
        }
    } catch (e) {
        log(`Error in getLoginMethod: ${e.message}`, 'red', true);
        throw e;
    }
}

// --- Download session ---
async function downloadSessionData() {
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true });
        if (!fs.existsSync(credsPath) && global.SESSION_ID) {
            const base64Data = global.SESSION_ID.includes("DAVE-AI:~") ? 
                global.SESSION_ID.split("DAVE-AI:~")[1] : global.SESSION_ID;
            const sessionData = Buffer.from(base64Data, 'base64');
            await fs.promises.writeFile(credsPath, sessionData);
            log('✅ Session successfully saved.', 'green');
        }
    } catch (err) { 
        log(`❌ Error downloading session data: ${err.message}`, 'red', true); 
    }
}

// --- Request pairing code with better feedback ---
async function requestPairingCode(socket) {
    try {
        log('⏳ Requesting pairing code...', 'yellow');
        await delay(2000); // Reduced from 3 seconds

        let code = await socket.requestPairingCode(global.phoneNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        
        console.log('\n' + chalk.bgGreen.black('════════════ YOUR PAIRING CODE ════════════'));
        console.log(chalk.bgGreen.black(`              ${code}              `));
        console.log(chalk.bgGreen.black('═══════════════════════════════════════════\n'));
        
        log('📱 Instructions:', 'blue');
        log('1. Open WhatsApp on your phone', 'white');
        log('2. Go to Settings → Linked Devices', 'white');
        log('3. Tap "Link a Device"', 'white');
        log('4. Enter the code above', 'white');
        console.log('');
        
        return true; 
    } catch (err) { 
        log(`❌ Failed to get pairing code: ${err.message}`, 'red', true); 
        return false; 
    }
}

// --- Welcome Message ---
async function sendWelcomeMessage(XeonBotInc) {
    try {
        if (global.isBotConnected) return; 
        
        await delay(5000); // Reduced from 10 seconds

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

        if (!XeonBotInc.user) {
            log('No user data available', 'yellow');
            return;
        }

        try {
            const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
            const time = new Date().toLocaleString();

            await XeonBotInc.sendMessage(botNumber, {
                text: `
╔════════════════════════╗
║    DAVE-X CONNECTED    ║
╠════════════════════════╣
║ 🤖 Bot: DAVE-X
║ 📱 Number: ${global.phoneNumber || 'Connected'}
║ 💻 Host: ${hostName}
║ ⏰ Time: ${time}
║ ✅ Status: Active
╚════════════════════════╝`
            });

            log('✅ Welcome message sent', 'green');
        } catch (error) {
            log(`Welcome message failed: ${error.message}`, 'yellow');
        }

        await delay(1000);
        deleteErrorCountFile();
        global.errorRetryCount = 0;
        global.isBotConnected = true;
        
        log('✅ DAVE-X is now fully connected and ready!', 'green');
        
    } catch (e) {
        log(`Error in sendWelcomeMessage: ${e.message}`, 'red', true);
    }
}

// --- Handle 408 errors ---
async function handle408Error(statusCode) {
    try {
        if (statusCode !== DisconnectReason.connectionTimeout) return false;
        
        global.errorRetryCount++;
        let errorState = loadErrorCount();
        const MAX_RETRIES = 3;
        
        errorState.count = global.errorRetryCount;
        errorState.last_error_timestamp = Date.now();
        saveErrorCount(errorState);

        log(`Connection Timeout (408) detected. Retry count: ${global.errorRetryCount}/${MAX_RETRIES}`, 'yellow');
        
        if (global.errorRetryCount >= MAX_RETRIES) {
            log(chalk.white.bgRed(`[MAX CONNECTION TIMEOUTS] REACHED. Exiting...`), 'white');
            deleteErrorCountFile();
            global.errorRetryCount = 0;
            await delay(5000);
            process.exit(1);
        }
        return true;
    } catch (e) {
        return false;
    }
}

// --- Start bot ---
async function startXeonBotInc() {
    try {
        log('🔄 Connecting to WhatsApp...', 'cyan');
        const { version } = await fetchLatestBaileysVersion();
        
        await fs.promises.mkdir(sessionDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false, 
            browser: ["DAVE-X", "Chrome", "1.0.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: true,
            getMessage: async (key) => {
                try {
                    let jid = jidNormalizedUser(key.remoteJid);
                    if (store && store.loadMessage) {
                        let msg = await store.loadMessage(jid, key.id); 
                        return msg?.message || "";
                    }
                    return "";
                } catch (e) {
                    return "";
                }
            },
            msgRetryCounterCache
        });

        if (store && store.bind) {
            try {
                store.bind(XeonBotInc.ev);
            } catch (e) {}
        }

        // Message handler
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                if (getMemoryMB() > 320) return;

                const mek = chatUpdate.messages[0];
                if (!mek || !mek.message) return;

                if (mek.message.ephemeralMessage) {
                    mek.message = mek.message.ephemeralMessage.message;
                }

                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    if (handleStatus) await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }

                if (!global.isBotConnected) return;

                if (handleMessages) {
                    await handleMessages(XeonBotInc, chatUpdate, false);
                }
            } catch(e) {
                // Silently handle errors
            }
        });

        // Connection update handler
        XeonBotInc.ev.on('connection.update', async (update) => {
            try {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    global.isBotConnected = false; 
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const permanentLogout = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                    
                    if (permanentLogout) {
                        log(chalk.bgRed.black(`\n💥 Disconnected! Session expired.`), 'red');
                        clearSessionFiles();
                        log('🔄 Restarting in 5 seconds...', 'blue');
                        await delay(5000);
                        process.exit(1); 
                    } else {
                        const is408Handled = await handle408Error(statusCode);
                        if (is408Handled) return;
                        
                        log(`🔄 Reconnecting...`, 'yellow');
                        startXeonBotInc(); 
                    }
                } else if (connection === 'open') {           
                    console.log(chalk.yellow(`\n✅ Connected as: `) + chalk.green(XeonBotInc.user?.name || 'DAVE-X'));
                    log('🚀 DAVE-X is online!', 'green');
                    await sendWelcomeMessage(XeonBotInc);
                }
            } catch (e) {}
        });

        XeonBotInc.ev.on('creds.update', saveCreds);

        // Group participant updates
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            if (!global.isBotConnected) return;
            if (handleGroupParticipantUpdate) {
                await handleGroupParticipantUpdate(XeonBotInc, update);
            }
        });

        XeonBotInc.public = true;

        // Call handler
        XeonBotInc.ev.on('call', async (calls) => {
            if (!global.isBotConnected) return;
            try {
                const { handleIncomingCall } = require('./commands/anticall');
                for (const call of calls) {
                    await handleIncomingCall(XeonBotInc, call);
                }
            } catch (e) {}
        });

        // Message edit handler
        XeonBotInc.ev.on('messages.update', async (messageUpdates) => {
            if (!global.isBotConnected) return;
            try {
                const { handleMessageUpdate } = require('./commands/antiedit');
                for (const update of messageUpdates) {
                    await handleMessageUpdate(XeonBotInc, update);
                }
            } catch (error) {}
        });

        if (smsg) {
            XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);
        }

        // Background cleanup intervals
        setInterval(cleanupOldMessages, 60 * 60 * 1000); // Every hour
        setInterval(() => cleanupJunkFiles(XeonBotInc), 30000); // Every 30 seconds

        return XeonBotInc;
    } catch (e) {
        log(`Fatal error: ${e.message}`, 'red', true);
        throw e;
    }
}

// --- Session integrity check ---
async function checkSessionIntegrityAndClean() {
    try {
        const isSessionFolderPresent = fs.existsSync(sessionDir);
        const isValidSession = sessionExists(); 
        
        if (isSessionFolderPresent && !isValidSession) {
            log('⚠️ Detected incomplete session files...', 'red');
            clearSessionFiles(); 
            log('Cleanup complete. Waiting 3 seconds...', 'yellow');
            await delay(3000);
        }
    } catch (e) {}
}

// --- .env File Watcher ---
function checkEnvStatus() {
    try {
        if (fs.existsSync(envPath)) {
            fs.watch(envPath, { persistent: false }, (eventType) => {
                if (eventType === 'change') {
                    log(chalk.bgRed.black('\n🔄 .env changed, restarting...\n'), 'white');
                    process.exit(1);
                }
            });
        }
    } catch (e) {}
}

// --- Suppress noisy errors ---
const stderrNoisy = [
    /bad mac/i, /hmac/i, /decrypt/i, /failed to decrypt/i,
    /error in ws/i, /stream errored/i, /precondition/i
];

const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk, ...args) {
    try {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();
        if (stderrNoisy.some(p => p.test(str))) return true;
        return origStderr(chunk, ...args);
    } catch (e) {
        return origStderr(chunk, ...args);
    }
};

// --- Main function ---
async function tylor() {
    try {
        // Load core files
        try {
            require('./settings');
            const mainModules = require('./main');
            handleMessages = mainModules.handleMessages;
            handleGroupParticipantUpdate = mainModules.handleGroupParticipantUpdate;
            handleStatus = mainModules.handleStatus;

            const myfuncModule = require('./lib/myfunc');
            smsg = myfuncModule.smsg;

            store = require('./lib/lightweight_store');
            if (store && store.readFromFile) {
                store.readFromFile();
            }
            settings = require('./settings');

            log('✅ Core files loaded', 'green');
        } catch (e) {
            log(`❌ Failed to load core files: ${e.message}`, 'red', true);
            process.exit(1);
        }
        
        // Check session format
        await checkAndHandleSessionFormat();
        
        // Load error count
        global.errorRetryCount = loadErrorCount().count;
        
        // Check for SESSION_ID in .env
        const envSessionID = process.env.SESSION_ID?.trim();

        if (envSessionID && envSessionID.startsWith('DAVE-AI')) { 
            log('📦 Found SESSION_ID in .env', 'magenta');
            
            clearSessionFiles(); 
            global.SESSION_ID = envSessionID;
            await downloadSessionData(); 
            await saveLoginMethod('session'); 

            log('✅ Using session from .env', 'green');
            await delay(2000);
            await startXeonBotInc();
            checkEnvStatus();
            return;
        }
        
        log('ℹ️ No SESSION_ID in .env, checking stored session...', 'blue');

        await checkSessionIntegrityAndClean();
        
        if (sessionExists()) {
            log('✅ Found stored session, starting bot...', 'green'); 
            await delay(2000);
            await startXeonBotInc();
            checkEnvStatus();
            return;
        }
        
        // Interactive login
        const loginMethod = await getLoginMethod();
        let XeonBotInc;

        if (loginMethod === 'session') {
            await downloadSessionData();
            XeonBotInc = await startXeonBotInc(); 
        } else if (loginMethod === 'number') {
            XeonBotInc = await startXeonBotInc();
            await requestPairingCode(XeonBotInc); 
        }
        
        // Cleanup if number login fails
        if (loginMethod === 'number' && !sessionExists() && fs.existsSync(sessionDir)) {
            log('❌ Login failed, cleaning up...', 'red');
            clearSessionFiles();
            process.exit(1);
        }
        
        checkEnvStatus();
        
    } catch (err) {
        log(`Fatal error: ${err.message}`, 'red', true);
        process.exit(1);
    }
}

// --- Start the bot ---
tylor().catch(err => log(`Fatal error: ${err.message}`, 'red', true));

// --- Process handlers ---
process.on('uncaughtException', (err) => {
    if (!err.message.includes('ECONNRESET') && !err.message.includes('stream')) {
        log(`Uncaught Exception: ${err.message}`, 'red', true);
    }
});

process.on('unhandledRejection', (err) => {
    if (!err.message.includes('ECONNRESET') && !err.message.includes('stream')) {
        log(`Unhandled Rejection: ${err.message}`, 'red', true);
    }
});