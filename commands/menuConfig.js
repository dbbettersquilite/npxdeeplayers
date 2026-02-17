const { 
    setMenuStyle, 
    getMenuSettings, 
    toggleMenuSetting, 
    MENU_STYLES,
    setMenuSettings
} = require('./menuSettings');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function menuConfigCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const fakeContact = createFakeContact(senderId);
    const botName = getBotName();

    if (args.length === 0) {
        // Show current settings
        const settings = getMenuSettings();
        let configMessage = `*${botName} MENU CONFIG*\n\n`;
        configMessage += `*Current Style:* ${settings.menuStyle} (${MENU_STYLES[settings.menuStyle]})\n`;
        configMessage += `*Show Memory:* ${settings.showMemory ? 'ON' : 'OFF'}\n`;
        configMessage += `*Show Uptime:* ${settings.showUptime ? 'ON' : 'OFF'}\n`;
        configMessage += `*Show Progress Bar:* ${settings.showProgressBar ? 'ON' : 'OFF'}\n\n`;

        configMessage += `*Available Styles:*\n`;
        for (const [style, description] of Object.entries(MENU_STYLES)) {
            configMessage += `${style}: ${description}\n`;
        }

        configMessage += `\n*Usage:*\n`;
        configMessage += `.menustyle <1-6> - Set menu style\n`;
        configMessage += `.menustyle memory - Toggle memory display\n`;
        configMessage += `.menustyle uptime - Toggle uptime display\n`;
        configMessage += `.menustyle progress - Toggle progress bar`;

        await sock.sendMessage(chatId, { text: configMessage }, { quoted: fakeContact });
        return;
    }

    const action = args[0].toLowerCase();

    try {
        if (['1', '2', '3', '4', '5', '6'].includes(action)) {
            if (setMenuStyle(action)) {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nMenu style set to: ${MENU_STYLES[action]}` 
                }, { quoted: fakeContact });
            } else {
                await sock.sendMessage(chatId, { 
                    text: `*${botName}*\nFailed to set menu style` 
                }, { quoted: fakeContact });
            }
            return;
        }

        const settingMap = {
            'memory': 'showMemory',
            'uptime': 'showUptime', 
            'progress': 'showProgressBar'
        };

        const settingKey = settingMap[action];
        if (settingKey) {
            const newValue = toggleMenuSetting(settingKey);
            await sock.sendMessage(chatId, { 
                text: `*${botName}*\n${action} display: ${newValue ? 'ON' : 'OFF'}` 
            }, { quoted: fakeContact });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nInvalid option! Use: 1-6, memory, uptime, progress` 
        }, { quoted: fakeContact });

    } catch (error) {
        console.error('Error in menu config:', error.message, 'Line:', error.stack?.split('\n')[1]);
        await sock.sendMessage(chatId, { 
            text: `*${botName}*\nAn error occurred!` 
        }, { quoted: fakeContact });
    }
}

module.exports = menuConfigCommand;