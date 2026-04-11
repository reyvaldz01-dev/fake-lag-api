const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== KONFIGURASI ==========
const ADMIN_PASSWORD = "ADMINN0";
const TELEGRAM_URL = 'https://t.me/ReyValdz';

// Supabase configuration
const SUPABASE_URL = "https://iqweywcngktyvfiyebar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2V5d2NuZ2t0eXZmaXllYmFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQxMzQsImV4cCI6MjA5MTQ2MDEzNH0.hn36HsEcfzRlM9LE25ebcWPBXpJVzQEfpA7ElVzp05s";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2V5d2NuZ2t0eXZmaXllYmFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4NDEzNCwiZXhwIjoyMDkxNDYwMTM0fQ.q5eVJ-TDw1X14Pv_RJ0msB0_rbAyO1aUY4Oh7eer9UM";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase environment variables!');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let adminToken = null;
let adminLastActivity = null;

// ========== DATABASE INIT (Supabase) ==========
async function initDatabase() {
    // Create tables using raw SQL
    const createKeysTable = `
        CREATE TABLE IF NOT EXISTS keys (
            id SERIAL PRIMARY KEY,
            key_text TEXT UNIQUE NOT NULL,
            chat_id TEXT,
            expiry_ms BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            active INTEGER DEFAULT 1,
            hours INTEGER DEFAULT 3,
            used_devices TEXT DEFAULT '[]',
            last_used_at BIGINT
        );
    `;
    
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            chat_id TEXT PRIMARY KEY,
            keys_generated INTEGER DEFAULT 0,
            banned INTEGER DEFAULT 0,
            cooldown_until BIGINT DEFAULT 0,
            last_key_at BIGINT DEFAULT 0,
            last_active_at BIGINT DEFAULT 0,
            created_at BIGINT DEFAULT 0
        );
    `;
    
    const createLogsTable = `
        CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            action TEXT,
            details TEXT,
            ip TEXT,
            timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        );
    `;
    
    const createIndexes = `
        CREATE INDEX IF NOT EXISTS idx_keys_expiry ON keys(expiry_ms);
        CREATE INDEX IF NOT EXISTS idx_keys_chat_id ON keys(chat_id);
        CREATE INDEX IF NOT EXISTS idx_users_cooldown ON users(cooldown_until);
    `;
    
    try {
        await supabase.rpc('exec_sql', { query: createKeysTable });
        await supabase.rpc('exec_sql', { query: createUsersTable });
        await supabase.rpc('exec_sql', { query: createLogsTable });
        await supabase.rpc('exec_sql', { query: createIndexes });
        console.log('✅ Supabase tables ready');
    } catch (error) {
        console.log('⚠️ Using Supabase via REST API (tables should be created manually)');
    }
    
    // Cleanup expired keys on startup
    await deleteExpiredKeys();
    
    // Schedule auto cleanup every hour (via setInterval, but Vercel may not keep it running)
    if (process.env.NODE_ENV !== 'production') {
        setInterval(deleteExpiredKeys, 60 * 1000);
    }
}

// ========== AUTO DELETE EXPIRED KEYS ==========
async function deleteExpiredKeys() {
    const now = Date.now();
    const { data, error } = await supabase
        .from('keys')
        .delete()
        .lt('expiry_ms', now)
        .eq('active', 1);
    
    if (error) {
        console.error('Delete expired keys error:', error);
        return 0;
    }
    return data?.length || 0;
}

// ========== LOGGING ==========
async function logAdminAction(action, details, ip = null) {
    try {
        await supabase
            .from('admin_logs')
            .insert([{ action, details, ip, timestamp: Date.now() }]);
    } catch (e) {
        console.error('Logging error:', e.message);
    }
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
    let { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('chat_id', chatId)
        .single();
    
    if (error || !user) {
        const now = Date.now();
        const newUser = {
            chat_id: chatId,
            keys_generated: 0,
            banned: 0,
            cooldown_until: 0,
            last_key_at: 0,
            last_active_at: now,
            created_at: now
        };
        
        const { data: inserted, error: insertError } = await supabase
            .from('users')
            .insert([newUser])
            .select()
            .single();
        
        if (insertError) {
            console.error('Insert user error:', insertError);
            return newUser;
        }
        
        console.log(`👤 New user registered: ${chatId}`);
        return inserted;
    }
    
    // Update last active
    await supabase
        .from('users')
        .update({ last_active_at: Date.now() })
        .eq('chat_id', chatId);
    
    return user;
}

function formatRemainingTime(expiryMs) {
    const remaining = Math.max(0, expiryMs - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

async function generateKeyForUser(chatId, hours = 3) {
    const user = await getUser(chatId);
    
    // Cek banned
    if (user.banned === 1) {
        return { ok: false, error: 'banned', message: 'You are banned from generating keys' };
    }
    
    // Cek cooldown
    if (user.cooldown_until && Date.now() < user.cooldown_until) {
        const remaining = Math.ceil((user.cooldown_until - Date.now()) / 1000);
        const remainingMinutes = Math.ceil(remaining / 60);
        return { 
            ok: false, 
            error: 'cooldown', 
            remaining,
            message: `Please wait ${remainingMinutes} minute(s) before generating another key`
        };
    }
    
    // Cek apakah sudah punya key aktif
    const { data: activeKey, error: activeError } = await supabase
        .from('keys')
        .select('*')
        .eq('chat_id', chatId)
        .eq('active', 1)
        .gt('expiry_ms', Date.now())
        .maybeSingle();
    
    if (activeKey) {
        const remaining = formatRemainingTime(activeKey.expiry_ms);
        return { 
            ok: false, 
            error: 'active_key_exists', 
            key: activeKey.key_text,
            message: `You already have an active key: ${activeKey.key_text} (expires in ${remaining})`
        };
    }
    
    // Generate key baru
    const expiryMs = Date.now() + (hours * 3600000);
    const newKey = generateKey();
    
    const { error: insertError } = await supabase
        .from('keys')
        .insert([{
            key_text: newKey,
            chat_id: chatId,
            expiry_ms: expiryMs,
            created_at: Date.now(),
            active: 1,
            hours: hours
        }]);
    
    if (insertError) {
        console.error('Insert key error:', insertError);
        return { ok: false, error: 'database_error', message: 'Failed to generate key' };
    }
    
    await supabase
        .from('users')
        .update({ 
            keys_generated: user.keys_generated + 1,
            last_key_at: Date.now(),
            cooldown_until: Date.now() + 60000
        })
        .eq('chat_id', chatId);
    
    await logAdminAction('KEY_GENERATED', `User ${chatId} generated key ${newKey}`, null);
    console.log(`🔑 Key generated: ${newKey} for user ${chatId} (expires in ${hours} hours)`);
    
    return { 
        ok: true, 
        key: newKey, 
        expiryMs,
        expiresIn: `${hours} hours`,
        message: `Key generated successfully! Valid for ${hours} hours.`
    };
}

// ========== USER API ==========
app.post('/api/get-key', async (req, res) => {
    const { chatId, userId, hours } = req.body;
    const identifier = chatId || userId;
    
    if (!identifier) {
        return res.status(400).json({ ok: false, error: 'missing_id', message: 'chatId or userId is required' });
    }
    
    const result = await generateKeyForUser(identifier, hours || 3);
    res.json(result);
});

app.post('/api/verify-key', async (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 'missing_key', message: 'Key is required' });
    }
    
    const { data: keyData, error } = await supabase
        .from('keys')
        .select('*')
        .eq('key_text', key)
        .single();
    
    if (error || !keyData) {
        return res.json({ ok: false, error: 'key_not_found', message: 'Key not found' });
    }
    
    if (keyData.active !== 1) {
        return res.json({ ok: false, error: 'key_inactive', message: 'Key has been deactivated' });
    }
    
    if (Date.now() > keyData.expiry_ms) {
        await supabase.from('keys').update({ active: 0 }).eq('key_text', key);
        return res.json({ ok: false, error: 'key_expired', message: 'Key has expired' });
    }
    
    // Track device usage
    if (deviceId) {
        let usedDevices = [];
        try {
            usedDevices = JSON.parse(keyData.used_devices || '[]');
        } catch(e) {}
        
        if (!usedDevices.includes(deviceId)) {
            usedDevices.push(deviceId);
            await supabase
                .from('keys')
                .update({ used_devices: JSON.stringify(usedDevices), last_used_at: Date.now() })
                .eq('key_text', key);
            console.log(`📱 Key ${key} used on new device: ${deviceId}`);
        }
    }
    
    const remaining = formatRemainingTime(keyData.expiry_ms);
    
    res.json({ 
        ok: true, 
        expiryMs: keyData.expiry_ms, 
        hours: keyData.hours,
        remaining,
        message: `Key valid! Expires in ${remaining}`
    });
});

app.get('/api/check-key/:key', async (req, res) => {
    const { key } = req.params;
    const { data: keyData, error } = await supabase
        .from('keys')
        .select('*')
        .eq('key_text', key)
        .single();
    
    if (error || !keyData) {
        return res.json({ valid: false, message: 'Key not found' });
    }
    
    const isValid = keyData.active === 1 && Date.now() < keyData.expiry_ms;
    const remaining = isValid ? formatRemainingTime(keyData.expiry_ms) : null;
    
    res.json({
        valid: isValid,
        key: keyData.key_text,
        expiresAt: keyData.expiry_ms,
        remaining,
        message: isValid ? `Key valid for ${remaining}` : 'Key invalid or expired'
    });
});

// ========== ADMIN API ==========
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        adminToken = token;
        adminLastActivity = Date.now();
        await logAdminAction('ADMIN_LOGIN', `Admin logged in`, ip);
        console.log(`🔐 Admin logged in from ${ip}`);
        res.json({ ok: true, token });
    } else {
        await logAdminAction('ADMIN_LOGIN_FAILED', `Failed login attempt from ${ip}`, ip);
        res.json({ ok: false, message: 'Invalid credentials' });
    }
});

async function verifyAdmin(req, res, next) {
    const token = req.body.token || req.query.token;
    if (!token || token !== adminToken) {
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    adminLastActivity = Date.now();
    next();
}

app.post('/api/admin/add-key', verifyAdmin, async (req, res) => {
    const { key, userId, days = 0, hours = 0, minutes = 0, years = 0 } = req.body;
    
    const durationMs = (years * 365 * 86400000) + (days * 86400000) + (hours * 3600000) + (minutes * 60000);
    const finalDuration = durationMs === 0 ? 3 * 3600000 : durationMs;
    const expiryMs = Date.now() + finalDuration;
    const newKey = key || generateKey();
    
    const { error } = await supabase
        .from('keys')
        .insert([{
            key_text: newKey,
            chat_id: userId || null,
            expiry_ms: expiryMs,
            created_at: Date.now(),
            active: 1,
            hours: hours + (days * 24) + (years * 365 * 24)
        }]);
    
    if (error) {
        return res.json({ ok: false, message: error.message });
    }
    
    if (userId) {
        let { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('chat_id', userId)
            .single();
        
        if (!user) {
            await supabase.from('users').insert([{
                chat_id: userId,
                keys_generated: 1,
                banned: 0,
                cooldown_until: 0,
                last_key_at: Date.now(),
                last_active_at: Date.now(),
                created_at: Date.now()
            }]);
        } else {
            await supabase
                .from('users')
                .update({ keys_generated: user.keys_generated + 1, last_key_at: Date.now() })
                .eq('chat_id', userId);
        }
    }
    
    await logAdminAction('ADD_KEY', `Admin added key ${newKey} for user ${userId || 'public'}`, req.ip);
    console.log(`➕ Admin added key: ${newKey}`);
    res.json({ ok: true, key: newKey, expiryMs });
});

app.post('/api/admin/delete-all-keys', verifyAdmin, async (req, res) => {
    const { data, error } = await supabase.from('keys').delete().select();
    await logAdminAction('DELETE_ALL_KEYS', `Deleted ${data?.length || 0} keys`, req.ip);
    res.json({ ok: true, deletedCount: data?.length || 0 });
});

app.post('/api/admin/delete-expired-keys', verifyAdmin, async (req, res) => {
    const deletedCount = await deleteExpiredKeys();
    res.json({ ok: true, deletedCount });
});

app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
    const now = Date.now();
    
    const { count: totalKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true });
    const { count: activeKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true })
        .eq('active', 1).lt('expiry_ms', now);
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: bannedUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('banned', 1);
    
    const { data: totalGenerated } = await supabase.from('users').select('keys_generated');
    const totalKeysGenerated = totalGenerated?.reduce((sum, u) => sum + (u.keys_generated || 0), 0) || 0;
    
    res.json({
        ok: true,
        stats: {
            totalKeys: totalKeys || 0,
            activeKeys: activeKeys || 0,
            totalUsers: totalUsers || 0,
            bannedUsers: bannedUsers || 0,
            totalKeysGenerated: totalKeysGenerated,
            adminLoggedIn: !!adminToken
        }
    });
});

app.post('/api/admin/keys', verifyAdmin, async (req, res) => {
    const { page = 1, limit = 50, showExpired = false } = req.body;
    
    let query = supabase.from('keys').select('*', { count: 'exact' });
    
    if (!showExpired) {
        query = query.gt('expiry_ms', Date.now());
    }
    
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data: keys, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);
    
    res.json({ 
        ok: true, 
        keys: keys || [],
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
    });
});

app.post('/api/admin/delete-key', verifyAdmin, async (req, res) => {
    const { key } = req.body;
    const { error } = await supabase.from('keys').delete().eq('key_text', key);
    
    if (error) {
        return res.json({ ok: false, message: 'Key not found' });
    }
    
    await logAdminAction('DELETE_KEY', `Deleted key ${key}`, req.ip);
    res.json({ ok: true, message: 'Key deleted' });
});

app.post('/api/admin/ban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    const { error } = await supabase.from('users').update({ banned: 1 }).eq('chat_id', chatId);
    
    if (error) {
        return res.json({ ok: false, message: 'User not found' });
    }
    
    await logAdminAction('BAN_USER', `Banned user ${chatId}`, req.ip);
    res.json({ ok: true, message: 'User banned' });
});

app.post('/api/admin/unban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    const { error } = await supabase.from('users').update({ banned: 0 }).eq('chat_id', chatId);
    
    if (error) {
        return res.json({ ok: false, message: 'User not found' });
    }
    
    await logAdminAction('UNBAN_USER', `Unbanned user ${chatId}`, req.ip);
    res.json({ ok: true, message: 'User unbanned' });
});

app.post('/api/admin/users', verifyAdmin, async (req, res) => {
    const { page = 1, limit = 50 } = req.body;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data: users, count } = await supabase
        .from('users')
        .select('*', { count: 'exact' })
        .order('last_active_at', { ascending: false })
        .range(from, to);
    
    res.json({ 
        ok: true, 
        users: users || [],
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
    });
});

app.post('/api/admin/logs', verifyAdmin, async (req, res) => {
    const { limit = 100 } = req.body;
    const { data: logs } = await supabase
        .from('admin_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
    
    res.json({ ok: true, logs: logs || [] });
});

app.post('/api/admin/logout', verifyAdmin, async (req, res) => {
    await logAdminAction('ADMIN_LOGOUT', `Admin logged out`, req.ip);
    adminToken = null;
    res.json({ ok: true, message: 'Logged out' });
});

app.get('/api/admin/session', (req, res) => {
    res.json({ loggedIn: !!adminToken });
});

// ========== PUBLIC API ==========
app.get('/api/info', async (req, res) => {
    const { count: activeKeys } = await supabase
        .from('keys')
        .select('*', { count: 'exact', head: true })
        .eq('active', 1)
        .gt('expiry_ms', Date.now());
    
    const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
    
    res.json({
        name: 'VIP Key Generator',
        version: '1.0.0 (Vercel + Supabase)',
        status: 'online',
        activeKeys: activeKeys || 0,
        totalUsers: totalUsers || 0,
        uptime: process.uptime(),
        storage: 'Supabase (PostgreSQL) - Permanent'
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        memoryUsage: (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + ' MB'
    });
});

// ========== ROOT ==========
app.get('/', (req, res) => {
    res.redirect(TELEGRAM_URL);
});

// ========== START SERVER ==========
async function startServer() {
    await initDatabase();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║     VIP KEY GENERATOR - VERCEL + SUPABASE VERSION            ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}                                                    ║
║  💾 Storage: Supabase (PostgreSQL) - PERMANENT               ║
║  🌐 Deploy: Vercel Ready                                     ║
║                                                              ║
║  ✅ Keys will NEVER be lost!                                 ║
║  ✅ Works perfectly on Vercel serverless                     ║
╚══════════════════════════════════════════════════════════════╝
        `);
    });
}

startServer();

module.exports = app;