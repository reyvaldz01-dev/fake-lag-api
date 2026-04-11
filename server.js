const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SUPABASE_URL = "https://iqweywcngktyvfiyebar.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2V5d2NuZ2t0eXZmaXllYmFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4NDEzNCwiZXhwIjoyMDkxNDYwMTM0fQ.q5eVJ-TDw1X14Pv_RJ0msB0_rbAyO1aUY4Oh7eer9UM";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Konfigurasi
const ADMIN_PASSWORD = "ADMINN0";
let adminToken = null;

// Help Function
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `VIPKEY-${parts[0]}-${parts[1]}-${parts[2]}`;
}

function formatTime(ms) {
    const remaining = Math.max(0, ms - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Database Initialization (Create Table Automatically)
async function initDatabase() {
    console.log('📦 Initializing database...');
    
    // Create a users table
    const { error: usersError } = await supabase.rpc('exec_sql', {
        query: `
            CREATE TABLE IF NOT EXISTS users (
                chat_id TEXT PRIMARY KEY,
                keys_generated INTEGER DEFAULT 0,
                banned INTEGER DEFAULT 0,
                cooldown_until BIGINT DEFAULT 0,
                last_key_at BIGINT DEFAULT 0,
                last_active_at BIGINT DEFAULT 0,
                created_at BIGINT DEFAULT 0
            );
        `
    });
    
    // Create keys table
    const { error: keysError } = await supabase.rpc('exec_sql', {
        query: `
            CREATE TABLE IF NOT EXISTS keys (
                id SERIAL PRIMARY KEY,
                key_text TEXT UNIQUE NOT NULL,
                chat_id TEXT,
                expiry_ms BIGINT NOT NULL,
                created_at BIGINT NOT NULL,
                active INTEGER DEFAULT 1,
                hours INTEGER DEFAULT 3,
                max_devices INTEGER DEFAULT 1,
                key_type TEXT DEFAULT 'standard'
            );
        `
    });
    
    // Create logs table
    const { error: logsError } = await supabase.rpc('exec_sql', {
        query: `
            CREATE TABLE IF NOT EXISTS admin_logs (
                id SERIAL PRIMARY KEY,
                action TEXT,
                details TEXT,
                ip TEXT,
                timestamp BIGINT DEFAULT 0
            );
        `
    });
    
    if (usersError && !usersError.message.includes('function')) {
        console.log('⚠️ Jika tabel belum ada, buat manual di Supabase SQL Editor dengan query di bawah:\n');
        console.log(`
CREATE TABLE users (
    chat_id TEXT PRIMARY KEY,
    keys_generated INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    cooldown_until BIGINT DEFAULT 0,
    last_key_at BIGINT DEFAULT 0,
    last_active_at BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
);

CREATE TABLE keys (
    id SERIAL PRIMARY KEY,
    key_text TEXT UNIQUE NOT NULL,
    chat_id TEXT,
    expiry_ms BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    active INTEGER DEFAULT 1,
    hours INTEGER DEFAULT 3,
    max_devices INTEGER DEFAULT 1,
    key_type TEXT DEFAULT 'standard'
);

CREATE TABLE admin_logs (
    id SERIAL PRIMARY KEY,
    action TEXT,
    details TEXT,
    ip TEXT,
    timestamp BIGINT DEFAULT 0
);
        `);
    } else {
        console.log('✅ Database tables ready');
    }
    
    // Cleanup expired keys
    await deleteExpiredKeys();
    setInterval(deleteExpiredKeys, 60 * 60 * 1000);
}

async function deleteExpiredKeys() {
    const now = Date.now();
    const { data, error } = await supabase
        .from('keys')
        .delete()
        .lt('expiry_ms', now)
        .eq('active', 1);
    
    if (data && data.length > 0) {
        console.log(`🗑️ Deleted ${data.length} expired keys`);
    }
}

async function logAdminAction(action, details, ip = null) {
    try {
        await supabase.from('admin_logs').insert([{
            action: action,
            details: details,
            ip: ip,
            timestamp: Date.now()
        }]);
    } catch (e) {
        console.error('Log error:', e.message);
    }
}

// Api User
app.post('/api/get-key', async (req, res) => {
    const { chatId, userId, hours = 3 } = req.body;
    const identifier = chatId || userId;
    
    if (!identifier) {
        return res.status(400).json({ 
            ok: false, 
            error: 'missing_id', 
            message: 'chatId or userId required' 
        });
    }
    
    try {
        // Get or create user
        let { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('chat_id', identifier)
            .single();
        
        if (!user) {
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                    chat_id: identifier,
                    keys_generated: 0,
                    banned: 0,
                    cooldown_until: 0,
                    last_key_at: 0,
                    last_active_at: Date.now(),
                    created_at: Date.now()
                }])
                .select()
                .single();
            
            if (insertError) {
                console.error('Insert user error:', insertError);
                return res.json({ ok: false, error: 'database_error', message: insertError.message });
            }
            user = newUser;
        }
        
        // Check banned
        if (user.banned === 1) {
            return res.json({ 
                ok: false, 
                error: 'banned', 
                message: 'You are banned from generating keys' 
            });
        }
        
        // Check cooldown
        if (user.cooldown_until && Date.now() < user.cooldown_until) {
            const remaining = Math.ceil((user.cooldown_until - Date.now()) / 1000);
            return res.json({ 
                ok: false, 
                error: 'cooldown', 
                remaining: remaining,
                message: `Please wait ${Math.ceil(remaining / 60)} minute(s)` 
            });
        }
        
        // Check existing active key
        const { data: activeKey, error: activeError } = await supabase
            .from('keys')
            .select('*')
            .eq('chat_id', identifier)
            .eq('active', 1)
            .gt('expiry_ms', Date.now())
            .maybeSingle();
        
        if (activeKey) {
            return res.json({ 
                ok: false, 
                error: 'active_key_exists', 
                key: activeKey.key_text,
                message: `You already have an active key: ${activeKey.key_text}`
            });
        }
        
        // Generate new key
        const expiryMs = Date.now() + (hours * 3600000);
        const newKey = generateKey();
        
        const { error: insertKeyError } = await supabase
            .from('keys')
            .insert([{
                key_text: newKey,
                chat_id: identifier,
                expiry_ms: expiryMs,
                created_at: Date.now(),
                active: 1,
                hours: hours,
                max_devices: 1,
                key_type: 'standard'
            }]);
        
        if (insertKeyError) {
            console.error('Insert key error:', insertKeyError);
            return res.json({ ok: false, error: 'database_error', message: insertKeyError.message });
        }
        
        // Update user
        await supabase
            .from('users')
            .update({ 
                keys_generated: (user.keys_generated || 0) + 1,
                last_key_at: Date.now(),
                cooldown_until: Date.now() + 60000,
                last_active_at: Date.now()
            })
            .eq('chat_id', identifier);
        
        console.log(`🔑 Key generated: ${newKey} for ${identifier}`);
        
        res.json({ 
            ok: true, 
            key: newKey, 
            expiryMs: expiryMs,
            expiresIn: `${hours} hours`,
            message: `Key generated successfully! Valid for ${hours} hours.`
        });
        
    } catch (err) {
        console.error('Server error:', err);
        res.json({ ok: false, error: 'server_error', message: err.message });
    }
});

