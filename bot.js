const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== CONFIGURATION ==========
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found!');
}

let db = {
    keys: [],
    users: [],
    adminToken: null
};

// Helper functions
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `NINJA-${parts[0]}-${parts[1]}-${parts[2]}`;
}

function getUser(chatId) {
    let user = db.users.find(u => u.chatId === chatId);
    if (!user) {
        user = { chatId, keysGenerated: 0, banned: false, cooldownUntil: null };
        db.users.push(user);
    }
    return user;
}

function saveUser(user) {
    const index = db.users.findIndex(u => u.chatId === user.chatId);
    if (index !== -1) db.users[index] = user;
}

function generateKeyForUser(chatId, hours = 3) {
    const user = getUser(chatId);
    
    if (user.banned) {
        return { ok: false, error: 'banned' };
    }
    
    if (user.cooldownUntil && Date.now() < user.cooldownUntil) {
        const remaining = Math.ceil((user.cooldownUntil - Date.now()) / 1000);
        return { ok: false, error: 'cooldown', remaining };
    }
    
    const activeKey = db.keys.find(k => k.chatId === chatId && k.active && k.expiryMs > Date.now());
    if (activeKey) {
        return { ok: false, error: 'active_key_exists', key: activeKey.key };
    }
    
    const duration = hours * 3600000;
    const expiryMs = Date.now() + duration;
    const newKey = generateKey();
    
    db.keys.push({
        key: newKey,
        chatId,
        expiryMs,
        createdAt: Date.now(),
        active: true,
        used: false,
        deviceId: null,
        hours
    });
    
    user.keysGenerated++;
    user.lastKeyAt = Date.now();
    user.cooldownUntil = null;
    saveUser(user);
    
    return { ok: true, key: newKey, expiryMs };
}

// ========== TELEGRAM BOT ==========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    const username = msg.from.username;
    
    const user = getUser(chatId);
    user.username = username;
    user.firstName = firstName;
    saveUser(user);
    
    const welcomeMessage = `
🎮 *FAKE NINJA KEY GENERATOR* 🎮

Hello *${firstName}*! Welcome.

✨ *Commands:*
/key - Generate 3-hour key
/key6 - Generate 6-hour key
/status - Check your active key
/help - Show this menu

⚠️ *Rules:*
• 1 key = 1 device only
• Cooldown 10 minutes after key expires

*Powered by:* @BeyKix
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/key6?/, async (msg) => {
    const chatId = msg.chat.id;
    const hours = msg.text.includes('key6') ? 6 : 3;
    
    bot.sendMessage(chatId, '🔄 *Generating your key...*', { parse_mode: 'Markdown' });
    
    const result = generateKeyForUser(chatId, hours);
    
    if (!result.ok) {
        let errorMsg = '';
        switch (result.error) {
            case 'cooldown':
                const minutes = Math.ceil(result.remaining / 60);
                errorMsg = `⏰ *Cooldown Active*\nPlease wait ${minutes} minutes before generating again.`;
                break;
            case 'active_key_exists':
                errorMsg = `🔑 *You already have an active key!*\n\nYour key: \`${result.key}\`\n\nUse /status to check expiry.`;
                break;
            case 'banned':
                errorMsg = `🚫 *You are banned*\nContact admin for support.`;
                break;
            default:
                errorMsg = `❌ *Error:* ${result.error || 'Unknown error'}`;
        }
        bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
        return;
    }
    
    const expiryDate = new Date(result.expiryMs);
    const expiryFormatted = expiryDate.toLocaleString();
    
    const successMsg = `
✅ *KEY GENERATED SUCCESSFULLY*

🔑 \`${result.key}\`

⏰ *Valid until:* ${expiryFormatted}
📱 *Device limit:* 1 device only

⚠️ *Don't share this key with anyone!*
    `;
    
    bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    const activeKey = db.keys.find(k => k.chatId === chatId && k.active && k.expiryMs > Date.now());
    const user = getUser(chatId);
    
    if (activeKey) {
        const expiryDate = new Date(activeKey.expiryMs);
        const remaining = Math.ceil((activeKey.expiryMs - Date.now()) / 1000 / 60);
        const remainingText = remaining > 60 ? `${Math.ceil(remaining / 60)} hours` : `${remaining} minutes`;
        
        bot.sendMessage(chatId, `
📊 *YOUR STATUS*

🔑 *Active Key:* \`${activeKey.key}\`
⏰ *Expires in:* ${remainingText}
📅 *Expiry date:* ${expiryDate.toLocaleString()}
📱 *Key Type:* ${activeKey.hours} hour(s)

Use /key to generate new key after this one expires.
        `, { parse_mode: 'Markdown' });
    } else {
        let cooldownText = '';
        if (user.cooldownUntil && Date.now() < user.cooldownUntil) {
            const remaining = Math.ceil((user.cooldownUntil - Date.now()) / 1000 / 60);
            cooldownText = `\n⏰ *Cooldown:* ${remaining} minutes remaining`;
        }
        
        bot.sendMessage(chatId, `
📊 *YOUR STATUS*

❌ *No active key*${cooldownText}

📊 *Total keys generated:* ${user.keysGenerated}

Use /key to generate a new key.
        `, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, `
🆘 *HELP MENU*

*Commands:*
/start - Welcome
/key - Generate 3-hour key
/key6 - Generate 6-hour key
/status - Check key status
/help - This menu

*Rules:*
• 1 key = 1 device
• Cooldown 10 min after expiry

*Support:* @BeyKix
    `, { parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    bot.sendMessage(chatId, `
❓ *Unknown command*

Type /help to see available commands.
    `, { parse_mode: 'Markdown' });
});

console.log('🤖 Telegram Bot running (memory only - data will reset on restart)');

// ========== BACKEND API ==========

// User API - Get key
app.post('/api/get-key', (req, res) => {
    const { chatId, userId, hours } = req.body;
    const result = generateKeyForUser(chatId || userId, hours || 3);
    res.json(result);
});

// User API - Verify key
app.post('/api/verify-key', (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) return res.json({ ok: false, error: 'Missing key' });
    
    const keyData = db.keys.find(k => k.key === key);
    
    if (!keyData) return res.json({ ok: false, error: 'key_not_found' });
    if (!keyData.active) return res.json({ ok: false, error: 'key_inactive' });
    if (Date.now() > keyData.expiryMs) {
        keyData.active = false;
        return res.json({ ok: false, error: 'key_expired' });
    }
    if (keyData.used && keyData.deviceId && keyData.deviceId !== deviceId) {
        return res.json({ ok: false, error: 'device_mismatch' });
    }
    if (!keyData.used && deviceId) {
        keyData.used = true;
        keyData.deviceId = deviceId;
    }
    
    res.json({ ok: true, expiryMs: keyData.expiryMs, hours: keyData.hours });
});

