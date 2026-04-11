const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== SUPABASE CONFIGURATION ==========
const SUPABASE_URL = "https://iqweywcngktyvfiyebar.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2V5d2NuZ2t0eXZmaXllYmFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4NDEzNCwiZXhwIjoyMDkxNDYwMTM0fQ.q5eVJ-TDw1X14Pv_RJ0msB0_rbAyO1aUY4Oh7eer9UM";

if (!SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY.includes('xxxxx')) {
    console.error('❌ ERROR: Supabase Service Role Key belum diisi!');
    console.error('Silakan ambil dari: https://supabase.com/dashboard/project/iqweywcngktyvfiyebar/settings/api');
    process.exit(1);
}

// Inisialisasi Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ========== KONFIGURASI ==========
const ADMIN_PASSWORD = "ADMINN0";
const TELEGRAM_URL = 'https://t.me/ReyValdz';

let adminToken = null;

// ========== TEST KONEKSI SUPABASE ==========
async function testConnection() {
    console.log('🔄 Testing Supabase connection...');
    
    try {
        // Coba query simple untuk test koneksi
        const { data, error } = await supabase
            .from('keys')
            .select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('❌ Supabase connection error:', error.message);
            console.log('\n📌 Kemungkinan penyebab:');
            console.log('1. Service role key salah atau tidak lengkap');
            console.log('2. Tabel belum dibuat');
            console.log('3. URL Supabase salah');
            return false;
        }
        
        console.log('✅ Supabase connected successfully!');
        return true;
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        return false;
    }
}

