const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'persistent_data');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, 'davex.db');

let db = null;
let usePostgres = false;
let pgPool = null;

const pgCache = {
    ownerSettings: {},
    groupSettings: {},
    warnings: {},
    bannedUsers: {},
    sudoUsers: new Set(),
    messages: {},
    loaded: false
};

const PG_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS owner_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    );
    CREATE TABLE IF NOT EXISTS group_settings (
        group_jid TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
        PRIMARY KEY (group_jid, setting_key)
    );
    CREATE TABLE IF NOT EXISTS warnings (
        group_jid TEXT NOT NULL,
        user_jid TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
        PRIMARY KEY (group_jid, user_jid)
    );
    CREATE TABLE IF NOT EXISTS banned_users (
        user_jid TEXT PRIMARY KEY,
        reason TEXT,
        banned_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    );
    CREATE TABLE IF NOT EXISTS sudo_users (
        user_jid TEXT PRIMARY KEY,
        added_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    );
    CREATE TABLE IF NOT EXISTS premium_users (
        user_jid TEXT PRIMARY KEY,
        expires_at INTEGER,
        added_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    );
    CREATE TABLE IF NOT EXISTS message_store (
        message_id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        content TEXT,
        media_type TEXT,
        media_path TEXT,
        is_view_once INTEGER DEFAULT 0,
        push_name TEXT,
        timestamp INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    );
`;

const SQLITE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS owner_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS group_settings (
        group_jid TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (group_jid, setting_key)
    );
    CREATE TABLE IF NOT EXISTS warnings (
        group_jid TEXT NOT NULL,
        user_jid TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (group_jid, user_jid)
    );
    CREATE TABLE IF NOT EXISTS banned_users (
        user_jid TEXT PRIMARY KEY,
        reason TEXT,
        banned_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS sudo_users (
        user_jid TEXT PRIMARY KEY,
        added_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS premium_users (
        user_jid TEXT PRIMARY KEY,
        expires_at INTEGER,
        added_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS message_store (
        message_id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        content TEXT,
        media_type TEXT,
        media_path TEXT,
        is_view_once INTEGER DEFAULT 0,
        push_name TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_group_settings_jid ON group_settings(group_jid);
    CREATE INDEX IF NOT EXISTS idx_message_store_chat ON message_store(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_message_store_timestamp ON message_store(timestamp);
`;

async function loadPgCache() {
    if (!pgPool) return;
    try {
        const ownerRes = await pgPool.query('SELECT setting_key, setting_value FROM owner_settings');
        pgCache.ownerSettings = {};
        for (const row of ownerRes.rows) {
            try { pgCache.ownerSettings[row.setting_key] = JSON.parse(row.setting_value); } catch { pgCache.ownerSettings[row.setting_key] = row.setting_value; }
        }

        const groupRes = await pgPool.query('SELECT group_jid, setting_key, setting_value FROM group_settings');
        pgCache.groupSettings = {};
        for (const row of groupRes.rows) {
            if (!pgCache.groupSettings[row.group_jid]) pgCache.groupSettings[row.group_jid] = {};
            try { pgCache.groupSettings[row.group_jid][row.setting_key] = JSON.parse(row.setting_value); } catch { pgCache.groupSettings[row.group_jid][row.setting_key] = row.setting_value; }
        }

        const warnRes = await pgPool.query('SELECT group_jid, user_jid, count FROM warnings');
        pgCache.warnings = {};
        for (const row of warnRes.rows) {
            const key = row.group_jid + '::' + row.user_jid;
            pgCache.warnings[key] = row.count;
        }

        const banRes = await pgPool.query('SELECT user_jid, reason, banned_at FROM banned_users');
        pgCache.bannedUsers = {};
        for (const row of banRes.rows) {
            pgCache.bannedUsers[row.user_jid] = { reason: row.reason, banned_at: row.banned_at };
        }

        const sudoRes = await pgPool.query('SELECT user_jid FROM sudo_users');
        pgCache.sudoUsers = new Set(sudoRes.rows.map(r => r.user_jid));

        const msgRes = await pgPool.query('SELECT * FROM message_store WHERE timestamp > $1', [Math.floor(Date.now() / 1000) - 604800]);
        pgCache.messages = {};
        for (const row of msgRes.rows) {
            pgCache.messages[row.message_id] = row;
        }

        pgCache.loaded = true;
        console.log('[ DAVE-X ] PostgreSQL cache loaded');
    } catch (e) {
        console.error('[ DAVE-X ] Failed to load PG cache:', e.message);
    }
}

