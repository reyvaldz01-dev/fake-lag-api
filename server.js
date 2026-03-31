const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Data disimpan di memory (gak ribet)
let db = {
    adminSecret: "FakeLagObb53",
    keys: []
};

// ========== ADMIN API ==========
app.post('/api/admin', (req, res) => {
    const { action, password } = req.body;
    const secret = req.headers['x-admin-secret'];

    console.log('📡', action);

    if (action === 'login') {
        return res.json({ ok: password === db.adminSecret });
    }

    if (secret !== db.adminSecret) {
        return res.status(401).json({ ok: false });
    }

    if (action === 'list') {
        return res.json({ ok: true, keys: db.keys });
    }

    if (action === 'add') {
        const newKey = {
            key: req.body.key || `VIPKEY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            expiryMs: Date.now() + ((req.body.hours || 3) * 3600000),
            active: true
        };
        db.keys.push(newKey);
        return res.json({ ok: true, ...newKey });
    }

    if (action === 'delete') {
        db.keys = db.keys.filter(k => k.key !== req.body.key);
        return res.json({ ok: true });
    }

    if (action === 'stats') {
        return res.json({ ok: true, totalKeys: db.keys.length });
    }

    return res.json({ ok: false });
});

// ========== USER API ==========
app.post('/api/key', (req, res) => {
    const { action, fp } = req.body;

    if (action === 'preflight') {
        return res.json({ 
            ok: true, 
            token: crypto.randomBytes(16).toString('hex'),
            hmac: 'dummy'
        });
    }

    if (action === 'verify') {
        const newKey = `VIPKEY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        return res.json({ ok: true, key: newKey, expiryMs: Date.now() + 10800000 });
    }

    return res.json({ ok: false });
});

app.get('/', (req, res) => {
    res.json({ status: 'running', keys: db.keys.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

module.exports = app;