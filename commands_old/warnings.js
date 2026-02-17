const db = require('../Database/database');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function warningsCommand(sock, chatId, mentionedJidList, groupId) {
    if (mentionedJidList.length === 0) {
        await sock.sendMessage(chatId, { text: 'Please mention a user to check warnings.' });
        return;
    }

    const userToCheck = mentionedJidList[0];
    const targetGroup = groupId || chatId;
    
    try {
        const database = db.getDb();
        const stmt = database.prepare('SELECT count FROM warnings WHERE group_jid = ? AND user_jid = ?');
        const result = stmt.get(targetGroup, userToCheck);
        const warningCount = result ? result.count : 0;
        
        await sock.sendMessage(chatId, { text: `User has ${warningCount} warning(s).` });
    } catch (error) {
        console.error('Error fetching warnings:', error);
        await sock.sendMessage(chatId, { text: 'Error fetching warnings.' });
    }
}

module.exports = warningsCommand;