// Admin API - Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        db.adminToken = token;
        res.json({ ok: true, token });
    } else {
        res.json({ ok: false });
    }
});

// Admin API - Stats
app.post('/api/admin/stats', (req, res) => {
    const { token } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const activeKeys = db.keys.filter(k => k.active && k.expiryMs > Date.now()).length;
    
    res.json({
        ok: true,
        totalKeys: db.keys.length,
        activeKeys,
        totalUsers: db.users.length,
        bannedUsers: db.users.filter(u => u.banned).length
    });
});

// Admin API - List keys
app.post('/api/admin/keys', (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const keys = [...db.keys].reverse().slice((page - 1) * limit, page * limit);
    res.json({ ok: true, keys });
});

// Admin API - Delete key
app.post('/api/admin/delete-key', (req, res) => {
    const { token, key } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    db.keys = db.keys.filter(k => k.key !== key);
    res.json({ ok: true });
});

// Admin API - Ban user
app.post('/api/admin/ban-user', (req, res) => {
    const { token, chatId } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const user = db.users.find(u => u.chatId === chatId);
    if (user) user.banned = true;
    res.json({ ok: true });
});

// Admin API - Unban user
app.post('/api/admin/unban-user', (req, res) => {
    const { token, chatId } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const user = db.users.find(u => u.chatId === chatId);
    if (user) user.banned = false;
    res.json({ ok: true });
});

// Admin API - List users
app.post('/api/admin/users', (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== db.adminToken) return res.status(401).json({ ok: false });
    
    const users = [...db.users].reverse().slice((page - 1) * limit, page * limit);
    res.json({ ok: true, users });
});

// Webhook endpoint
app.post('/api/bot/webhook', async (req, res) => {
    try {
        await bot.processUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        res.status(200).send('OK');
    }
});

// Set webhook page
app.get('/set-webhook', async (req, res) => {
    try {
        const vercelUrl = process.env.VERCEL_URL || `https://${req.get('host')}`;
        const webhookUrl = `${vercelUrl}/api/bot/webhook`;
        
        await bot.deleteWebHook();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await bot.setWebHook(webhookUrl);
        
        const botInfo = await bot.getMe();
        
        res.send(`
            <html>
            <head><title>Bot Status</title></head>
            <body style="background:#0f172a; color:white; font-family:monospace; padding:40px;">
                <h1 style="color:#22c55e;">✅ Webhook Configured</h1>
                <p>Bot: @${botInfo.username}</p>
                <p>URL: ${webhookUrl}</p>
                <a href="https://t.me/${botInfo.username}" style="color:#38bdf8;">Open Bot</a>
                <p style="margin-top:40px; color:#6a6a7a;">⚠️ Data stored in memory only. All keys will be lost on restart/redeploy.</p>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Fake Ninja System',
        version: '3.0.0',
        status: 'running',
        storage: 'memory-only (data resets on restart)',
        totalKeys: db.keys.length,
        totalUsers: db.users.length,
        bot: `https://t.me/${BOT_USERNAME}`
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 Bot: https://t.me/${BOT_USERNAME}`);
    console.log(`⚠️  MEMORY MODE: Data will be lost on restart/redeploy!`);
});

module.exports = app;