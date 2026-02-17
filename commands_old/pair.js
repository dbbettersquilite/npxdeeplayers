const { createFakeContact, getBotName } = require('../lib/fakeContact');
const db = require('../Database/database');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { makeid } = require('../lib/id');

function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { recursive: true, force: true });
}

async function isAuthorized(sock, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (message.key.fromMe) return true;
        return db.isSudo(senderId);
    } catch {
        return message.key.fromMe;
    }
}

async function pairCommand(sock, chatId, q, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (!await isAuthorized(sock, message)) {
            return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fake });
        }

        if (!q) {
            return sock.sendMessage(chatId, {
                text: `*${botName} PAIR CODE*\n\nGenerate a session ID for any WhatsApp number.\n\n*Usage:* .pair <number>\n*Example:* .pair 254712345678\n\nNumber must be in international format without + sign.\n\n*Steps:*\n1. Send the command with the number\n2. You'll receive a pairing code\n3. On the target phone go to:\n   WhatsApp > Settings > Linked Devices > Link a Device\n4. Choose "Link with phone number"\n5. Enter the code\n6. Session ID will be generated automatically`
            }, { quoted: fake });
        }

        const phoneNumber = q.replace(/[^0-9]/g, '');

        if (phoneNumber.length < 10 || phoneNumber.length > 15) {
            return sock.sendMessage(chatId, { 
                text: `*${botName}*\nInvalid phone number!\nUse international format without + sign.\n\nExample: .pair 254712345678` 
            }, { quoted: fake });
        }

        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nGenerating pairing code for +${phoneNumber}...\nPlease wait...` 
        }, { quoted: fake });

        const id = makeid(10);
        const tempDir = path.join(process.cwd(), 'tmp', id);

        try {
            await fs.promises.mkdir(tempDir, { recursive: true });

            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            const pairSock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                version: [2, 3001, 7],
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser: Browsers.macOS('Chrome'),
                syncFullHistory: false,
                generateHighQualityLinkPreview: false
            });

            if (!pairSock.authState.creds.registered) {
                await delay(1500);
                
                let code;
                try {
                    code = await pairSock.requestPairingCode(phoneNumber);
                } catch (pairErr) {
                    await delay(3000);
                    try {
                        code = await pairSock.requestPairingCode(phoneNumber);
                    } catch (retryErr) {
                        removeFile(tempDir);
                        return sock.sendMessage(chatId, {
                            text: `*${botName}*\nFailed to generate pairing code.\nError: ${retryErr.message}\n\nPlease try again.`
                        }, { quoted: fake });
                    }
                }
                
                const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

                await sock.sendMessage(chatId, {
                    text: `*${botName} PAIRING CODE*\n\n*Phone:* +${phoneNumber}\n*Code:* ${formattedCode}\n\n_This code expires in 60 seconds._\n\n*Instructions:*\n1. Open WhatsApp on +${phoneNumber}\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Choose "Link with phone number instead"\n5. Enter the code: *${formattedCode}*\n\nWaiting for connection...`
                }, { quoted: fake });

                const result = await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        try { pairSock.ws.close(); } catch(e) {}
                        resolve({ success: false, reason: 'timeout' });
                    }, 120000);

                    pairSock.ev.on('creds.update', saveCreds);

                    pairSock.ev.on('connection.update', async (update) => {
                        const { connection, lastDisconnect } = update;

                        if (connection === 'open') {
                            try { await saveCreds(); } catch(e) {}
                            await delay(5000);
                            try { await saveCreds(); } catch(e) {}

                            clearTimeout(timeout);

                            const credsPath = path.join(tempDir, 'creds.json');

                            let retries = 0;
                            while (!fs.existsSync(credsPath) && retries < 5) {
                                await delay(1000);
                                try { await saveCreds(); } catch(e) {}
                                retries++;
                            }

                            if (fs.existsSync(credsPath)) {
                                try {
                                    const credsData = fs.readFileSync(credsPath, 'utf-8');
                                    const b64data = Buffer.from(credsData).toString('base64');
                                    const sessionId = `DAVE-X:~${b64data}`;

                                    try {
                                        let session = await pairSock.sendMessage(
                                            pairSock.user.id,
                                            { text: sessionId }
                                        );

                                        const sessionText = `\n` +
                                            `=====================\n` +
                                            `  SESSION CONNECTED\n` +
                                            `  DAVE-X Bot\n` +
                                            `  By Dave\n` +
                                            `=====================\n\n` +
                                            `You've chosen DAVE-X Bot!\n` +
                                            `Set the session ID in your deployment:\n` +
                                            `SESSION_ID: (check previous message)\n\n` +
                                            `=====================\n` +
                                            `  DAVE-X BOT\n` +
                                            `=====================`;

                                        await pairSock.sendMessage(
                                            pairSock.user.id,
                                            { text: sessionText },
                                            { quoted: session }
                                        );
                                    } catch (sendErr) {
                                        console.log('[PAIR] Could not send session to paired device:', sendErr.message);
                                    }

                                    await delay(100);
                                    try { pairSock.ws.close(); } catch(e) {}

                                    resolve({ success: true, sessionId, phoneNumber });
                                } catch(e) {
                                    resolve({ success: false, reason: 'creds_parse_error' });
                                }
                            } else {
                                resolve({ success: false, reason: 'no_creds' });
                            }

                        } else if (connection === 'close') {
                            const statusCode = lastDisconnect?.error?.output?.statusCode;
                            if (statusCode === 401 || statusCode === 403 || statusCode === 405) {
                                clearTimeout(timeout);
                                resolve({ success: false, reason: `auth_failed_${statusCode}` });
                            } else if (lastDisconnect && statusCode !== 401) {
                                await delay(10000);
                            }
                        }
                    });
                });

                if (result.success) {
                    await sock.sendMessage(chatId, {
                        text: `*${botName} SESSION GENERATED*\n\n*For:* +${phoneNumber}\n\n*Session ID:*\n\n${result.sessionId}\n\n*How to use:*\n1. Copy the entire session ID above\n2. Set it as the SESSION_ID environment variable\n3. Restart the bot\n\n_The session ID was also sent to the paired device._\n_Keep this session ID safe and private!_`
                    }, { quoted: fake });
                    
                    await sock.sendMessage(chatId, { text: result.sessionId }, { quoted: fake });
                } else {
                    let errorMsg = 'Connection timed out. The pairing code may have expired.';
                    if (result.reason === 'incomplete_creds') errorMsg = 'Session was created but credentials are incomplete. Try again.';
                    if (result.reason === 'no_creds') errorMsg = 'Could not save session credentials. Try again.';
                    if (result.reason === 'creds_parse_error') errorMsg = 'Error reading credentials. Try again.';
                    if (result.reason?.startsWith('auth_failed')) errorMsg = 'Authentication failed. Make sure the number is correct and try again.';
                    
                    await sock.sendMessage(chatId, { 
                        text: `*${botName}*\n${errorMsg}\n\nUse .pair ${phoneNumber} to try again.` 
                    }, { quoted: fake });
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `*${botName}*\nA session is already active for this temp folder. Cleaning up and trying again...`
                }, { quoted: fake });
            }

            removeFile(tempDir);

        } catch (innerErr) {
            console.error('Pair inner error:', innerErr.message);
            let errorMsg = innerErr.message;
            if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('ECONNREFUSED')) {
                errorMsg = 'Network error. Check your internet connection.';
            } else if (errorMsg.includes('rate')) {
                errorMsg = 'Too many attempts. Wait a few minutes and try again.';
            }
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\nFailed to generate pairing code: ${errorMsg}` 
            }, { quoted: fake });
            removeFile(tempDir);
        }

    } catch (error) {
        console.error('Pair command error:', error.message);
        const fake = createFakeContact(message?.key?.participant || message?.key?.remoteJid);
        await sock.sendMessage(chatId, { text: `*${getBotName()}*\nError: ${error.message}` }, { quoted: fake });
    }
}

module.exports = pairCommand;
