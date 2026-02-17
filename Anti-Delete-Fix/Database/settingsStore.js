const db = require('./database');

const ownerCache = new Map();
const groupCache = new Map();
const CACHE_TTL = 60000;

function getCacheKey(jid, key) {
    return `${jid}:${key}`;
}

function isOwner(jid) {
    return jid === 'owner' || !jid || jid === 'global';
}

function getOwnerToggle(key, defaultValue = false) {
    const cacheKey = getCacheKey('owner', key);
    const cached = ownerCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.value;
    }
    
    const value = db.getOwnerSetting(key, defaultValue);
    ownerCache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
}

function setOwnerToggle(key, value) {
    db.setOwnerSetting(key, value);
    const cacheKey = getCacheKey('owner', key);
    ownerCache.set(cacheKey, { value, timestamp: Date.now() });
    return true;
}

function getGroupToggle(groupJid, key, defaultValue = false) {
    const cacheKey = getCacheKey(groupJid, key);
    const cached = groupCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.value;
    }
    
    const value = db.getGroupSetting(groupJid, key, defaultValue);
    groupCache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
}

function setGroupToggle(groupJid, key, value) {
    db.setGroupSetting(groupJid, key, value);
    const cacheKey = getCacheKey(groupJid, key);
    groupCache.set(cacheKey, { value, timestamp: Date.now() });
    return true;
}

function deleteGroupToggle(groupJid, key) {
    db.deleteGroupSetting(groupJid, key);
    const cacheKey = getCacheKey(groupJid, key);
    groupCache.delete(cacheKey);
    return true;
}

function invalidateCache(jid, key = null) {
    if (key) {
        const cacheKey = getCacheKey(jid, key);
        if (isOwner(jid)) {
            ownerCache.delete(cacheKey);
        } else {
            groupCache.delete(cacheKey);
        }
    } else {
        if (isOwner(jid)) {
            ownerCache.clear();
        } else {
            for (const k of groupCache.keys()) {
                if (k.startsWith(jid + ':')) {
                    groupCache.delete(k);
                }
            }
        }
    }
}

function clearAllCache() {
    ownerCache.clear();
    groupCache.clear();
}

const OWNER_TOGGLES = {
    antidelete: { default: { gc: { enabled: true, mode: 'private' }, pm: { enabled: true, mode: 'private' } } },
    autoviewstatus: { default: false },
    anticall: { default: { enabled: false, mode: 'block', message: 'Calls not allowed!' } },
    chatbotpm: { default: false },
    autolike: { default: false },
    autobio: { default: { enabled: false, text: '' } },
    autoread: { default: false },
    autotyping: { default: false },
    autorecording: { default: false },
    presence: { default: 'available' },
    pmblocker: { default: { enabled: false, message: 'Direct messages are blocked!\nYou cannot DM this bot. Please contact the owner in group chats only.' } },
    autostatus: { default: { enabled: true, reactOn: false, reactionEmoji: '🖤', randomReactions: true } },
    status_antidelete: { default: { enabled: true, mode: 'private', captureMedia: true, maxStorageMB: 100, cleanupInterval: 30, autoCleanup: true, maxStatuses: 200, notifyOwner: true, cleanRetrieved: true, maxAgeHours: 12 } },
    prefix: { default: '.' },
    botconfig: { default: { botName: 'DAVE-X', menuImage: '', ownerName: 'Dave', welcomeMessage: 'Welcome to the group!', goodbyeMessage: 'Goodbye!', antideletePrivate: true } },
    menuSettings: { default: {} },
    antiedit: { default: { gc: { enabled: true, mode: 'private' }, pm: { enabled: true, mode: 'private' } } },
    autoReaction: { default: { enabled: false, customReactions: ['💞', '💘', '🥰', '💙', '💓', '💕'] } },
    startupWelcome: { default: true }
};

