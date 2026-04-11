const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ========== GANTI DENGAN DATA SUPABASE ANDA ==========
const SUPABASE_URL = "https://iqweywcngktyvfiyebar.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2V5d2NuZ2t0eXZmaXllYmFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4NDEzNCwiZXhwIjoyMDkxNDYwMTM0fQ.q5eVJ-TDw1X14Pv_RJ0msB0_rbAyO1aUY4Oh7eer9UM"; // <==== GANTI INI!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== KONFIGURASI ==========
const ADMIN_PASSWORD = "ADMINN0";
let adminToken = null;

// ========== FUNGSI GENERATE KEY ==========
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `VIPKEY-${parts[0]}-${parts[1]}-${parts[2]}`;
}

// ========== API 1: GET KEY ==========
app.post('/api/get-key', async (req, res) => {
    const { chatId } = req.body;
    
    if (!chatId) {
        return res.json({ ok: false, error: 'chatId required' });
    }
    
    try {
        // Cek atau buat user
        let { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('chat_id', chatId)
            .single();
        
        if (!user) {
            await supabase.from('users').insert([{
                chat_id: chatId,
                keys_generated: 0,
                banned: 0,
                created_at: Date.now()
            }]);
        }
        
        // Cek banned
        const { data: userCheck } = await supabase
            .from('users')
            .select('banned')
            .eq('chat_id', chatId)
            .single();
        
        if (userCheck && userCheck.banned === 1) {
            return res.json({ ok: false, error: 'banned' });
        }
        
        // Generate key
        const expiryMs = Date.now() + (3 * 3600000);
        const newKey = generateKey();
        
        const { error } = await supabase
            .from('keys')
            .insert([{
                key_text: newKey,
                chat_id: chatId,
                expiry_ms: expiryMs,
                created_at: Date.now(),
                active: 1
            }]);
        
        if (error) {
            return res.json({ ok: false, error: error.message });
        }
        
        // Update user key count
        await supabase
            .from('users')
            .update({ keys_generated: supabase.rpc('increment', { x: 1 }) })
            .eq('chat_id', chatId);
        
        res.json({ ok: true, key: newKey, expiryMs });
        
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// ========== API 2: VERIFY KEY ==========
app.post('/api/verify-key', async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 'key required' });
    }
    
    try {
        const { data: keyData } = await supabase
            .from('keys')
            .select('*')
            .eq('key_text', key)
            .single();
        
        if (!keyData) {
            return res.json({ ok: false, error: 'key_not_found' });
        }
        
        if (keyData.active !== 1) {
            return res.json({ ok: false, error: 'key_inactive' });
        }
        
        if (Date.now() > keyData.expiry_ms) {
            await supabase.from('keys').update({ active: 0 }).eq('key_text', key);
            return res.json({ ok: false, error: 'key_expired' });
        }
        
        res.json({ ok: true, expiryMs: keyData.expiry_ms });
        
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// ========== API 3: ADMIN LOGIN ==========
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        adminToken = crypto.randomBytes(32).toString('hex');
        res.json({ ok: true, token: adminToken });
    } else {
        res.json({ ok: false });
    }
});

// ========== MIDDLEWARE ADMIN ==========
function verifyAdmin(req, res, next) {
    const token = req.body.token;
    if (!token || token !== adminToken) {
        return res.status(401).json({ ok: false });
    }
    next();
}

// ========== API 4: ADMIN STATS ==========
app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
    const { count: totalKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true });
    const { count: activeKeys } = await supabase.from('keys').select('*', { count: 'exact', head: true }).eq('active', 1);
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    
    res.json({
        ok: true,
        totalKeys: totalKeys || 0,
        activeKeys: activeKeys || 0,
        totalUsers: totalUsers || 0
    });
});

// ========== API 5: ADMIN KEYS ==========
app.post('/api/admin/keys', verifyAdmin, async (req, res) => {
    const { data: keys } = await supabase
        .from('keys')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
    
    res.json({ ok: true, keys: keys || [] });
});

// ========== API 6: ADMIN USERS ==========
app.post('/api/admin/users', verifyAdmin, async (req, res) => {
    const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
    
    res.json({ ok: true, users: users || [] });
});

// ========== API 7: ADMIN ADD KEY ==========
app.post('/api/admin/add-key', verifyAdmin, async (req, res) => {
    const { key, userId, days = 0, hours = 3 } = req.body;
    
    const durationMs = (days * 86400000) + (hours * 3600000);
    const expiryMs = Date.now() + (durationMs || 10800000);
    const newKey = key || generateKey();
    
    const { error } = await supabase
        .from('keys')
        .insert([{
            key_text: newKey,
            chat_id: userId || null,
            expiry_ms: expiryMs,
            created_at: Date.now(),
            active: 1
        }]);
    
    if (error) {
        return res.json({ ok: false, error: error.message });
    }
    
    res.json({ ok: true, key: newKey, expiryMs });
});

// ========== API 8: ADMIN DELETE KEY ==========
app.post('/api/admin/delete-key', verifyAdmin, async (req, res) => {
    const { key } = req.body;
    await supabase.from('keys').delete().eq('key_text', key);
    res.json({ ok: true });
});

// ========== API 9: ADMIN DELETE ALL KEYS ==========
app.post('/api/admin/delete-all-keys', verifyAdmin, async (req, res) => {
    await supabase.from('keys').delete().neq('id', 0);
    res.json({ ok: true });
});

// ========== API 10: ADMIN BAN USER ==========
app.post('/api/admin/ban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    await supabase.from('users').update({ banned: 1 }).eq('chat_id', chatId);
    res.json({ ok: true });
});

// ========== API 11: ADMIN UNBAN USER ==========
app.post('/api/admin/unban-user', verifyAdmin, async (req, res) => {
    const { chatId } = req.body;
    await supabase.from('users').update({ banned: 0 }).eq('chat_id', chatId);
    res.json({ ok: true });
});

// ========== API 12: ADMIN LOGOUT ==========
app.post('/api/admin/logout', (req, res) => {
    adminToken = null;
    res.json({ ok: true });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║     SERVER BERJALAN!                   ║
╠════════════════════════════════════════╣
║  🚀 Port: ${PORT}                              ║
║  📦 Database: Supabase                  ║
╚════════════════════════════════════════╝
    `);
});