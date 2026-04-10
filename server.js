const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== CONFIGURATION ==========
const ADMIN_PASSWORD = "AsDMINREYVALDZ;

let db = {
    keys: [],
    users: [],
    adminToken: null
};

// ========== HELPER FUNCTIONS ==========
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `VIPKEY-${parts[0]}-${parts[1]}-${parts[2]}`;
}

function getUser(chatId) {
    let user = db.users.find(u => u.chatId === chatId);
    if (!user) {
        user = { chatId, keysGenerated: 0, banned: false, cooldownUntil: null };
        db.users.push(user);
    }
    return user;
}

function saveUser(user) {
    const index = db.users.findIndex(u => u.chatId === user.chatId);
    if (index !== -1) db.users[index] = user;
}

function generateKeyForUser(chatId, hours = 3) {
    const user = getUser(chatId);
    
    if (user.banned) {
        return { ok: false, error: 'banned' };
    }
    
    if (user.cooldownUntil && Date.now() < user.cooldownUntil) {
        const remaining = Math.ceil((user.cooldownUntil - Date.now()) / 1000);
        return { ok: false, error: 'cooldown', remaining };
    }
    
    const activeKey = db.keys.find(k => k.chatId === chatId && k.active && k.expiryMs > Date.now());
    if (activeKey) {
        return { ok: false, error: 'active_key_exists', key: activeKey.key };
    }
    
    const expiryMs = Date.now() + (hours * 3600000);
    const newKey = generateKey();
    
    db.keys.push({
        key: newKey,
        chatId,
        expiryMs,
        createdAt: Date.now(),
        active: true,
        hours
    });
    
    user.keysGenerated++;
    user.lastKeyAt = Date.now();
    user.cooldownUntil = null;
    saveUser(user);
    
    return { ok: true, key: newKey, expiryMs };
}

// ========== USER API ==========
app.post('/api/get-key', (req, res) => {
    const { chatId, userId, hours } = req.body;
    const result = generateKeyForUser(chatId || userId, hours || 3);
    res.json(result);
});

app.post('/api/verify-key', (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) return res.json({ ok: false, error: 'Missing key' });
    
    const keyData = db.keys.find(k => k.key === key);
    
    if (!keyData) return res.json({ ok: false, error: 'key_not_found' });
    if (!keyData.active) return res.json({ ok: false, error: 'key_inactive' });
    if (Date.now() > keyData.expiryMs) {
        keyData.active = false;
        return res.json({ ok: false, error: 'key_expired' });
    }
    
    res.json({ ok: true, expiryMs: keyData.expiryMs, hours: keyData.hours });
});

// ========== ADMIN API ==========
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        db.adminToken = token;
        res.json({ ok: true, token });
    } else {
        res.json({ ok: false });
    }
});

app.post('/api/admin/add-key', (req, res) => {
    const { token, key, userId, days = 0, hours = 0, minutes = 0, years = 0 } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const durationMs = 
        (years * 365 * 86400000) + 
        (days * 86400000) + 
        (hours * 3600000) + 
        (minutes * 60000);

    const finalDuration = durationMs === 0 ? 3 * 3600000 : durationMs;
    const expiryMs = Date.now() + finalDuration;
    const newKey = key || generateKey();
    
    const durationParts = [];
    if (years > 0) durationParts.push(`${years} year${years > 1 ? 's' : ''}`);
    if (days > 0) durationParts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) durationParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) durationParts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    const durationLabel = durationParts.length ? durationParts.join(', ') : '3 hours';
    
    db.keys.push({
        key: newKey,
        chatId: userId || null,
        expiryMs,
        createdAt: Date.now(),
        active: true,
        hours: hours + (days * 24) + (years * 365 * 24),
        durationLabel
    });
    
    if (userId) {
        let user = db.users.find(u => u.chatId === userId);
        if (!user) {
            user = { chatId: userId, keysGenerated: 0, banned: false, cooldownUntil: null };
            db.users.push(user);
        }
        user.keysGenerated++;
        user.lastKeyAt = Date.now();
    }
    
    res.json({ ok: true, key: newKey, expiryMs, durationLabel });
});

app.post('/api/admin/delete-all-keys', (req, res) => {
    const { token } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    db.keys = [];
    res.json({ ok: true });
});

app.post('/api/admin/stats', (req, res) => {
    const { token } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const activeKeys = db.keys.filter(k => k.active && k.expiryMs > Date.now()).length;
    
    res.json({
        ok: true,
        totalKeys: db.keys.length,
        activeKeys,
        totalUsers: db.users.length,
        bannedUsers: db.users.filter(u => u.banned).length
    });
});

app.post('/api/admin/keys', (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const keys = [...db.keys].reverse().slice((page - 1) * limit, page * limit);
    res.json({ ok: true, keys });
});

app.post('/api/admin/delete-key', (req, res) => {
    const { token, key } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    db.keys = db.keys.filter(k => k.key !== key);
    res.json({ ok: true });
});

app.post('/api/admin/ban-user', (req, res) => {
    const { token, chatId } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const user = db.users.find(u => u.chatId === chatId);
    if (user) user.banned = true;
    res.json({ ok: true });
});

app.post('/api/admin/unban-user', (req, res) => {
    const { token, chatId } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const user = db.users.find(u => u.chatId === chatId);
    if (user) user.banned = false;
    res.json({ ok: true });
});

app.post('/api/admin/users', (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const users = [...db.users].reverse().slice((page - 1) * limit, page * limit);
    res.json({ ok: true, users });
});

// ========== ROOT ==========
app.get('/', (req, res) => {
    const TELEGRAM_URL = 'https://t.me/ReyValdz'; 
     // Redirect
    res.redirect(TELEGRAM_URL);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`⚠️ MEMORY MODE: Data will be lost on restart!`);
});

module.exports = app;