// ========== MEMBUAT TABEL (Jika Belum Ada) ==========
async function createTables() {
    console.log('📦 Creating tables if not exist...');
    
    // Buat tabel keys
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
                key_type TEXT DEFAULT 'standard',
                used_devices TEXT DEFAULT '[]',
                last_used_at BIGINT
            );
        `
    });
    
    if (keysError && !keysError.message.includes('function')) {
        console.log('⚠️ Cannot create table via RPC, please create manually in Supabase SQL Editor');
        console.log(`
        ----- COPY THIS SQL TO SUPABASE SQL EDITOR -----
        CREATE TABLE IF NOT EXISTS keys (
            id SERIAL PRIMARY KEY,
            key_text TEXT UNIQUE NOT NULL,
            chat_id TEXT,
            expiry_ms BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            active INTEGER DEFAULT 1,
            hours INTEGER DEFAULT 3,
            max_devices INTEGER DEFAULT 1,
            key_type TEXT DEFAULT 'standard',
            used_devices TEXT DEFAULT '[]',
            last_used_at BIGINT
        );
        
        CREATE TABLE IF NOT EXISTS users (
            chat_id TEXT PRIMARY KEY,
            keys_generated INTEGER DEFAULT 0,
            banned INTEGER DEFAULT 0,
            cooldown_until BIGINT DEFAULT 0,
            last_key_at BIGINT DEFAULT 0,
            last_active_at BIGINT DEFAULT 0,
            created_at BIGINT DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            action TEXT,
            details TEXT,
            ip TEXT,
            timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        );
        
        CREATE INDEX IF NOT EXISTS idx_keys_expiry ON keys(expiry_ms);
        CREATE INDEX IF NOT EXISTS idx_keys_chat_id ON keys(chat_id);
        ----- END OF SQL -----
        `);
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
        console.error('Delete expired keys error:', error.message);
        return 0;
    }
    if (data && data.length > 0) {
        console.log(`🗑️ Deleted ${data.length} expired keys`);
    }
    return data?.length || 0;
}

// ========== GENERATE KEY FUNCTION ==========
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `VIPKEY-${parts[0]}-${parts[1]}-${parts[2]}`;
}

// ========== USER API ==========
app.post('/api/get-key', async (req, res) => {
    const { chatId, userId, hours = 3 } = req.body;
    const identifier = chatId || userId;
    
    if (!identifier) {
        return res.status(400).json({ ok: false, error: 'missing_id', message: 'chatId or userId is required' });
    }
    
    try {
        // Cek user
        let { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('chat_id', identifier)
            .single();
        
        if (!user) {
            const now = Date.now();
            const { data: newUser } = await supabase
                .from('users')
                .insert([{
                    chat_id: identifier,
                    keys_generated: 0,
                    banned: 0,
                    cooldown_until: 0,
                    last_key_at: 0,
                    last_active_at: now,
                    created_at: now
                }])
                .select()
                .single();
            user = newUser;
        }
        
        // Cek banned
        if (user?.banned === 1) {
            return res.json({ ok: false, error: 'banned', message: 'You are banned' });
        }
        
        // Generate key
        const expiryMs = Date.now() + (hours * 3600000);
        const newKey = generateKey();
        
        const { error: insertError } = await supabase
            .from('keys')
            .insert([{
                key_text: newKey,
                chat_id: identifier,
                expiry_ms: expiryMs,
                created_at: Date.now(),
                active: 1,
                hours: hours
            }]);
        
        if (insertError) {
            console.error('Insert error:', insertError);
            return res.json({ ok: false, error: 'database_error', message: insertError.message });
        }
        
        // Update user
        await supabase
            .from('users')
            .update({ 
                keys_generated: (user?.keys_generated || 0) + 1,
                last_key_at: Date.now()
            })
            .eq('chat_id', identifier);
        
        console.log(`🔑 Key generated: ${newKey}`);
        res.json({ ok: true, key: newKey, expiryMs });
        
    } catch (err) {
        console.error('Error in /api/get-key:', err);
        res.json({ ok: false, error: 'server_error', message: err.message });
    }
});

app.post('/api/verify-key', async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 'missing_key' });
    }
    
    try {
        const { data: keyData, error } = await supabase
            .from('keys')
            .select('*')
            .eq('key_text', key)
            .single();
        
        if (error || !keyData) {
            return res.json({ ok: false, error: 'key_not_found' });
        }
        
        if (Date.now() > keyData.expiry_ms) {
            await supabase.from('keys').update({ active: 0 }).eq('key_text', key);
            return res.json({ ok: false, error: 'key_expired' });
        }
        
        res.json({ ok: true, expiryMs: keyData.expiry_ms });
    } catch (err) {
        res.json({ ok: false, error: 'server_error' });
    }
});

// ========== ADMIN API ==========
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        adminToken = token;
        console.log(`🔐 Admin logged in`);
        res.json({ ok: true, token });
    } else {
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
        const { count: totalKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true });
        const { count: activeKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true }).eq('active', 1).gt('expiry_ms', Date.now());
        const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: bannedUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('banned', 1);
        
        res.json({
            ok: true,
            totalKeys: totalKeys || 0,
            activeKeys: activeKeys || 0,
            totalUsers: totalUsers || 0,
            bannedUsers: bannedUsers || 0
        });
    } catch (err) {
        res.json({ ok: true, totalKeys: 0, activeKeys: 0, totalUsers: 0, bannedUsers: 0 });
    }
});

app.post('/api/admin/keys', verifyAdmin, async (req, res) => {
    try {
        const { data: keys } = await supabase
            .from('keys')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        
        res.json({ ok: true, keys: keys || [] });
    } catch (err) {
        res.json({ ok: true, keys: [] });
    }
});

app.post('/api/admin/users', verifyAdmin, async (req, res) => {
    try {
        const { data: users } = await supabase
            .from('users')
            .select('*')
            .order('last_active_at', { ascending: false })
            .limit(100);
        
        res.json({ ok: true, users: users || [] });
    } catch (err) {
        res.json({ ok: true, users: [] });
    }
});

app.post('/api/admin/add-key', verifyAdmin, async (req, res) => {
    const { key, userId, days = 0, hours = 3, minutes = 0 } = req.body;
    
    const durationMs = (days * 86400000) + (hours * 3600000) + (minutes * 60000);
    const expiryMs = Date.now() + (durationMs || 3 * 3600000);
    const newKey = key || generateKey();
    
    const { error } = await supabase
        .from('keys')
        .insert([{
            key_text: newKey,
            chat_id: userId || null,
            expiry_ms: expiryMs,
            created_at: Date.now(),
            active: 1,
            hours: hours
        }]);
    
    if (error) {
        return res.json({ ok: false, error: error.message });
    }
    
    res.json({ ok: true, key: newKey, expiryMs });
});

app.post('/api/admin/delete-key', verifyAdmin, async (req, res) => {
    const { key } = req.body;
    await supabase.from('keys').delete().eq('key_text', key);
    res.json({ ok: true });
});

app.post('/api/admin/delete-all-keys', verifyAdmin, async (req, res) => {
    await supabase.from('keys').delete().neq('id', 0);
    res.json({ ok: true });
});

app.post('/api/admin/ban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    await supabase.from('users').update({ banned: 1 }).eq('chat_id', chatId);
    res.json({ ok: true });
});

app.post('/api/admin/unban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    await supabase.from('users').update({ banned: 0 }).eq('chat_id', chatId);
    res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
    adminToken = null;
    res.json({ ok: true });
});

// ========== PUBLIC ==========
app.get('/api/info', async (req, res) => {
    res.json({
        name: 'VIP Key Generator',
        version: '4.0.0',
        status: 'online',
        storage: 'Supabase'
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.redirect(TELEGRAM_URL);
});

// ========== START SERVER ==========
async function startServer() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║     VIP KEY GENERATOR - SUPABASE EDITION          ║');
    console.log('╚════════════════════════════════════════════════════╝\n');
    
    // Test koneksi
    const connected = await testConnection();
    
    if (!connected) {
        console.log('\n⚠️  Jalankan SQL berikut di Supabase SQL Editor:\n');
        console.log(`
CREATE TABLE IF NOT EXISTS keys (
    id SERIAL PRIMARY KEY,
    key_text TEXT UNIQUE NOT NULL,
    chat_id TEXT,
    expiry_ms BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    active INTEGER DEFAULT 1,
    hours INTEGER DEFAULT 3
);

CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    keys_generated INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    cooldown_until BIGINT DEFAULT 0,
    last_key_at BIGINT DEFAULT 0,
    last_active_at BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_logs (
    id SERIAL PRIMARY KEY,
    action TEXT,
    details TEXT,
    ip TEXT,
    timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);
        `);
    }
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n🚀 Server running on http://localhost:${PORT}`);
        console.log(`📦 Supabase: ${SUPABASE_URL}\n`);
    });
}

startServer();

module.exports = app;