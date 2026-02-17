const { getOwnerConfig, setOwnerConfig } = require('../Database/settingsStore');

const defaultEmojis = ['💞', '💘', '🥰', '💙','💓','💕'];

function loadAutoReactionState() {
    try {
        const config = getOwnerConfig('autoReaction');
        if (config && typeof config === 'object') {
            return {
                enabled: config.enabled || false,
                customReactions: Array.isArray(config.customReactions) 
                    ? config.customReactions 
                    : defaultEmojis
            };
        }
    } catch (error) {
        console.error('Error loading auto-reaction state:', error);
    }
    return {
        enabled: false,
        customReactions: defaultEmojis
    };
}

function saveAutoReactionState(state, customReactions = null) {
    try {
        const current = loadAutoReactionState();
        
        const reactionsToSave = Array.isArray(customReactions) 
            ? customReactions 
            : current.customReactions;
        
        const newConfig = {
            enabled: state,
            customReactions: reactionsToSave
        };
        
        setOwnerConfig('autoReaction', newConfig);
    } catch (error) {
        console.error('Error saving auto-reaction state:', error);
    }
}

function refreshAutoReactionConfig() {
    autoReactionConfig = loadAutoReactionState();
}

// Store auto-reaction state
let autoReactionConfig = loadAutoReactionState();

// Function to get random emoji from custom reactions
function getRandomEmoji() {
    const reactions = autoReactionConfig.customReactions;
    // Additional safety check to ensure it's an array
    if (!Array.isArray(reactions) || reactions.length === 0) {
        return defaultEmojis[Math.floor(Math.random() * defaultEmojis.length)];
    }
    return reactions[Math.floor(Math.random() * reactions.length)];
}

// Function to add reaction to a command message
async function addCommandReaction(sock, message) {
    try {
        if (!autoReactionConfig.enabled || !message?.key?.id) return;
        
        const emoji = getRandomEmoji();
        await sock.sendMessage(message.key.remoteJid, {
            react: {
                text: emoji,
                key: message.key
            }
        });
    } catch (error) {
        console.error('Error adding command reaction:', error);
    }
}

// Function to handle areact command
async function handleAreactCommand(sock, chatId, message, isOwner) {
    try {
        if (!isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!',
                quoted: message
            });
            return;
        }

        const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = messageText.split(' ');
        const action = args[1]?.toLowerCase();

        if (action === 'on') {
            autoReactionConfig.enabled = true;
            saveAutoReactionState(true, autoReactionConfig.customReactions);
            await sock.sendMessage(chatId, { 
                text: '✅ Auto-reactions have been enabled globally\n\nCustom reactions will be used for all commands!',
                quoted: message
            });
        } else if (action === 'off') {
            autoReactionConfig.enabled = false;
            saveAutoReactionState(false, autoReactionConfig.customReactions);
            await sock.sendMessage(chatId, { 
                text: '✅ Auto-reactions have been disabled globally',
                quoted: message
            });
        } else if (action === 'set') {
            // Handle custom reaction setting
            const customReactions = args.slice(2);
            
            if (customReactions.length === 0) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Please provide at least one emoji!\n\nExample: `.areact set 🎉 🚀 ⭐`',
                    quoted: message
                });
                return;
            }

            // Validate emojis (basic check)
            const validEmojis = customReactions.filter(emoji => 
                emoji.length <= 4 && /[\p{Emoji}]/u.test(emoji)
            );

            if (validEmojis.length === 0) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Please provide valid emojis!',
                    quoted: message
                });
                return;
            }

            autoReactionConfig.customReactions = validEmojis;
            saveAutoReactionState(autoReactionConfig.enabled, validEmojis);
            
            await sock.sendMessage(chatId, { 
                text: `✅ Custom reactions updated!\n\nNew reactions: ${validEmojis.join(' ')}\n\nAuto-reactions are currently ${autoReactionConfig.enabled ? 'enabled' : 'disabled'}`},
                { quoted: message
            });
        } else if (action === 'reset') {
            // Reset to default reactions
            autoReactionConfig.customReactions = defaultEmojis;
            saveAutoReactionState(autoReactionConfig.enabled, defaultEmojis);
            
            await sock.sendMessage(chatId, { 
                text: `✅ Custom reactions reset to default!\n\nDefault reactions: ${defaultEmojis.join(' ')}`,
                quoted: message
            });
        } else if (action === 'list') {
            // Show current custom reactions
            const currentReactions = autoReactionConfig.customReactions.join(' ');
            await sock.sendMessage(chatId, { 
                text: `📋 Current custom reactions:\n\n${currentReactions}\n\nAuto-reactions are ${autoReactionConfig.enabled ? '✅ enabled' : '❌ disabled'}`,
                quoted: message
            });
        } else {
            // Show help
            const currentState = autoReactionConfig.enabled ? 'enabled' : 'disabled';
            const currentReactions = autoReactionConfig.customReactions.join(' ');
            
            await sock.sendMessage(chatId, { 
                text: `⚙️ Auto-reactions are currently **${currentState}** globally.\n\n📋 Current reactions: ${currentReactions}\n\n**Commands:**\n• \`.areact on\` - Enable auto-reactions\n• \`.areact off\` - Disable auto-reactions\n• \`.areact set <emojis>\` - Set custom reactions\n• \`.areact reset\` - Reset to default reactions\n• \`.areact list\` - Show current reactions\n\n**Example:**\n\`.areact set 🎉 🚀 ⭐ 💫\``},
                { quoted: message
            });
        }
    } catch (error) {
        console.error('Error handling areact command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error controlling auto-reactions',
            quoted: message
        });
    }
}

module.exports = {
    addCommandReaction,
    handleAreactCommand,
    refreshAutoReactionConfig,
    getAutoReactionConfig: () => autoReactionConfig,
    defaultEmojis
};
