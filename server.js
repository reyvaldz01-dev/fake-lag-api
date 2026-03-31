const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ========== MONGODB CONNECTION ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fakelag';

mongoose.connect(MONGODB_URI);
const dbConn = mongoose.connection;
dbConn.on('error', console.error.bind(console, 'MongoDB error:'));
dbConn.once('open', () => console.log('✅ MongoDB connected'));

// ========== SCHEMAS ==========
const keySchema = new mongoose.Schema({
    key: String,
    expiryMs: Number,
    createdAt: Number,
    active: Boolean,
    maxDevices: Number,
    durationLabel: String,
    fp: String
});

const sessionSchema = new mongoose.Schema({
    fp: String,
    key: String,
    expiryMs: Number
});

const cooldownSchema = new mongoose.Schema({
    fp: String,
    expiredAt: Number
});

const banSchema = new mongoose.Schema({
    ip: String,
    expiry: Number
});

const pendingSchema = new mongoose.Schema({
    fp: String,
    token: String,
    hmac: String,
    hours: Number,
    expiry: Number
});

const configSchema = new mongoose.Schema({
    key: String,
    value: mongoose.Schema.Types.Mixed
});

const Key = mongoose.model('Key', keySchema);
const Session = mongoose.model('Session', sessionSchema);
const Cooldown = mongoose.model('Cooldown', cooldownSchema);
const Ban = mongoose.model('Ban', banSchema);
const Pending = mongoose.model('Pending', pendingSchema);
const Config = mongoose.model('Config', configSchema);

// ========== INIT DEFAULT CONFIG ==========
async function initConfig() {
    const admin = await Config.findOne({ key: 'adminSecret' });
    if (!admin) await Config.create({ key: 'adminSecret', value: 'FakeNinja2024' });
    
    const tokenExpire = await Config.findOne({ key: 'tokenExpireMs' });
    if (!tokenExpire) await Config.create({ key: 'tokenExpireMs', value: 3600000 });
    
    const maxDevices = await Config.findOne({ key: 'maxDevices' });
    if (!maxDevices) await Config.create({ key: 'maxDevices', value: 1 });
}
initConfig();