async function initPostgres() {
    const { Pool } = require('pg');
    const dbUrl = process.env.DATABASE_URL;
    
    pgPool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
    });

    const client = await pgPool.connect();
    try {
        await client.query(PG_TABLE_SQL);
        try {
            await client.query(`ALTER TABLE message_store ADD COLUMN IF NOT EXISTS push_name TEXT`);
        } catch {}
        console.log('[ DAVE-X ] PostgreSQL database connected');
    } finally {
        client.release();
    }
    usePostgres = true;
    await loadPgCache();
}

function initSQLite() {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -2000');
    db.exec(SQLITE_TABLE_SQL);
    try {
        db.exec(`ALTER TABLE message_store ADD COLUMN push_name TEXT`);
    } catch {}
    console.log('[ DAVE-X ] SQLite database initialized');
}

let initPromise = null;

function getDb() {
    if (usePostgres) return pgPool;
    if (!db) {
        initSQLite();
    }
    return db;
}

async function initDatabase() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        const dbUrl = process.env.DATABASE_URL;
        if (dbUrl && dbUrl.startsWith('postgres')) {
            try {
                await initPostgres();
                return;
            } catch (e) {
                console.log('[ DAVE-X ] PostgreSQL failed:', e.message);
                console.log('[ DAVE-X ] Switching to SQLite...');
                pgPool = null;
                usePostgres = false;
            }
        }
        initSQLite();
    })();
    return initPromise;
}

initDatabase().catch(e => {
    console.error('[ DAVE-X ] Database init error:', e.message);
    initSQLite();
});

function pgWrite(sql, params = []) {
    pgPool.query(sql, params).catch(e => {
        console.error('[ DAVE-X ] PG write error:', e.message);
    });
}