app.post('/api/verify-key', async (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 'missing_key', message: 'Key is required' });
    }
    
    try {
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
        
        const remaining = formatTime(keyData.expiry_ms);
        
        res.json({ 
            ok: true, 
            expiryMs: keyData.expiry_ms, 
            hours: keyData.hours,
            remaining: remaining,
            message: `Key valid! Expires in ${remaining}`
        });
        
    } catch (err) {
        res.json({ ok: false, error: 'server_error', message: err.message });
    }
});

app.get('/api/check-key/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const { data: keyData, error } = await supabase
            .from('keys')
            .select('*')
            .eq('key_text', key)
            .single();
        
        if (error || !keyData) {
            return res.json({ valid: false, message: 'Key not found' });
        }
        
        const isValid = keyData.active === 1 && Date.now() < keyData.expiry_ms;
        const remaining = isValid ? formatTime(keyData.expiry_ms) : null;
        
        res.json({
            valid: isValid,
            key: keyData.key_text,
            expiresAt: keyData.expiry_ms,
            remaining: remaining,
            message: isValid ? `Key valid for ${remaining}` : 'Key invalid or expired'
        });
        
    } catch (err) {
        res.json({ valid: false, message: err.message });
    }
});

// ============================================================
// API ADMIN
// ============================================================
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        adminToken = token;
        await logAdminAction('ADMIN_LOGIN', 'Admin logged in', ip);
        console.log(`🔐 Admin logged in from ${ip}`);
        res.json({ ok: true, token: token });
    } else {
        await logAdminAction('ADMIN_LOGIN_FAILED', 'Failed login attempt', ip);
        res.json({ ok: false, message: 'Invalid credentials' });
    }
});

function verifyAdmin(req, res, next) {
    const token = req.body.token || req.query.token;
    if (!token || token !== adminToken) {
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    next();
}

app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const now = Date.now();
        
        const { count: totalKeys } = await supabase
            .from('keys')
            .select('*', { count: 'exact', head: true });
        
        const { count: activeKeys } = await supabase
            .from('keys')
            .select('*', { count: 'exact', head: true })
            .eq('active', 1)
            .gt('expiry_ms', now);
        
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        const { count: bannedUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('banned', 1);
        
        const { data: totalGenerated } = await supabase
            .from('users')
            .select('keys_generated');
        
        const totalKeysGenerated = totalGenerated?.reduce((sum, u) => sum + (u.keys_generated || 0), 0) || 0;
        
        res.json({
            ok: true,
            totalKeys: totalKeys || 0,
            activeKeys: activeKeys || 0,
            totalUsers: totalUsers || 0,
            bannedUsers: bannedUsers || 0,
            totalKeysGenerated: totalKeysGenerated
        });
        
    } catch (err) {
        res.json({ ok: true, totalKeys: 0, activeKeys: 0, totalUsers: 0, bannedUsers: 0 });
    }
});

