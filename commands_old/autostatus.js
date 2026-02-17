const { getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
const emojis = ['❤️', '😂', '😮', '😢', '😡', '👏', '🔥', '⭐', '🎉', '🙏'];

function getRandomEmoji() {
    return emojis[Math.floor(Math.random() * emojis.length)];
}

const sportsQuotes = [
    "The goal is not to be perfect, but to be better than yesterday.",
    "🥊 Champions aren't made in the gyms. Champions are made from something they have deep inside them.",
    "🏆 Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing.",
    "💪 The pain you feel today will be the strength you feel tomorrow.",
    "🤼 The only way to prove you are a good sport is to lose.",
    "🥇 Don't wish it were easier, wish you were better.",
    "🔥 The only person you should try to be better than is the person you were yesterday.",
    "👑 It's not whether you get knocked down, it's whether you get up.",
    "⚡ The difference between the impossible and the possible lies in a person's determination.",
    "🎖️ You miss 100% of the shots you don't take.",
    "🤺 The harder the battle, the sweeter the victory.",
    "💥 If you can believe it, the mind can achieve it.",
    "🥋 The greatest glory in living lies not in never falling, but in rising every time we fall.",
    "🏅 I've failed over and over again in my life. And that is why I succeed.",
    "🎽 The only limit to our realization of tomorrow will be our doubts of today."
];

function getRandomQuote() {
    return sportsQuotes[Math.floor(Math.random() * sportsQuotes.length)];
}

const DEFAULT_AUTOSTATUS_CONFIG = { 
    enabled: true,
    reactOn: false,
    reactionEmoji: '🖤',
    randomReactions: true 
};

function readConfig() {
    try {
        const config = getOwnerConfig('autostatus');
        if (!config || typeof config !== 'object') {
            return { ...DEFAULT_AUTOSTATUS_CONFIG };
        }
        return { ...DEFAULT_AUTOSTATUS_CONFIG, ...config };
    } catch (error) {
        console.error('Config error:', error);
        return { ...DEFAULT_AUTOSTATUS_CONFIG };
    }
}

function writeConfig(config) {
    try {
        setOwnerConfig('autostatus', config);
        return true;
    } catch (error) {
        console.error('Config write error:', error);
        return false;
    }
}

async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        const fakeContact = createFakeContact(msg);
        const { isSudo } = require('../lib/index');
        const senderId = msg.key.participant || msg.key.remoteJid;
        const senderIsSudo = await isSudo(senderId);
        const isOwner = msg.key.fromMe || senderIsSudo;
        
        if (!isOwner) {
            await sock.sendMessage(chatId, { text: 'Owner only' }, { quoted: fakeContact });
            return;
        }

        let config = readConfig();

        if (!args || args.length === 0) {
            const text = `Auto Status: ${config.enabled ? 'ON' : 'OFF'}\n` +
                        `Reactions: ${config.reactOn ? 'ON' : 'OFF'}\n` +
                        `Emoji: ${config.reactionEmoji}\n` +
                        `Random: ${config.randomReactions ? 'ON' : 'OFF'}\n\n` +
                        `Commands: on, off, react on/off, emoji <emoji>, random on/off, reset\n\n` +
                        `${getRandomQuote()}`;
            
            await sock.sendMessage(chatId, { text }, { quoted: fakeContact });
            return;
        }

        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            if (writeConfig(config)) {
                await sock.sendMessage(chatId, { text: `Auto status successfully enabled\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        } 
        else if (command === 'off') {
            config.enabled = false;
            if (writeConfig(config)) {
                await sock.sendMessage(chatId, { text: `Auto status successfully disabled\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        } 
        else if (command === 'react') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { text: `Use: react on/off\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                return;
            }
            
            const reactCommand = args[1].toLowerCase();
            if (reactCommand === 'on') {
                config.reactOn = true;
                if (writeConfig(config)) {
                    const reactionType = config.randomReactions ? 'random' : config.reactionEmoji;
                    await sock.sendMessage(chatId, { text: `Successfully enabled autoreactstatus: ${reactionType}\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                }
            } else if (reactCommand === 'off') {
                config.reactOn = false;
                if (writeConfig(config)) {
                    await sock.sendMessage(chatId, { text: `Successfully disabled autoreactstatus\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                }
            } else {
                await sock.sendMessage(chatId, { text: `Invalid: react on/off\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        }
        else if (command === 'emoji') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { text: `Emoji required\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                return;
            }
            
            const newEmoji = args[1].trim();
            config.reactionEmoji = newEmoji;
            if (writeConfig(config)) {
                await sock.sendMessage(chatId, { text: `Successfully set emoji: ${newEmoji}\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        }
        else if (command === 'random') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { text: `Use: random on/off\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                return;
            }
            
            const randomCommand = args[1].toLowerCase();
            if (randomCommand === 'on') {
                config.randomReactions = true;
                if (writeConfig(config)) {
                    await sock.sendMessage(chatId, { text: `Successfully enabled random reactions\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                }
            } else if (randomCommand === 'off') {
                config.randomReactions = false;
                if (writeConfig(config)) {
                    await sock.sendMessage(chatId, { text: `Successfully disabled random (using: ${config.reactionEmoji})\n\n${getRandomQuote()}` }, { quoted: fakeContact });
                }
            } else {
                await sock.sendMessage(chatId, { text: `Invalid: random on/off\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        }
        else if (command === 'reset') {
            const defaultConfig = { 
                enabled: true,
                reactOn: false,
                reactionEmoji: '🖤',
                randomReactions: true 
            };
            if (writeConfig(defaultConfig)) {
                await sock.sendMessage(chatId, { text: `Successfully reset settings to default\n\n${getRandomQuote()}` }, { quoted: fakeContact });
            }
        }
        else {
            await sock.sendMessage(chatId, { text: `Invalid command\n\n${getRandomQuote()}` }, { quoted: fakeContact });
        }

    } catch (error) {
        console.error('AutoStatus error:', error);
        const fakeContact = createFakeContact(msg);
        await sock.sendMessage(chatId, { text: `Error\n\n${getRandomQuote()}` }, { quoted: fakeContact });
    }
}

function isAutoStatusEnabled() {
    try {
        const config = readConfig();
        return config.enabled;
    } catch (error) {
        console.error('Status check error:', error);
        return false;
    }
}

function isStatusReactionEnabled() {
    try {
        const config = readConfig();
        return config.reactOn;
    } catch (error) {
        console.error('Reaction check error:', error);
        return false;
    }
}

function getReactionEmoji() {
    try {
        const config = readConfig();
        
        if (config.randomReactions) {
            return getRandomEmoji();
        }
        
        return config.reactionEmoji || '🖤';
    } catch (error) {
        console.error('Emoji error:', error);
        return '🖤';
    }
}

function isRandomReactionsEnabled() {
    try {
        const config = readConfig();
        return config.randomReactions !== false;
    } catch (error) {
        console.error('Random check error:', error);
        return true;
    }
}

async function reactToStatus(sock, statusKey) {
    try {
        if (!isStatusReactionEnabled()) {
            return;
        }

        const emoji = getReactionEmoji();

        await sock.relayMessage(
            'status@broadcast',
            {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: statusKey.participant || statusKey.remoteJid,
                        fromMe: false
                    },
                    text: emoji
                }
            },
            {
                messageId: statusKey.id,
                statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
            }
        );
        
    } catch (error) {
        console.error('React error:', error.message);
    }
}

async function handleStatusUpdate(sock, status) {
    try {
        if (!isAutoStatusEnabled()) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        let statusKey = null;

        if (status.messages && status.messages.length > 0) {
            statusKey = status.messages[0].key;
        } else if (status.key) {
            statusKey = status.key;
        } else if (status.reaction && status.reaction.key) {
            statusKey = status.reaction.key;
        }

        if (statusKey && statusKey.remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([statusKey]);
                await reactToStatus(sock, statusKey);
                
            } catch (err) {
                if (err.message?.includes('rate-overlimit')) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sock.readMessages([statusKey]);
                } else {
                    console.error('Status error:', err.message);
                }
            }
        }

    } catch (error) {
        console.error('Status update error:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate,
    isAutoStatusEnabled,
    isStatusReactionEnabled,
    getReactionEmoji,
    isRandomReactionsEnabled,
    getRandomEmoji
};