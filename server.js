const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== CONFIGURATION ==========
const ADMIN_PASSWORD = "ADMINN0";
const DB_PATH = './keys_database.sqlite';
let db; // database connection
let adminToken = null;

// ========== DATABASE INITIALIZATION ==========
async function initDatabase() {
    db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Create tables if not exists
    await db.exec(`
        CREATE TABLE IF NOT EXISTS keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            chatId TEXT,
            expiryMs INTEGER NOT NULL,
            createdAt INTEGER NOT NULL,
            active INTEGER DEFAULT 1,
            hours INTEGER DEFAULT 3,
            deviceId TEXT,
            usedAt INTEGER
        );

        CREATE TABLE IF NOT EXISTS users (
            chatId TEXT PRIMARY KEY,
            keysGenerated INTEGER DEFAULT 0,
            banned INTEGER DEFAULT 0,
            cooldownUntil INTEGER DEFAULT 0,
            lastKeyAt INTEGER DEFAULT 0,
            lastSeen INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            details TEXT,
            timestamp INTEGER DEFAULT (strftime('%s', 'now'))
        );

        -- Index untuk performa query expired keys
        CREATE INDEX IF NOT EXISTS idx_keys_expiry ON keys(expiryMs);
        CREATE INDEX IF NOT EXISTS idx_keys_chatId ON keys(chatId);
        CREATE INDEX IF NOT EXISTS idx_users_cooldown ON users(cooldownUntil);
    `);

    // Clean up expired keys on startup
    await deleteExpiredKeys();
    
    // Schedule automatic cleanup every hour
    setInterval(deleteExpiredKeys, 3600000);
    
    console.log('✅ Database initialized at:', DB_PATH);
}

// ========== AUTO DELETE EXPIRED KEYS ==========
async function deleteExpiredKeys() {
    const now = Date.now();
    const result = await db.run(
        'DELETE FROM keys WHERE expiryMs < ? AND active = 1',
        [now]
    );
    if (result.changes > 0) {
        console.log(`🗑️ Deleted ${result.changes} expired keys`);
        await logAdminAction('AUTO_CLEANUP', `Deleted ${result.changes} expired keys`);
    }
    return result.changes;
}

// ========== HELPER FUNCTIONS ==========
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `VIPKEY-${parts[0]}-${parts[1]}-${parts[2]}`;
}

async function getUser(chatId) {
    let user = await db.get('SELECT * FROM users WHERE chatId = ?', [chatId]);
    if (!user) {
        user = { chatId, keysGenerated: 0, banned: 0, cooldownUntil: 0, lastKeyAt: 0, lastSeen: Date.now() };
        await db.run(
            'INSERT INTO users (chatId, keysGenerated, banned, cooldownUntil, lastKeyAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?)',
            [chatId, 0, 0, 0, 0, Date.now()]
        );
    } else {
        // Update last seen
        await db.run('UPDATE users SET lastSeen = ? WHERE chatId = ?', [Date.now(), chatId]);
    }
    return user;
}

async function saveUser(user) {
    await db.run(
        'UPDATE users SET keysGenerated = ?, banned = ?, cooldownUntil = ?, lastKeyAt = ?, lastSeen = ? WHERE chatId = ?',
        [user.keysGenerated, user.banned, user.cooldownUntil, user.lastKeyAt, user.lastSeen, user.chatId]
    );
}

async function generateKeyForUser(chatId, hours = 3) {
    const user = await getUser(chatId);
    
    if (user.banned === 1) {
        return { ok: false, error: 'banned' };
    }
    
    if (user.cooldownUntil && Date.now() < user.cooldownUntil) {
        const remaining = Math.ceil((user.cooldownUntil - Date.now()) / 1000);
        return { ok: false, error: 'cooldown', remaining };
    }
    
    // Check for active key (belum expired)
    const activeKey = await db.get(
        'SELECT * FROM keys WHERE chatId = ? AND active = 1 AND expiryMs > ?',
        [chatId, Date.now()]
    );
    
    if (activeKey) {
        return { ok: false, error: 'active_key_exists', key: activeKey.key };
    }
    
    const expiryMs = Date.now() + (hours * 3600000);
    const newKey = generateKey();
    
    await db.run(
        'INSERT INTO keys (key, chatId, expiryMs, createdAt, active, hours) VALUES (?, ?, ?, ?, ?, ?)',
        [newKey, chatId, expiryMs, Date.now(), 1, hours]
    );
    
    user.keysGenerated++;
    user.lastKeyAt = Date.now();
    user.cooldownUntil = null;
    await saveUser(user);
    
    await logAdminAction('KEY_GENERATED', `User ${chatId} generated key ${newKey}`);
    
    return { ok: true, key: newKey, expiryMs };
}

async function logAdminAction(action, details) {
    await db.run(
        'INSERT INTO admin_logs (action, details) VALUES (?, ?)',
        [action, details]
    );
}

// ========== USER API ==========
app.post('/api/get-key', async (req, res) => {
    const { chatId, userId, hours } = req.body;
    const result = await generateKeyForUser(chatId || userId, hours || 3);
    res.json(result);
});

app.post('/api/verify-key', async (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) return res.json({ ok: false, error: 'Missing key' });
    
    const keyData = await db.get('SELECT * FROM keys WHERE key = ?', [key]);
    
    if (!keyData) return res.json({ ok: false, error: 'key_not_found' });
    if (keyData.active !== 1) return res.json({ ok: false, error: 'key_inactive' });
    if (Date.now() > keyData.expiryMs) {
        await db.run('UPDATE keys SET active = 0 WHERE key = ?', [key]);
        return res.json({ ok: false, error: 'key_expired' });
    }
    
    // Update device info if provided
    if (deviceId && !keyData.deviceId) {
        await db.run('UPDATE keys SET deviceId = ?, usedAt = ? WHERE key = ?', [deviceId, Date.now(), key]);
    }
    
    res.json({ ok: true, expiryMs: keyData.expiryMs, hours: keyData.hours });
});