// ========== HELPER FUNCTIONS ==========
function generateKey() {
    return `VIPKEY-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateHMAC(data) {
    return crypto.createHmac('sha256', 'secret').update(data).digest('hex');
}

// ========== ADMIN API ==========
app.post('/api/admin', async (req, res) => {
    const { action } = req.query;
    const { password } = req.body;
    const secret = req.headers['x-admin-secret'];
    
    const adminConfig = await Config.findOne({ key: 'adminSecret' });
    const adminSecret = adminConfig ? adminConfig.value : 'FakeNinja2024';

    if (action === 'login') {
        return res.json({ ok: password === adminSecret });
    }

    if (secret !== adminSecret) return res.status(401).json({ ok: false });

    // STATS
    if (action === 'stats') {
        const totalKeys = await Key.countDocuments();
        const totalSessions = await Session.countDocuments();
        const totalBans = await Ban.countDocuments();
        return res.json({ ok: true, totalKeys, totalSessions, totalBans });
    }

    // LIST KEYS
    if (action === 'list') {
        const keys = await Key.find().sort({ createdAt: -1 });
        return res.json({ ok: true, keys });
    }

    // ADD KEY
    if (action === 'add') {
        const existing = await Key.findOne({ key: req.body.key });
        if (existing) return res.json({ ok: false, error: 'key_exists' });

        const newKey = new Key({
            key: req.body.key || generateKey(),
            expiryMs: Date.now() + ((req.body.hours || 3) * 3600000),
            createdAt: Date.now(),
            active: true,
            maxDevices: req.body.maxDevice || 1,
            durationLabel: `${req.body.hours || 3}h`,
            fp: null
        });
        await newKey.save();
        return res.json({ ok: true, ...newKey.toObject() });
    }

    // DELETE KEY
    if (action === 'delete') {
        await Key.deleteOne({ key: req.body.key });
        return res.json({ ok: true });
    }

    // TOGGLE KEY
    if (action === 'toggle') {
        await Key.updateOne({ key: req.body.key }, { $set: { active: req.body.active } });
        return res.json({ ok: true });
    }

    // DELETE ALL
    if (action === 'delete_all') {
        const count = await Key.countDocuments();
        await Key.deleteMany({});
        return res.json({ ok: true, deleted: count });
    }

    // RESET ALL
    if (action === 'reset_all') {
        await Key.deleteMany({});
        await Session.deleteMany({});
        await Cooldown.deleteMany({});
        return res.json({ ok: true });
    }

    // BAN IP
    if (action === 'ban_ip') {
        await Ban.findOneAndUpdate(
            { ip: req.body.ip },
            { ip: req.body.ip, expiry: req.body.duration ? Date.now() + req.body.duration : null },
            { upsert: true }
        );
        return res.json({ ok: true });
    }

    // UNBAN IP
    if (action === 'unban_ip') {
        await Ban.deleteOne({ ip: req.body.ip });
        return res.json({ ok: true });
    }

    // LIST BANS
    if (action === 'list_bans') {
        const bans = await Ban.find();
        return res.json({ ok: true, bans });
    }

    return res.json({ ok: false });
});

// ========== USER KEY API ==========
app.post('/api/key', async (req, res) => {
    const { action } = req.query;
    const { fp, hours, token, hmac } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Check ban
    const banned = await Ban.findOne({ ip: clientIp });
    if (banned && (!banned.expiry || Date.now() < banned.expiry)) {
        return res.status(403).json({ ok: false, error: 'banned' });
    }

    // PREFLIGHT
    if (action === 'preflight') {
        const activeSession = await Session.findOne({ fp });
        if (activeSession) return res.json({ ok: false, error: 'active_session' });

        const cooldown = await Cooldown.findOne({ fp });
        if (cooldown && Date.now() < cooldown.expiredAt + 600000) {
            return res.json({ ok: false, error: 'cooldown', remaining: cooldown.expiredAt + 600000 - Date.now() });
        }

        const newToken = generateToken();
        const newHmac = generateHMAC(`${newToken}:${fp}:${hours}`);
        await Pending.findOneAndUpdate(
            { fp },
            { fp, token: newToken, hmac: newHmac, hours, expiry: Date.now() + 300000 },
            { upsert: true }
        );
        return res.json({ ok: true, token: newToken, hmac: newHmac });
    }

    // VERIFY
    if (action === 'verify') {
        const pending = await Pending.findOne({ token, fp });
        if (!pending) return res.json({ ok: false, error: 'token_not_found' });
        if (Date.now() > pending.expiry) return res.json({ ok: false, error: 'token_expired' });
        
        const expectedHmac = generateHMAC(`${pending.token}:${pending.fp}:${pending.hours}`);
        if (hmac !== expectedHmac) return res.json({ ok: false, error: 'invalid_hmac' });

        const newKey = generateKey();
        const expiryMs = Date.now() + (pending.hours === 6 ? 21600000 : 10800000);

        await Session.findOneAndUpdate(
            { fp },
            { fp, key: newKey, expiryMs },
            { upsert: true }
        );

        const maxConfig = await Config.findOne({ key: 'maxDevices' });
        const maxDevices = maxConfig ? maxConfig.value : 1;

        await Key.create({
            key: newKey,
            expiryMs,
            createdAt: Date.now(),
            active: true,
            maxDevices,
            durationLabel: `${pending.hours}h`,
            fp
        });

        await Pending.deleteOne({ token, fp });
        return res.json({ ok: true, key: newKey, expiryMs });
    }

    return res.json({ ok: false });
});

app.get('/', (req, res) => res.json({ status: 'running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;