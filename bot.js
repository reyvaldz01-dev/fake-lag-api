const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = process.env.API_URL;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// User data cache
const userStates = new Map();

// ========== HELPERS ==========
async function getUser(chatId) {
    try {
        const res = await axios.post(`${API_URL}/api/get-user`, { chatId });
        return res.data;
    } catch (e) {
        return null;
    }
}

async function generateKey(chatId, hours = 3) {
    try {
        const res = await axios.post(`${API_URL}/api/get-key`, { chatId, hours });
        return res.data;
    } catch (e) {
        return { ok: false, error: 'network_error' };
    }
}

// ========== COMMANDS ==========
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    
    const welcomeMessage = `
🎮 *FAKE NINJA KEY GENERATOR* 🎮

Hello *${firstName}*! Welcome to Fake Ninja Bot.

✨ *Commands:*
/key - Generate new key (3 hours)
/key6 - Generate new key (6 hours)
/status - Check your active key
/help - Show this menu

⚠️ *Rules:*
• 1 key = 1 device only
• Cooldown 10 minutes after key expires
• Keys are unique and cannot be shared

*Powered by:* @${msg.from.username || 'BeyKix'}
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/key6?/, async (msg) => {
    const chatId = msg.chat.id;
    const hours = msg.text.includes('key6') ? 6 : 3;
    
    bot.sendMessage(chatId, '🔄 *Generating your key...*', { parse_mode: 'Markdown' });
    
    const result = await generateKey(chatId, hours);
    
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

*Instructions:*
1. Copy the key above
2. Open Fake Ninja app
3. Paste key in activation field
4. Enjoy!

⚠️ *Don't share this key with anyone!*
    `;
    
    bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const res = await axios.post(`${API_URL}/api/get-user-status`, { chatId });
        const data = res.data;
        
        if (data.activeKey) {
            const expiryDate = new Date(data.activeKey.expiryMs);
            const remaining = Math.ceil((data.activeKey.expiryMs - Date.now()) / 1000 / 60);
            const remainingText = remaining > 60 ? `${Math.ceil(remaining / 60)} hours` : `${remaining} minutes`;
            
            bot.sendMessage(chatId, `
📊 *YOUR STATUS*

🔑 *Active Key:* \`${data.activeKey.key}\`
⏰ *Expires in:* ${remainingText}
📅 *Expiry date:* ${expiryDate.toLocaleString()}

Use /key to generate new key after this one expires.
            `, { parse_mode: 'Markdown' });
        } else {
            let cooldownText = '';
            if (data.cooldownRemaining > 0) {
                const minutes = Math.ceil(data.cooldownRemaining / 60);
                cooldownText = `\n⏰ *Cooldown:* ${minutes} minutes remaining`;
            }
            
            bot.sendMessage(chatId, `
📊 *YOUR STATUS*

❌ *No active key*${cooldownText}

Use /key to generate a new key.
            `, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        bot.sendMessage(chatId, '❌ Error getting status. Please try again.');
    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, `
🆘 *HELP MENU*

*Available Commands:*
/start - Welcome message
/key - Generate 3-hour key
/key6 - Generate 6-hour key
/status - Check your active key
/help - Show this menu

*How to use:*
1. Type /key to generate a key
2. Copy the key shown
3. Paste in Fake Ninja app

*Rules:*
• 1 key per session
• Keys expire after duration
• 10-minute cooldown after expiry
• 1 key = 1 device

*Support:* Contact @${process.env.SUPPORT_USER || 'admin'}
    `, { parse_mode: 'Markdown' });
});

// Handle unknown commands
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    bot.sendMessage(chatId, `
❓ *Unknown command*

Type /help to see available commands.
    `, { parse_mode: 'Markdown' });
});

console.log('🤖 Telegram Bot started');