// ========== ADMIN API ==========
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        adminToken = token;
        logAdminAction('ADMIN_LOGIN', `Admin logged in from ${req.ip}`);
        res.json({ ok: true, token });
    } else {
        res.json({ ok: false });
    }
});

app.post('/api/admin/add-key', async (req, res) => {
    const { token, key, userId, days = 0, hours = 0, minutes = 0, years = 0 } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const durationMs = (years * 365 * 86400000) + (days * 86400000) + (hours * 3600000) + (minutes * 60000);
    const finalDuration = durationMs === 0 ? 3 * 3600000 : durationMs;
    const expiryMs = Date.now() + finalDuration;
    const newKey = key || generateKey();
    
    await db.run(
        'INSERT INTO keys (key, chatId, expiryMs, createdAt, active, hours) VALUES (?, ?, ?, ?, ?, ?)',
        [newKey, userId || null, expiryMs, Date.now(), 1, hours + (days * 24) + (years * 365 * 24)]
    );
    
    if (userId) {
        let user = await getUser(userId);
        user.keysGenerated++;
        user.lastKeyAt = Date.now();
        await saveUser(user);
    }
    
    await logAdminAction('ADD_KEY', `Admin added key ${newKey} for user ${userId || 'public'}`);
    res.json({ ok: true, key: newKey, expiryMs });
});

app.post('/api/admin/delete-all-keys', async (req, res) => {
    const { token } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const result = await db.run('DELETE FROM keys');
    await logAdminAction('DELETE_ALL_KEYS', `Deleted ${result.changes} keys`);
    res.json({ ok: true, deletedCount: result.changes });
});

app.post('/api/admin/delete-expired-keys', async (req, res) => {
    const { token } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const deleted = await deleteExpiredKeys();
    res.json({ ok: true, deletedCount: deleted });
});

app.post('/api/admin/stats', async (req, res) => {
    const { token } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const totalKeys = await db.get('SELECT COUNT(*) as count FROM keys');
    const activeKeys = await db.get('SELECT COUNT(*) as count FROM keys WHERE active = 1 AND expiryMs > ?', [Date.now()]);
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const bannedUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE banned = 1');
    const expiredKeys = await db.get('SELECT COUNT(*) as count FROM keys WHERE expiryMs < ?', [Date.now()]);
    
    res.json({
        ok: true,
        totalKeys: totalKeys.count,
        activeKeys: activeKeys.count,
        expiredKeys: expiredKeys.count,
        totalUsers: totalUsers.count,
        bannedUsers: bannedUsers.count
    });
});

app.post('/api/admin/keys', async (req, res) => {
    const { token, page = 1, limit = 50, showExpired = false } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    let query = 'SELECT * FROM keys';
    const params = [];
    
    if (!showExpired) {
        query += ' WHERE expiryMs > ?';
        params.push(Date.now());
    }
    
    query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);
    
    const keys = await db.all(query, params);
    res.json({ ok: true, keys });
});

app.post('/api/admin/delete-key', async (req, res) => {
    const { token, key } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const result = await db.run('DELETE FROM keys WHERE key = ?', [key]);
    await logAdminAction('DELETE_KEY', `Deleted key ${key}`);
    res.json({ ok: true, deleted: result.changes > 0 });
});

app.post('/api/admin/ban-user', async (req, res) => {
    const { token, chatId } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    await db.run('UPDATE users SET banned = 1 WHERE chatId = ?', [chatId]);
    await logAdminAction('BAN_USER', `Banned user ${chatId}`);
    res.json({ ok: true });
});

app.post('/api/admin/unban-user', async (req, res) => {
    const { token, chatId } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    await db.run('UPDATE users SET banned = 0 WHERE chatId = ?', [chatId]);
    await logAdminAction('UNBAN_USER', `Unbanned user ${chatId}`);
    res.json({ ok: true });
});

app.post('/api/admin/users', async (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const users = await db.all(
        'SELECT * FROM users ORDER BY lastSeen DESC LIMIT ? OFFSET ?',
        [limit, (page - 1) * limit]
    );
    res.json({ ok: true, users });
});

app.post('/api/admin/logs', async (req, res) => {
    const { token, limit = 100 } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const logs = await db.all(
        'SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT ?',
        [limit]
    );
    res.json({ ok: true, logs });
});

app.post('/api/admin/backup', async (req, res) => {
    const { token } = req.body;
    if (token !== adminToken) return res.status(401).json({ ok: false });
    
    const keys = await db.all('SELECT * FROM keys');
    const users = await db.all('SELECT * FROM users');
    
    res.json({
        ok: true,
        backup: {
            timestamp: Date.now(),
            keys,
            users
        }
    });
});

// ========== ROOT - Redirect to Telegram ==========
app.get('/', (req, res) => {
    const TELEGRAM_URL = process.env.TELEGRAM_URL || 'https://t.me/ReyValdz';
    res.redirect(TELEGRAM_URL);
});

// ========== START SERVER ==========
async function startServer() {
    await initDatabase();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📁 Database path: ${DB_PATH}`);
        console.log(`🗑️  Auto cleanup: Every hour (expired keys deleted automatically)`);
    });
}

startServer();

module.exports = app;