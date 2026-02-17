const fs = require('fs');
const path = require('path');
const db = require('./database');
const { setGroupConfig, setOwnerConfig, clearAllCache } = require('./settingsStore');

const DATA_DIR = path.join(__dirname, '../data');
const MIGRATION_STATUS_FILE = path.join(__dirname, '.migration_status.json');

function getMigrationStatus() {
    try {
        if (fs.existsSync(MIGRATION_STATUS_FILE)) {
            return JSON.parse(fs.readFileSync(MIGRATION_STATUS_FILE, 'utf8'));
        }
    } catch {}
    return {};
}

function saveMigrationStatus(status) {
    try {
        fs.writeFileSync(MIGRATION_STATUS_FILE, JSON.stringify(status, null, 2));
    } catch {}
}

function isFileMigrated(filename) {
    const status = getMigrationStatus();
    return status[filename] === true;
}

function markFileMigrated(filename) {
    const status = getMigrationStatus();
    status[filename] = true;
    saveMigrationStatus(status);
}

function migrateFromJson() {
    console.log('[ DAVE-X ] Checking for pending JSON migrations...');
    let hasPendingMigrations = false;
    let migrated = 0;

    try {
        const userGroupPath = path.join(DATA_DIR, 'userGroupData.json');
        if (fs.existsSync(userGroupPath) && !isFileMigrated('userGroupData.json')) {
            hasPendingMigrations = true;
            const data = JSON.parse(fs.readFileSync(userGroupPath, 'utf8'));
            
            const features = [
                'antibadword', 'antilink', 'antitag', 'antimention', 'antigroupmention',
                'antidemote', 'antisticker', 'antiimage', 'antiaudio', 'antidocument',
                'antifiles', 'antipromote', 'antivideo', 'antibug', 'antichart',
                'welcome', 'goodbye', 'chatbot'
            ];
            
            for (const feature of features) {
                if (data[feature]) {
                    for (const [groupId, config] of Object.entries(data[feature])) {
                        setGroupConfig(groupId, feature, config);
                        migrated++;
                    }
                }
            }
            
            if (data.warnings) {
                for (const [groupId, users] of Object.entries(data.warnings)) {
                    for (const [userId, count] of Object.entries(users)) {
                        const database = db.getDb();
                        const stmt = database.prepare(`
                            INSERT OR REPLACE INTO warnings (group_jid, user_jid, count, updated_at)
                            VALUES (?, ?, ?, strftime('%s', 'now'))
                        `);
                        stmt.run(groupId, userId, count);
                        migrated++;
                    }
                }
            }
            
            if (Array.isArray(data.sudo)) {
                for (const userId of data.sudo) {
                    db.addSudoUser(userId);
                    migrated++;
                }
            }
            
            markFileMigrated('userGroupData.json');
            console.log(`[ DAVE-X ] Migrated ${migrated} settings from userGroupData.json`);
        }

        const antideleteConfig = path.join(DATA_DIR, 'antidelete.json');
        if (fs.existsSync(antideleteConfig) && !isFileMigrated('antidelete.json')) {
            hasPendingMigrations = true;
            try {
                const config = JSON.parse(fs.readFileSync(antideleteConfig, 'utf8'));
                setOwnerConfig('antidelete', config);
                markFileMigrated('antidelete.json');
                console.log('[ DAVE-X ] Migrated antidelete config');
            } catch {}
        }

        const anticallConfig = path.join(DATA_DIR, 'anticall.json');
        if (fs.existsSync(anticallConfig) && !isFileMigrated('anticall.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(anticallConfig, 'utf8'));
                setOwnerConfig('anticall', { enabled: config.enabled || false, mode: 'block', message: 'Calls not allowed!' });
                markFileMigrated('anticall.json');
                console.log('[ DAVE-X ] Migrated anticall config');
            } catch {}
        }

        const antieditConfig = path.join(DATA_DIR, 'antiedit.json');
        if (fs.existsSync(antieditConfig) && !isFileMigrated('antiedit.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(antieditConfig, 'utf8'));
                setOwnerConfig('antiedit', config);
                markFileMigrated('antiedit.json');
                console.log('[ DAVE-X ] Migrated antiedit config');
            } catch {}
        }

        const autoreadConfig = path.join(DATA_DIR, 'autoread.json');
        if (fs.existsSync(autoreadConfig) && !isFileMigrated('autoread.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(autoreadConfig, 'utf8'));
                setOwnerConfig('autoread', config.enabled || false);
                markFileMigrated('autoread.json');
                console.log('[ DAVE-X ] Migrated autoread config');
            } catch {}
        }

        const autotypingConfig = path.join(DATA_DIR, 'autotyping.json');
        if (fs.existsSync(autotypingConfig) && !isFileMigrated('autotyping.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(autotypingConfig, 'utf8'));
                setOwnerConfig('autotyping', config.enabled || false);
                markFileMigrated('autotyping.json');
                console.log('[ DAVE-X ] Migrated autotyping config');
            } catch {}
        }

        const autorecordingConfig = path.join(DATA_DIR, 'autorecording.json');
        if (fs.existsSync(autorecordingConfig) && !isFileMigrated('autorecording.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(autorecordingConfig, 'utf8'));
                setOwnerConfig('autorecording', config.enabled || false);
                markFileMigrated('autorecording.json');
                console.log('[ DAVE-X ] Migrated autorecording config');
            } catch {}
        }

        const ownerConfig = path.join(DATA_DIR, 'owner.json');
        if (fs.existsSync(ownerConfig) && !isFileMigrated('owner.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(ownerConfig, 'utf8'));
                if (Array.isArray(config)) {
                    for (const owner of config) {
                        if (typeof owner === 'string') {
                            db.addSudoUser(owner.includes('@') ? owner : owner + '@s.whatsapp.net');
                        }
                    }
                }
                markFileMigrated('owner.json');
                console.log('[ DAVE-X ] Migrated owner config');
            } catch {}
        }

        const bannedConfig = path.join(DATA_DIR, 'banned.json');
        if (fs.existsSync(bannedConfig) && !isFileMigrated('banned.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(bannedConfig, 'utf8'));
                if (Array.isArray(config)) {
                    for (const user of config) {
                        if (typeof user === 'string') {
                            db.addBannedUser(user);
                        }
                    }
                } else if (typeof config === 'object') {
                    for (const [userId, reason] of Object.entries(config)) {
                        db.addBannedUser(userId, reason || '');
                    }
                }
                markFileMigrated('banned.json');
                console.log('[ DAVE-X ] Migrated banned users');
            } catch {}
        }

        const premiumConfig = path.join(DATA_DIR, 'premium.json');
        if (fs.existsSync(premiumConfig) && !isFileMigrated('premium.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(premiumConfig, 'utf8'));
                if (Array.isArray(config)) {
                    for (const user of config) {
                        if (typeof user === 'string') {
                            const database = db.getDb();
                            const stmt = database.prepare(`
                                INSERT OR IGNORE INTO premium_users (user_jid, added_at)
                                VALUES (?, strftime('%s', 'now'))
                            `);
                            stmt.run(user);
                        }
                    }
                }
                markFileMigrated('premium.json');
                console.log('[ DAVE-X ] Migrated premium users');
            } catch {}
        }

        const warningsConfig = path.join(DATA_DIR, 'warnings.json');
        if (fs.existsSync(warningsConfig) && !isFileMigrated('warnings.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(warningsConfig, 'utf8'));
                if (typeof config === 'object' && config !== null) {
                    for (const [groupId, users] of Object.entries(config)) {
                        if (typeof users === 'object' && users !== null) {
                            for (const [userId, count] of Object.entries(users)) {
                                const database = db.getDb();
                                const stmt = database.prepare(`
                                    INSERT OR REPLACE INTO warnings (group_jid, user_jid, count, updated_at)
                                    VALUES (?, ?, ?, strftime('%s', 'now'))
                                `);
                                stmt.run(groupId, userId, typeof count === 'number' ? count : 0);
                            }
                        }
                    }
                }
                markFileMigrated('warnings.json');
                console.log('[ DAVE-X ] Migrated warnings');
            } catch {}
        }

        const pmblockerConfig = path.join(DATA_DIR, 'pmblocker.json');
        if (fs.existsSync(pmblockerConfig) && !isFileMigrated('pmblocker.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(pmblockerConfig, 'utf8'));
                setOwnerConfig('pmblocker', { enabled: config.enabled || false, message: config.message || '' });
                markFileMigrated('pmblocker.json');
                console.log('[ DAVE-X ] Migrated pmblocker config');
            } catch {}
        }

        const autoStatusConfig = path.join(DATA_DIR, 'autoStatus.json');
        if (fs.existsSync(autoStatusConfig) && !isFileMigrated('autoStatus.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(autoStatusConfig, 'utf8'));
                setOwnerConfig('autostatus', config);
                setOwnerConfig('autoviewstatus', config.enabled || config.autoView || false);
                markFileMigrated('autoStatus.json');
                console.log('[ DAVE-X ] Migrated autoStatus config');
            } catch {}
        }

        const prefixConfig = path.join(DATA_DIR, 'prefix.json');
        if (fs.existsSync(prefixConfig) && !isFileMigrated('prefix.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(prefixConfig, 'utf8'));
                setOwnerConfig('prefix', config.prefix || '.');
                markFileMigrated('prefix.json');
                console.log('[ DAVE-X ] Migrated prefix config');
            } catch {}
        }

        const botconfigPath = path.join(DATA_DIR, 'botconfig.json');
        if (fs.existsSync(botconfigPath) && !isFileMigrated('botconfig.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(botconfigPath, 'utf8'));
                setOwnerConfig('botconfig', config);
                markFileMigrated('botconfig.json');
                console.log('[ DAVE-X ] Migrated botconfig');
            } catch {}
        }

        const menuSettingsPath = path.join(DATA_DIR, 'menuSettings.json');
        if (fs.existsSync(menuSettingsPath) && !isFileMigrated('menuSettings.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(menuSettingsPath, 'utf8'));
                setOwnerConfig('menuSettings', config);
                markFileMigrated('menuSettings.json');
                console.log('[ DAVE-X ] Migrated menuSettings');
            } catch {}
        }

        const statusAntideleteConfig = path.join(DATA_DIR, 'status_antidelete.json');
        if (fs.existsSync(statusAntideleteConfig) && !isFileMigrated('status_antidelete.json')) {
            try {
                const config = JSON.parse(fs.readFileSync(statusAntideleteConfig, 'utf8'));
                setOwnerConfig('status_antidelete', config);
                markFileMigrated('status_antidelete.json');
                console.log('[ DAVE-X ] Migrated status_antidelete config');
            } catch {}
        }

        if (hasPendingMigrations) {
            clearAllCache();
            console.log('[ DAVE-X ] Migration completed successfully!');
        } else {
            console.log('[ DAVE-X ] No pending migrations.');
        }
        
    } catch (error) {
        console.error('[ DAVE-X ] Migration error:', error.message);
        console.error('[ DAVE-X ] Migration incomplete - will retry on next startup');
    }
}

function cleanupLegacyFiles() {
    const filesToKeep = ['botConfig.js', 'fakeContact.js', 'greetings.js', 'messageHandler.js'];
    
    try {
        if (!fs.existsSync(DATA_DIR)) return;
        
        const files = fs.readdirSync(DATA_DIR);
        let cleaned = 0;
        
        for (const file of files) {
            if (file.endsWith('.json') && !filesToKeep.includes(file)) {
                console.log(`[ DAVE-X ] Note: Legacy file ${file} can be removed after verifying migration`);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`[ DAVE-X ] ${cleaned} legacy JSON files identified for cleanup`);
        }
    } catch {}
}

module.exports = {
    migrateFromJson,
    cleanupLegacyFiles
};