app.post('/api/admin/keys', verifyAdmin, async (req, res) => {
    const { page = 1, limit = 50, showExpired = false } = req.body;
    
    try {
        let query = supabase
            .from('keys')
            .select('*', { count: 'exact' });
        
        if (!showExpired) {
            query = query.gt('expiry_ms', Date.now()).eq('active', 1);
        }
        
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        
        const { data: keys, count, error } = await query
            .order('created_at', { ascending: false })
            .range(from, to);
        
        if (error) throw error;
        
        res.json({
            ok: true,
            keys: keys || [],
            total: count || 0,
            page: page,
            totalPages: Math.ceil((count || 0) / limit)
        });
        
    } catch (err) {
        res.json({ ok: true, keys: [], total: 0 });
    }
});

app.post('/api/admin/users', verifyAdmin, async (req, res) => {
    const { page = 1, limit = 50 } = req.body;
    
    try {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        
        const { data: users, count, error } = await supabase
            .from('users')
            .select('*', { count: 'exact' })
            .order('last_active_at', { ascending: false })
            .range(from, to);
        
        if (error) throw error;
        
        res.json({
            ok: true,
            users: users || [],
            total: count || 0,
            page: page,
            totalPages: Math.ceil((count || 0) / limit)
        });
        
    } catch (err) {
        res.json({ ok: true, users: [], total: 0 });
    }
});

app.post('/api/admin/add-key', verifyAdmin, async (req, res) => {
    const { key, userId, days = 0, hours = 0, minutes = 0, maxDevices = 1, keyType = 'standard' } = req.body;
    
    const durationMs = (days * 86400000) + (hours * 3600000) + (minutes * 60000);
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
            hours: hours + (days * 24),
            max_devices: maxDevices,
            key_type: keyType
        }]);
    
    if (error) {
        return res.json({ ok: false, error: error.message });
    }
    
    if (userId) {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('chat_id', userId)
            .single();
        
        if (!existingUser) {
            await supabase.from('users').insert([{
                chat_id: userId,
                keys_generated: 1,
                banned: 0,
                last_key_at: Date.now(),
                last_active_at: Date.now(),
                created_at: Date.now()
            }]);
        } else {
            await supabase
                .from('users')
                .update({ keys_generated: (existingUser.keys_generated || 0) + 1, last_key_at: Date.now() })
                .eq('chat_id', userId);
        }
    }
    
    await logAdminAction('ADD_KEY', `Added key ${newKey} for user ${userId || 'public'}`, req.ip);
    console.log(`➕ Admin added key: ${newKey}`);
    res.json({ ok: true, key: newKey, expiryMs: expiryMs });
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

app.post('/api/admin/delete-all-keys', verifyAdmin, async (req, res) => {
    const { data, error } = await supabase.from('keys').delete().neq('id', 0).select();
    await logAdminAction('DELETE_ALL_KEYS', `Deleted ${data?.length || 0} keys`, req.ip);
    res.json({ ok: true, deletedCount: data?.length || 0 });
});

app.post('/api/admin/delete-expired-keys', verifyAdmin, async (req, res) => {
    const now = Date.now();
    const { data, error } = await supabase
        .from('keys')
        .delete()
        .lt('expiry_ms', now)
        .eq('active', 1)
        .select();
    
    res.json({ ok: true, deletedCount: data?.length || 0 });
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

app.post('/api/admin/logs', verifyAdmin, async (req, res) => {
    const { limit = 100 } = req.body;
    
    const { data: logs, error } = await supabase
        .from('admin_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
    
    res.json({ ok: true, logs: logs || [] });
});

app.post('/api/admin/logout', verifyAdmin, async (req, res) => {
    await logAdminAction('ADMIN_LOGOUT', 'Admin logged out', req.ip);
    adminToken = null;
    res.json({ ok: true, message: 'Logged out' });
});

app.get('/api/admin/session', (req, res) => {
    res.json({ loggedIn: !!adminToken });
});

// ============================================================
// PUBLIC API
// ============================================================
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
        version: '5.0.0',
        status: 'online',
        activeKeys: activeKeys || 0,
        totalUsers: totalUsers || 0,
        uptime: process.uptime(),
        storage: 'Supabase (PostgreSQL)'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memoryUsage: (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + ' MB'
    });
});

// ============================================================
// ROOT
// ============================================================
app.get('/', (req, res) => {
    res.json({
        message: 'VIP Key Generator API',
        endpoints: {
            user: ['POST /api/get-key', 'POST /api/verify-key', 'GET /api/check-key/:key'],
            admin: ['POST /api/admin/login', 'POST /api/admin/stats', 'POST /api/admin/keys', 'POST /api/admin/users', 'POST /api/admin/add-key', 'POST /api/admin/delete-key', 'POST /api/admin/ban-user', 'POST /api/admin/unban-user'],
            public: ['GET /api/info', 'GET /api/health']
        }
    });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;

async function start() {
    await initDatabase();
    
    app.listen(PORT, () => {
        console.log(`
VIP KEY GENERATOR v1.0 - SUPABASE EDITION    
🚀 Port: ${PORT}      
💾 Storage: PostgreSQL            
        `);
    });
}

start();

module.exports = app;