function setOwnerSetting(key, value) {
    const val = JSON.stringify(value);
    const ts = Math.floor(Date.now() / 1000);
    if (usePostgres) {
        pgCache.ownerSettings[key] = value;
        pgWrite(`INSERT INTO owner_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = $3`, [key, val, ts]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR REPLACE INTO owner_settings (setting_key, setting_value, updated_at) VALUES (?, ?, strftime('%s', 'now'))`);
    stmt.run(key, val);
}

function getOwnerSetting(key, defaultValue = null) {
    if (usePostgres) {
        return key in pgCache.ownerSettings ? pgCache.ownerSettings[key] : defaultValue;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT setting_value FROM owner_settings WHERE setting_key = ?');
    const row = stmt.get(key);
    if (row) {
        try { return JSON.parse(row.setting_value); } catch { return row.setting_value; }
    }
    return defaultValue;
}

function getAllOwnerSettings() {
    if (usePostgres) {
        return { ...pgCache.ownerSettings };
    }
    const database = getDb();
    const stmt = database.prepare('SELECT setting_key, setting_value FROM owner_settings');
    const rows = stmt.all();
    const settings = {};
    for (const row of rows) {
        try { settings[row.setting_key] = JSON.parse(row.setting_value); } catch { settings[row.setting_key] = row.setting_value; }
    }
    return settings;
}

function setGroupSetting(groupJid, key, value) {
    const val = JSON.stringify(value);
    const ts = Math.floor(Date.now() / 1000);
    if (usePostgres) {
        if (!pgCache.groupSettings[groupJid]) pgCache.groupSettings[groupJid] = {};
        pgCache.groupSettings[groupJid][key] = value;
        pgWrite(`INSERT INTO group_settings (group_jid, setting_key, setting_value, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_jid, setting_key) DO UPDATE SET setting_value = $3, updated_at = $4`, [groupJid, key, val, ts]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR REPLACE INTO group_settings (group_jid, setting_key, setting_value, updated_at) VALUES (?, ?, ?, strftime('%s', 'now'))`);
    stmt.run(groupJid, key, val);
}

function hasGroupSetting(groupJid, key) {
    if (usePostgres) {
        const group = pgCache.groupSettings[groupJid];
        return !!(group && key in group);
    }
    const database = getDb();
    const stmt = database.prepare('SELECT 1 FROM group_settings WHERE group_jid = ? AND setting_key = ?');
    return !!stmt.get(groupJid, key);
}

function getGroupSetting(groupJid, key, defaultValue = null) {
    if (usePostgres) {
        const group = pgCache.groupSettings[groupJid];
        return group && key in group ? group[key] : defaultValue;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT setting_value FROM group_settings WHERE group_jid = ? AND setting_key = ?');
    const row = stmt.get(groupJid, key);
    if (row) {
        try { return JSON.parse(row.setting_value); } catch { return row.setting_value; }
    }
    return defaultValue;
}

function getAllGroupSettings(groupJid) {
    if (usePostgres) {
        return pgCache.groupSettings[groupJid] ? { ...pgCache.groupSettings[groupJid] } : {};
    }
    const database = getDb();
    const stmt = database.prepare('SELECT setting_key, setting_value FROM group_settings WHERE group_jid = ?');
    const rows = stmt.all(groupJid);
    const settings = {};
    for (const row of rows) {
        try { settings[row.setting_key] = JSON.parse(row.setting_value); } catch { settings[row.setting_key] = row.setting_value; }
    }
    return settings;
}

function getAllGroupJids() {
    if (usePostgres) {
        return Object.keys(pgCache.groupSettings || {});
    }
    const database = getDb();
    try {
        const rows = database.prepare('SELECT DISTINCT group_jid FROM group_settings').all();
        return rows.map(r => r.group_jid);
    } catch { return []; }
}

function deleteGroupSetting(groupJid, key) {
    if (usePostgres) {
        if (pgCache.groupSettings[groupJid]) delete pgCache.groupSettings[groupJid][key];
        pgWrite('DELETE FROM group_settings WHERE group_jid = $1 AND setting_key = $2', [groupJid, key]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM group_settings WHERE group_jid = ? AND setting_key = ?');
    stmt.run(groupJid, key);
}

function getWarningCount(groupJid, userJid) {
    if (usePostgres) {
        const key = groupJid + '::' + userJid;
        return pgCache.warnings[key] || 0;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT count FROM warnings WHERE group_jid = ? AND user_jid = ?');
    const row = stmt.get(groupJid, userJid);
    return row ? row.count : 0;
}

function incrementWarning(groupJid, userJid) {
    const ts = Math.floor(Date.now() / 1000);
    const cacheKey = groupJid + '::' + userJid;
    if (usePostgres) {
        const current = pgCache.warnings[cacheKey] || 0;
        const newCount = current + 1;
        pgCache.warnings[cacheKey] = newCount;
        pgWrite(`INSERT INTO warnings (group_jid, user_jid, count, updated_at) VALUES ($1, $2, 1, $3) ON CONFLICT (group_jid, user_jid) DO UPDATE SET count = warnings.count + 1, updated_at = $3`, [groupJid, userJid, ts]);
        return newCount;
    }
    const database = getDb();
    const current = getWarningCount(groupJid, userJid);
    const newCount = current + 1;
    const stmt = database.prepare(`INSERT OR REPLACE INTO warnings (group_jid, user_jid, count, updated_at) VALUES (?, ?, ?, strftime('%s', 'now'))`);
    stmt.run(groupJid, userJid, newCount);
    return newCount;
}

function resetWarning(groupJid, userJid) {
    if (usePostgres) {
        delete pgCache.warnings[groupJid + '::' + userJid];
        pgWrite('DELETE FROM warnings WHERE group_jid = $1 AND user_jid = $2', [groupJid, userJid]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM warnings WHERE group_jid = ? AND user_jid = ?');
    stmt.run(groupJid, userJid);
}

function setWarningCount(groupJid, userJid, count) {
    const ts = Math.floor(Date.now() / 1000);
    const cacheKey = groupJid + '::' + userJid;
    if (count <= 0) {
        resetWarning(groupJid, userJid);
        return 0;
    }
    if (usePostgres) {
        pgCache.warnings[cacheKey] = count;
        pgWrite(`INSERT INTO warnings (group_jid, user_jid, count, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_jid, user_jid) DO UPDATE SET count = $3, updated_at = $4`, [groupJid, userJid, count, ts]);
        return count;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR REPLACE INTO warnings (group_jid, user_jid, count, updated_at) VALUES (?, ?, ?, strftime('%s', 'now'))`);
    stmt.run(groupJid, userJid, count);
    return count;
}

function getAllWarnings() {
    const warnings = {};
    if (usePostgres) {
        for (const [key, count] of Object.entries(pgCache.warnings)) {
            const parts = key.split('::');
            if (parts.length === 2) {
                const [groupJid, userJid] = parts;
                if (!warnings[groupJid]) warnings[groupJid] = {};
                warnings[groupJid][userJid] = count;
            }
        }
        return warnings;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT group_jid, user_jid, count FROM warnings');
    const rows = stmt.all();
    for (const row of rows) {
        if (!warnings[row.group_jid]) warnings[row.group_jid] = {};
        warnings[row.group_jid][row.user_jid] = row.count;
    }
    return warnings;
}

function addBannedUser(userJid, reason = '') {
    const ts = Math.floor(Date.now() / 1000);
    if (usePostgres) {
        pgCache.bannedUsers[userJid] = { reason, banned_at: ts };
        pgWrite(`INSERT INTO banned_users (user_jid, reason, banned_at) VALUES ($1, $2, $3) ON CONFLICT (user_jid) DO UPDATE SET reason = $2, banned_at = $3`, [userJid, reason, ts]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR REPLACE INTO banned_users (user_jid, reason, banned_at) VALUES (?, ?, strftime('%s', 'now'))`);
    stmt.run(userJid, reason);
}

function removeBannedUser(userJid) {
    if (usePostgres) {
        delete pgCache.bannedUsers[userJid];
        pgWrite('DELETE FROM banned_users WHERE user_jid = $1', [userJid]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM banned_users WHERE user_jid = ?');
    stmt.run(userJid);
}

function isBanned(userJid) {
    if (usePostgres) {
        return userJid in pgCache.bannedUsers;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT 1 FROM banned_users WHERE user_jid = ?');
    return !!stmt.get(userJid);
}

function getAllBannedUsers() {
    if (usePostgres) {
        return Object.entries(pgCache.bannedUsers).map(([user_jid, data]) => ({ user_jid, reason: data.reason, banned_at: data.banned_at }));
    }
    const database = getDb();
    const stmt = database.prepare('SELECT user_jid, reason, banned_at FROM banned_users');
    return stmt.all();
}

function addSudoUser(userJid) {
    const ts = Math.floor(Date.now() / 1000);
    if (usePostgres) {
        pgCache.sudoUsers.add(userJid);
        pgWrite(`INSERT INTO sudo_users (user_jid, added_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userJid, ts]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR IGNORE INTO sudo_users (user_jid, added_at) VALUES (?, strftime('%s', 'now'))`);
    stmt.run(userJid);
}

function removeSudoUser(userJid) {
    if (usePostgres) {
        pgCache.sudoUsers.delete(userJid);
        pgWrite('DELETE FROM sudo_users WHERE user_jid = $1', [userJid]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM sudo_users WHERE user_jid = ?');
    stmt.run(userJid);
}

function isSudo(userJid) {
    if (usePostgres) {
        return pgCache.sudoUsers.has(userJid);
    }
    const database = getDb();
    const stmt = database.prepare('SELECT 1 FROM sudo_users WHERE user_jid = ?');
    return !!stmt.get(userJid);
}

function getAllSudoUsers() {
    if (usePostgres) {
        return Array.from(pgCache.sudoUsers);
    }
    const database = getDb();
    const stmt = database.prepare('SELECT user_jid FROM sudo_users');
    return stmt.all().map(row => row.user_jid);
}

function storeMessage(messageId, chatJid, senderJid, content, mediaType = null, mediaPath = null, isViewOnce = false, pushName = null) {
    const ts = Math.floor(Date.now() / 1000);
    if (usePostgres) {
        if (!pgCache.messages) pgCache.messages = {};
        pgCache.messages[messageId] = {
            message_id: messageId,
            chat_jid: chatJid,
            sender_jid: senderJid,
            content: content,
            media_type: mediaType,
            media_path: mediaPath,
            is_view_once: isViewOnce ? 1 : 0,
            push_name: pushName,
            timestamp: ts
        };
        pgWrite(`INSERT INTO message_store (message_id, chat_jid, sender_jid, content, media_type, media_path, is_view_once, push_name, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (message_id) DO UPDATE SET content = $4`, [messageId, chatJid, senderJid, content, mediaType, mediaPath, isViewOnce ? 1 : 0, pushName, ts]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare(`INSERT OR REPLACE INTO message_store (message_id, chat_jid, sender_jid, content, media_type, media_path, is_view_once, push_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`);
    stmt.run(messageId, chatJid, senderJid, content, mediaType, mediaPath, isViewOnce ? 1 : 0, pushName);
}

function getMessage(messageId) {
    if (usePostgres) {
        if (!pgCache.messages) pgCache.messages = {};
        return pgCache.messages[messageId] || null;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM message_store WHERE message_id = ?');
    return stmt.get(messageId);
}

function deleteMessage(messageId) {
    if (usePostgres) {
        if (pgCache.messages) delete pgCache.messages[messageId];
        pgWrite('DELETE FROM message_store WHERE message_id = $1', [messageId]);
        return;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM message_store WHERE message_id = ?');
    stmt.run(messageId);
}

function cleanOldMessages(maxAgeSeconds = 86400) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    if (usePostgres) {
        if (pgCache.messages) {
            let cleaned = 0;
            for (const [id, msg] of Object.entries(pgCache.messages)) {
                if (msg.timestamp < cutoff) {
                    delete pgCache.messages[id];
                    cleaned++;
                }
            }
        }
        pgWrite('DELETE FROM message_store WHERE timestamp < $1', [cutoff]);
        return 0;
    }
    const database = getDb();
    const stmt = database.prepare('DELETE FROM message_store WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
}

function getMessageCount() {
    if (usePostgres) {
        return pgCache.messages ? Object.keys(pgCache.messages).length : 0;
    }
    const database = getDb();
    const stmt = database.prepare('SELECT COUNT(*) as count FROM message_store');
    return stmt.get().count;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
    if (pgPool) {
        pgPool.end().catch(() => {});
        pgPool = null;
    }
}

process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(); });
process.on('SIGTERM', () => { closeDb(); process.exit(); });

module.exports = {
    getDb,
    initDatabase,
    setOwnerSetting,
    getOwnerSetting,
    getAllOwnerSettings,
    setGroupSetting,
    getGroupSetting,
    hasGroupSetting,
    getAllGroupSettings,
    getAllGroupJids,
    deleteGroupSetting,
    getWarningCount,
    incrementWarning,
    resetWarning,
    setWarningCount,
    getAllWarnings,
    addBannedUser,
    removeBannedUser,
    isBanned,
    getAllBannedUsers,
    addSudoUser,
    removeSudoUser,
    isSudo,
    getAllSudoUsers,
    storeMessage,
    getMessage,
    deleteMessage,
    cleanOldMessages,
    getMessageCount,
    closeDb
};