const GROUP_TOGGLES = {
    antidelete: { default: { enabled: true, mode: 'private' } },
    gcpresence: { default: 'available' },

    events: { default: true },
    antidemote: { default: { enabled: false, action: 'warn' } },
    antipromote: { default: { enabled: false, action: 'warn' } },
    antilink: { default: { enabled: false, action: 'delete' } },
    antibadword: { default: { enabled: false, action: 'delete', words: [] } },
    antiedit: { default: { enabled: true, mode: 'private' } },
    welcome: { default: { enabled: false, message: '' } },
    goodbye: { default: { enabled: false, message: '' } },
    chatbot: { default: false },
    antitag: { default: { enabled: false, action: 'delete' } },
    antimention: { default: { enabled: false, maxMentions: 5, action: 'delete' } },
    antisticker: { default: { enabled: false } },
    antiimage: { default: { enabled: false } },
    antivideo: { default: { enabled: false } },
    antiaudio: { default: { enabled: false } },
    antidocument: { default: { enabled: false } },
    antigroupmention: { default: { enabled: false } }
};

function getOwnerConfig(key) {
    const toggleDef = OWNER_TOGGLES[key];
    const defaultVal = toggleDef ? toggleDef.default : false;
    return getOwnerToggle(key, defaultVal);
}

function setOwnerConfig(key, value) {
    return setOwnerToggle(key, value);
}

function getGroupConfig(groupJid, key) {
    const toggleDef = GROUP_TOGGLES[key];
    const defaultVal = toggleDef ? toggleDef.default : false;
    return getGroupToggle(groupJid, key, defaultVal);
}

function setGroupConfig(groupJid, key, value) {
    return setGroupToggle(groupJid, key, value);
}

function matchTypoTolerant(input, targets) {
    const clean = input.toLowerCase().trim();
    
    for (const target of targets) {
        if (clean === target) return target;
    }
    
    for (const target of targets) {
        if (clean.includes(target) || target.includes(clean)) return target;
    }
    
    for (const target of targets) {
        const distance = levenshteinDistance(clean, target);
        if (distance <= 2) return target;
    }
    
    return null;
}

function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function parseToggleCommand(input) {
    const onVariants = ['on', 'enable', 'enabled', 'yes', 'true', '1', 'start', 'activate'];
    const offVariants = ['off', 'disable', 'disabled', 'no', 'false', '0', 'stop', 'deactivate'];
    
    const clean = input.toLowerCase().trim();
    
    if (onVariants.includes(clean)) return 'on';
    if (offVariants.includes(clean)) return 'off';
    
    for (const t of offVariants) {
        if (levenshteinDistance(clean, t) <= 1) return 'off';
    }
    for (const t of onVariants) {
        if (levenshteinDistance(clean, t) <= 1) return 'on';
    }
    
    return null;
}

function parseActionCommand(input) {
    const actions = {
        block: ['block', 'blck', 'blok', 'ban'],
        allow: ['allow', 'alw', 'permit', 'accept'],
        decline: ['decline', 'declin', 'reject', 'deny'],
        delete: ['delete', 'delet', 'del', 'remove', 'rem'],
        kick: ['kick', 'kik', 'remove', 'boot'],
        warn: ['warn', 'warning', 'wrn']
    };
    
    const clean = input.toLowerCase().trim();
    
    for (const [action, variants] of Object.entries(actions)) {
        if (matchTypoTolerant(clean, variants)) return action;
    }
    
    return null;
}

function getAllGroupConfigs() {
    const result = {};
    try {
        const allGroups = db.getAllGroupJids ? db.getAllGroupJids() : [];
        for (const gid of allGroups) {
            const settings = db.getAllGroupSettings(gid);
            if (settings && Object.keys(settings).length > 0) {
                result[gid] = settings;
            }
        }
    } catch {}
    for (const k of groupCache.keys()) {
        const [gid] = k.split(':');
        if (gid && gid.endsWith('@g.us') && !result[gid]) {
            result[gid] = {};
        }
    }
    return result;
}

module.exports = {
    getOwnerToggle,
    setOwnerToggle,
    getGroupToggle,
    setGroupToggle,
    deleteGroupToggle,
    invalidateCache,
    clearAllCache,
    getOwnerConfig,
    setOwnerConfig,
    getGroupConfig,
    setGroupConfig,
    getAllGroupConfigs,
    matchTypoTolerant,
    parseToggleCommand,
    parseActionCommand,
    OWNER_TOGGLES,
    GROUP_TOGGLES
};
