const fs = require('fs');
const path = require('path');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

async function resolveToPhone(sock, jid) {
    if (!jid) return 'unknown';
    const raw = jid.split('@')[0].split(':')[0];
    if (/^\d{7,15}$/.test(raw)) return raw;
    try {
        if (sock?.signalRepository?.lidMapping?.getPNForLID) {
            const formats = [jid, `${raw}:0@lid`, `${raw}@lid`];
            for (const fmt of formats) {
                try {
                    const pn = await sock.signalRepository.lidMapping.getPNForLID(fmt);
                    if (pn) {
                        const num = String(pn).split('@')[0].replace(/[^0-9]/g, '');
                        if (num.length >= 7 && num.length <= 15 && num !== raw) return num;
                    }
                } catch {}
            }
        }
        const groups = await sock.groupFetchAllParticipating();
        for (const gid of Object.keys(groups)) {
            for (const p of (groups[gid].participants || [])) {
                const pid = (p.id || '').split('@')[0].split(':')[0];
                const pLid = (p.lid || '').split('@')[0].split(':')[0];
                if ((pLid === raw || pid === raw) && pid && /^\d{7,15}$/.test(pid) && pid !== raw) return pid;
            }
        }
    } catch {}
    return raw;
}

const dataFilePath = path.join(__dirname, '..', 'data', 'messageCount.json');

function ensureDataDirectory() {
    const dataDir = path.dirname(dataFilePath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function loadMessageCounts() {
    try {
        ensureDataDirectory();
        if (fs.existsSync(dataFilePath)) {
            const data = fs.readFileSync(dataFilePath, 'utf8');
            if (!data.trim()) {
                return {};
            }
            return JSON.parse(data);
        }
        return {};
    } catch (error) {
        console.error('Error loading message counts:', error);
        return {};
    }
}

function saveMessageCounts(messageCounts) {
    try {
        ensureDataDirectory();
        fs.writeFileSync(dataFilePath, JSON.stringify(messageCounts, null, 2));
    } catch (error) {
        console.error('Error saving message counts:', error);
    }
}

function incrementMessageCount(groupId, userId) {
    try {
        const messageCounts = loadMessageCounts();

        if (!messageCounts[groupId]) {
            messageCounts[groupId] = {};
        }

        if (!messageCounts[groupId][userId]) {
            messageCounts[groupId][userId] = 0;
        }

        messageCounts[groupId][userId] += 1;

        saveMessageCounts(messageCounts);
    } catch (error) {
        console.error('Error incrementing message count:', error);
    }
}
async function topMembers(sock, chatId, isGroup, message, count = 5) {
    const fakeContact = createFakeContact(message);
    
    try {
        if (!isGroup) {
            sock.sendMessage(chatId, { text: 'Group context required' }, { quoted: fakeContact });
            return;
        }

        const messageCounts = loadMessageCounts();
        const groupCounts = messageCounts[chatId] || {};

        const sortedMembers = Object.entries(groupCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, count);

        if (sortedMembers.length === 0) {
            sock.sendMessage(chatId, { text: 'No interaction data available' }, { quoted: fakeContact });
            return;
        }

        let textContent = `PARTICIPANT ACTIVITY LEADERS\n\n`;
        const mentions = [];

        for (let index = 0; index < sortedMembers.length; index++) {
            const [userId, messageCount] = sortedMembers[index];
            const rankMarkers = ['A', 'B', 'C', 'D', 'E'];
            const rankMarker = rankMarkers[index] || (index + 1);
            const username = await resolveToPhone(sock, userId);

            textContent += `${rankMarker}. ${username} - ${messageCount} interactions\n`;
            mentions.push(userId);
        }

        const totalMessages = Object.values(groupCounts).reduce((sum, count) => sum + count, 0);
        textContent += `\nTotal group interactions: ${totalMessages}`;

        sock.sendMessage(chatId, { 
            text: textContent, 
            mentions: mentions 
        }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in topMembers command:', error);
        sock.sendMessage(chatId, { text: 'Leaderboard retrieval error' }, { quoted: fakeContact });
    }
}

async function getUserRank(sock, chatId, isGroup, userId, message) {
    const fakeContact = createFakeContact(message);
    
    try {
        if (!isGroup) {
            sock.sendMessage(chatId, { text: 'Group context required' }, { quoted: fakeContact });
            return;
        }

        const messageCounts = loadMessageCounts();
        const groupCounts = messageCounts[chatId] || {};

        if (!groupCounts[userId]) {
            sock.sendMessage(chatId, { text: 'No interaction history for user' }, { quoted: fakeContact });
            return;
        }

        const sortedMembers = Object.entries(groupCounts)
            .sort(([, a], [, b]) => b - a);

        const userRank = sortedMembers.findIndex(([id]) => id === userId) + 1;
        const userMessageCount = groupCounts[userId];
        const totalMembers = sortedMembers.length;

        const textContent = `USER INTERACTION METRICS\n\n` +
                       `Position: ${userRank} of ${totalMembers}\n` +
                       `Interaction count: ${userMessageCount}\n` +
                       `Percentile: ${Math.round((userRank / totalMembers) * 100)}%`;

        sock.sendMessage(chatId, { text: textContent, mentions: [userId] }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in getUserRank command:', error);
        sock.sendMessage(chatId, { text: 'User metric retrieval error' }, { quoted: fakeContact });
    }
}

function resetMessageCounts(groupId) {
    try {
        const messageCounts = loadMessageCounts();
        if (messageCounts[groupId]) {
            delete messageCounts[groupId];
            saveMessageCounts(messageCounts);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error resetting message counts:', error);
        return false;
    }
}

async function getGroupStats(sock, chatId, isGroup, message) {
    const fakeContact = createFakeContact(message);
    
    try {
        if (!isGroup) {
            sock.sendMessage(chatId, { text: 'Group context required' }, { quoted: fakeContact });
            return;
        }

        const messageCounts = loadMessageCounts();
        const groupCounts = messageCounts[chatId] || {};

        const totalMessages = Object.values(groupCounts).reduce((sum, count) => sum + count, 0);
        const activeMembers = Object.keys(groupCounts).length;

        const sortedCounts = Object.values(groupCounts).sort((a, b) => b - a);
        const averageMessages = activeMembers > 0 ? Math.round(totalMessages / activeMembers) : 0;

        let textContent = `GROUP INTERACTION STATISTICS\n\n` +
                     `Active participants: ${activeMembers}\n` +
                     `Total interactions: ${totalMessages}\n` +
                     `Average per participant: ${averageMessages}\n` +
                     `Maximum individual: ${sortedCounts[0] || 0}`;

        sock.sendMessage(chatId, { text: textContent }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in getGroupStats command:', error);
        sock.sendMessage(chatId, { text: 'Statistical data retrieval error' }, { quoted: fakeContact });
    }
}

module.exports = { 
    incrementMessageCount, 
    topMembers, 
    getUserRank, 
    resetMessageCounts,
    getGroupStats,
    createFakeContact 
};
