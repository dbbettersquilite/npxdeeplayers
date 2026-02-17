const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

const { createFakeContact, getBotName } = require('../lib/fakeContact');
function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || stdout || err.message));
            resolve(stdout.toString().trim());
        });
    });
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'tmp', 'temp', 'attached_assets'
]);

const PROTECTED_FILES = new Set([
    '.env', 'baileys_store.json', '.migration_status.json',
    'package-lock.json', 'creds.json', 'settings.js',
    'replit.md', '.replit', 'replit.nix'
]);

const PROTECTED_DIR_PREFIXES = [
    'session/',
    'persistent_data/',
    'data/',
    'auth_info/',
    'auth_info_baileys/',
    '.local/'
];

function isProtected(relativePath) {
    if (PROTECTED_FILES.has(relativePath)) return true;
    for (const prefix of PROTECTED_DIR_PREFIXES) {
        if (relativePath.startsWith(prefix)) return true;
    }
    return false;
}

function shouldSkipDir(dirName) {
    return SKIP_DIRS.has(dirName);
}

function fileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    } catch {
        return null;
    }
}

async function hasGitRepo() {
    const gitDir = path.join(process.cwd(), '.git');
    if (!fs.existsSync(gitDir)) return false;
    try {
        await run('git --version');
        return true;
    } catch {
        return false;
    }
}

function backupProtectedFiles() {
    const backups = {};
    const filesToBackup = [...PROTECTED_FILES];
    for (const dir of PROTECTED_DIR_PREFIXES) {
        const dirPath = path.join(process.cwd(), dir.replace(/\/$/, ''));
        if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory()) {
            filesToBackup.push(dir);
        }
    }
    for (const file of PROTECTED_FILES) {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
            try {
                backups[file] = fs.readFileSync(filePath);
            } catch {}
        }
    }
    return backups;
}

function restoreProtectedFiles(backups) {
    for (const [file, content] of Object.entries(backups)) {
        const filePath = path.join(process.cwd(), file);
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        } catch {}
    }
}

async function updateViaGit() {
    const oldRev = await run('git rev-parse HEAD').catch(() => 'unknown');
    await run('git fetch --all --prune 2>/dev/null');
    const newRev = await run('git rev-parse origin/main').catch(() => 'unknown');

    const alreadyUpToDate = oldRev === newRev;
    const commits = alreadyUpToDate ? '' : await run(`git log --pretty=format:"%h %s" ${oldRev}..${newRev}`).catch(() => '');

    const backups = backupProtectedFiles();

    await run(`git reset --hard ${newRev}`);
    await run('git clean -fd -e session/ -e data/ -e persistent_data/ -e auth_info/ -e auth_info_baileys/ -e creds.json -e settings.js -e .env');

    restoreProtectedFiles(backups);

    return { oldRev, newRev, alreadyUpToDate, commits };
}

function downloadFile(url, dest, visited = new Set()) {
    return new Promise((resolve, reject) => {
        if (visited.has(url) || visited.size > 5) return reject(new Error('Too many redirects'));
        visited.add(url);

        const client = url.startsWith('https://') ? https : require('http');
        const req = client.get(url, { headers: { 'User-Agent': 'DAVE-X-Updater/3.0' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                const nextUrl = new URL(res.headers.location, url).toString();
                res.resume();
                return downloadFile(nextUrl, dest, visited).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', err => {
                fs.unlink(dest, () => reject(err));
            });
        });
        req.on('error', err => fs.unlink(dest, () => reject(err)));
    });
}

async function extractZip(zipPath, outDir) {
    if (process.platform === 'win32') {
        await run(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force"`);
        return;
    }
    for (const tool of ['unzip', '7z', 'busybox unzip']) {
        try {
            await run(`command -v ${tool.split(' ')[0]}`);
            await run(`${tool} -o '${zipPath}' -d '${outDir}'`);
            return;
        } catch {}
    }
    throw new Error("No unzip tool found");
}

function smartCopyRecursive(src, dest, ignoreTopLevel = [], relative = '', stats = { updated: [], skipped: [], added: [] }) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        if (ignoreTopLevel.includes(entry) && relative === '') continue;
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        const rel = relative ? `${relative}/${entry}` : entry;
        const stat = fs.lstatSync(s);

        if (stat.isDirectory()) {
            if (shouldSkipDir(entry)) {
                continue;
            }
            smartCopyRecursive(s, d, ignoreTopLevel, rel, stats);
        } else {
            if (isProtected(rel)) {
                stats.skipped.push(rel);
                continue;
            }

            if (fs.existsSync(d)) {
                const srcHash = fileHash(s);
                const destHash = fileHash(d);
                if (srcHash && destHash && srcHash === destHash) {
                    stats.skipped.push(rel);
                    continue;
                }
                stats.updated.push(rel);
            } else {
                stats.added.push(rel);
            }

            fs.mkdirSync(path.dirname(d), { recursive: true });
            fs.copyFileSync(s, d);
        }
    }
    return stats;
}

