const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ========== MONGODB ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fakelag';
mongoose.connect(MONGODB_URI);

// ========== SCHEMAS ==========
const KeySchema = new mongoose.Schema({
    key: { type: String, unique: true },
    userId: { type: String, index: true },
    chatId: { type: String },
    expiryMs: Number,
    createdAt: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
    used: { type: Boolean, default: false },
    deviceId: { type: String, default: null }
});

const UserSchema = new mongoose.Schema({
    chatId: { type: String, unique: true },
    username: String,
    firstName: String,
    lastName: String,
    keysGenerated: { type: Number, default: 0 },
    lastKeyAt: Date,
    cooldownUntil: Date,
    banned: { type: Boolean, default: false }
});

const AdminSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'admin' }
});

const Key = mongoose.model('Key', KeySchema);
const User = mongoose.model('User', UserSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// ========== INIT ADMIN ==========
async function initAdmin() {
    const adminExists = await Admin.findOne({ username: 'admin' });
    if (!adminExists) {
        await Admin.create({
            username: 'admin',
            password: crypto.createHash('sha256').update('FakeNinja2024').digest('hex')
        });
        console.log('✅ Admin created');
    }
}
initAdmin();

// ========== HELPER FUNCTIONS ==========
function generateKey() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return `NINA-${parts[0]}-${parts[1]}-${parts[2]}`;
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ========== API ENDPOINTS ==========

// User: Get key
app.post('/api/get-key', async (req, res) => {
    const { chatId, hours } = req.body;
    
    if (!chatId) {
        return res.json({ ok: false, error: 'Missing chatId' });
    }
    
    const user = await User.findOne({ chatId });
    if (!user) {
        return res.json({ ok: false, error: 'user_not_found' });
    }
    
    if (user.banned) {
        return res.json({ ok: false, error: 'banned' });
    }
    
    if (user.cooldownUntil && new Date() < user.cooldownUntil) {
        const remaining = Math.ceil((user.cooldownUntil - new Date()) / 1000);
        return res.json({ ok: false, error: 'cooldown', remaining });
    }
    
    const activeKey = await Key.findOne({ chatId, active: true, expiryMs: { $gt: Date.now() } });
    if (activeKey) {
        return res.json({ ok: false, error: 'active_key_exists', key: activeKey.key });
    }
    
    const duration = (hours || 3) * 3600000;
    const expiryMs = Date.now() + duration;
    const newKey = generateKey();
    
    await Key.create({
        key: newKey,
        chatId,
        userId: chatId,
        expiryMs,
        active: true
    });
    
    await User.updateOne(
        { chatId },
        { 
            $inc: { keysGenerated: 1 },
            $set: { lastKeyAt: new Date() }
        }
    );
    
    res.json({ ok: true, key: newKey, expiryMs });
});

// User: Verify key
app.post('/api/verify-key', async (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key) {
        return res.json({ ok: false, error: 'Missing key' });
    }
    
    const keyData = await Key.findOne({ key });
    
    if (!keyData) {
        return res.json({ ok: false, error: 'key_not_found' });
    }
    
    if (!keyData.active) {
        return res.json({ ok: false, error: 'key_inactive' });
    }
    
    if (Date.now() > keyData.expiryMs) {
        await Key.updateOne({ key }, { active: false });
        return res.json({ ok: false, error: 'key_expired' });
    }
    
    if (keyData.used && keyData.deviceId && keyData.deviceId !== deviceId) {
        return res.json({ ok: false, error: 'device_mismatch' });
    }
    
    if (!keyData.used && deviceId) {
        await Key.updateOne({ key }, { used: true, deviceId });
    }
    
    res.json({ 
        ok: true, 
        expiryMs: keyData.expiryMs,
        message: 'Key valid'
    });
});

// Admin: Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const hashed = hashPassword(password);
    
    const admin = await Admin.findOne({ username, password: hashed });
    if (admin) {
        const token = crypto.randomBytes(32).toString('hex');
        res.json({ ok: true, token });
    } else {
        res.json({ ok: false });
    }
});

// Admin: Stats
app.post('/api/admin/stats', async (req, res) => {
    const { token } = req.body;
    if (token !== 'admin_token_here') { // In production, use JWT
        return res.status(401).json({ ok: false });
    }
    
    const totalKeys = await Key.countDocuments();
    const activeKeys = await Key.countDocuments({ active: true, expiryMs: { $gt: Date.now() } });
    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ banned: true });
    
    res.json({
        ok: true,
        totalKeys,
        activeKeys,
        totalUsers,
        bannedUsers
    });
});

// Admin: List keys
app.post('/api/admin/keys', async (req, res) => {
    const { token, page = 1, limit = 50 } = req.body;
    if (token !== 'admin_token_here') {
        return res.status(401).json({ ok: false });
    }
    
    const keys = await Key.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
    
    res.json({ ok: true, keys });
});

// Admin: Delete key
app.post('/api/admin/delete-key', async (req, res) => {
    const { token, key } = req.body;
    if (token !== 'admin_token_here') {
        return res.status(401).json({ ok: false });
    }
    
    await Key.deleteOne({ key });
    res.json({ ok: true });
});

// Admin: Ban user
app.post('/api/admin/ban-user', async (req, res) => {
    const { token, chatId } = req.body;
    if (token !== 'admin_token_here') {
        return res.status(401).json({ ok: false });
    }
    
    await User.updateOne({ chatId }, { banned: true });
    res.json({ ok: true });
});

// Admin: Unban user
app.post('/api/admin/unban-user', async (req, res) => {
    const { token, chatId } = req.body;
    if (token !== 'admin_token_here') {
        return res.status(401).json({ ok: false });
    }
    
    await User.updateOne({ chatId }, { banned: false });
    res.json({ ok: true });
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'running',
        endpoints: [
            '/api/get-key',
            '/api/verify-key',
            '/api/admin/login',
            '/api/admin/stats'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

module.exports = app;