async function updateViaZip(zipUrl) {
    if (!zipUrl) throw new Error('No ZIP URL configured.');

    const tmpDir = path.join(process.cwd(), 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, 'update.zip');
    await downloadFile(zipUrl, zipPath);

    const extractTo = path.join(tmpDir, 'update_extract');
    fs.rmSync(extractTo, { recursive: true, force: true });
    await extractZip(zipPath, extractTo);

    const entries = fs.readdirSync(extractTo);
    const root = entries.length === 1 && fs.lstatSync(path.join(extractTo, entries[0])).isDirectory()
        ? path.join(extractTo, entries[0])
        : extractTo;

    const ignoreTopLevel = ['node_modules', '.git', 'tmp', 'temp'];
    const stats = smartCopyRecursive(root, process.cwd(), ignoreTopLevel, '', { updated: [], skipped: [], added: [] });

    fs.rmSync(extractTo, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });

    return stats;
}

async function restartProcess(sock, chatId, message) {
    const fakeContact = createFakeContact(message);
    await sock.sendMessage(chatId, { text: 'Update finished restarting' }, { quoted: fakeContact }).catch(() => {});
    try {
        await run('pm2 restart all');
    } catch {
        setTimeout(() => process.exit(0), 500);
    }
}

async function updateCommand(sock, chatId, message, zipOverride) {
    const fakeContact = createFakeContact(message);
    const botName = getBotName();
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, { text: `*${botName}*\nOwner only command!` }, { quoted: fakeContact });
    }

    let statusMessage;
    try {
        statusMessage = await sock.sendMessage(chatId, { text: `*${botName} UPDATE*\n\nInitializing update...\nYour settings and data will be preserved` }, { quoted: fakeContact });

        if (await hasGitRepo()) {
            await sock.sendMessage(chatId, { text: `*${botName} UPDATE*\n\nSyncing repository...`, edit: statusMessage.key });
            const { oldRev, newRev, alreadyUpToDate } = await updateViaGit();
            const summary = alreadyUpToDate ? 'Already up to date!' : `Updated: ${oldRev.slice(0, 7)} -> ${newRev.slice(0, 7)}`;
            await sock.sendMessage(chatId, { text: `*${botName} UPDATE*\n\n${summary}\nInstalling dependencies...`, edit: statusMessage.key });
        } else {
            await sock.sendMessage(chatId, { text: `*${botName} UPDATE*\n\nDownloading update archive...`, edit: statusMessage.key });
            const stats = await updateViaZip(zipOverride || settings.updateZipUrl || process.env.UPDATE_ZIP_URL);

            let summary = `*${botName} UPDATE*\n\n`;
            summary += `Updated: ${stats.updated.length} files\n`;
            summary += `Added: ${stats.added.length} new files\n`;
            summary += `Skipped: ${stats.skipped.length} files\n`;
            summary += `Settings & data: preserved\n`;
            summary += `Installing dependencies...`;

            await sock.sendMessage(chatId, { text: summary, edit: statusMessage.key });
        }

        await run('npm install --no-audit --no-fund 2>/dev/null');
        await sock.sendMessage(chatId, { text: `*${botName} UPDATE*\n\nUpdate complete! Settings preserved.\nRestarting...`, edit: statusMessage.key });
        await restartProcess(sock, chatId, message);
    } catch (err) {
        console.error('Update failed:', err);
        const safeErr = String(err.message || err).replace(/https?:\/\/[^\s]+/g, '[hidden]').slice(0, 500);
        const errorMsg = `*${botName} UPDATE*\n\nUpdate failed: ${safeErr}`;
        if (statusMessage?.key) {
            await sock.sendMessage(chatId, { text: errorMsg, edit: statusMessage.key });
        } else {
            await sock.sendMessage(chatId, { text: errorMsg }, { quoted: fakeContact });
        }
    }
}

module.exports = updateCommand;
