const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('discord.js-selfbot-youtsuho-v13');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());


app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static('public'));

const DATA_DIR = path.join(__dirname, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const USER_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let accounts = [];
const activeSessions = new Map(); // token -> username


function hashPassword(password, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function loadUsers() {
    try {
        let users = [];
        if (fs.existsSync(USER_FILE)) {
            users = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
        }
        
        
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length === 0) {
            const { salt, hash } = hashPassword('Q2006@Ff');
            const defaultAdmin = {
                username: 'darshonbro',
                hash,
                salt,
                role: 'admin',
                tokenLimit: 9999
            };
            users.push(defaultAdmin);
            saveUsers(users);
            console.log('👑 Seeded default admin user (username: darshonbro, password: [hidden])');
        }
        return users;
    } catch(e) { 
        console.error('User load error', e); 
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}


function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
            console.log(`📂 Loaded ${tokens.length} tokens from file`);
            return tokens;
        }
    } catch(e) { console.error('Load error', e); }
    return [];
}

function saveTokens() {
    const tokens = accounts.map(a => ({ token: a.token, owner: a.owner }));
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log(`💾 Saved ${tokens.length} tokens to file`);
}


async function loginAccount(token, owner) {
    if (accounts.find(a => a.token === token)) return false;
    const client = new Client();
    try {
        await client.login(token);
        const tag = client.user.tag;
        accounts.push({
            token,
            client,
            tag,
            status: 'online',
            voiceConnection: null,
            voiceState: { mute: false, deafen: false },
            owner
        });
        console.log(`✅ Logged in as ${tag} (Owner: ${owner})`);
        client.on('disconnect', () => {
            const acc = accounts.find(a => a.token === token);
            if (acc) acc.status = 'offline';
        });
        return true;
    } catch(err) {
        console.error(`Login fail ${token.slice(0,10)}...`, err.message);
        return false;
    }
}

async function initAll() {
    const tokens = loadTokens();
    for (const item of tokens) {
        if (item && item.token && item.owner) {
            await loginAccount(item.token, item.owner);
        }
    }
}

function findAcc(token) { return accounts.find(a => a.token === token); }


function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    const username = activeSessions.get(token);
    if (!username) return res.status(401).json({ error: 'Invalid or expired session' });

    req.username = username;
    next();
}

function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        const users = loadUsers();
        const user = users.find(u => u.username === req.username);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied: Admin only' });
        }
        next();
    });
}


app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    const cleanUsername = username.trim().toLowerCase();
    const users = loadUsers();
    const user = users.find(u => u.username === cleanUsername);
    if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }
    const { hash } = hashPassword(password, user.salt);
    if (hash !== user.hash) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, cleanUsername);
    res.json({ success: true, token, username: cleanUsername, role: user.role });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) activeSessions.delete(token);
    res.json({ success: true });
});


app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    const users = loadUsers();
    const data = users.map(u => {
        const tokenCount = accounts.filter(a => a.owner === u.username).length;
        return {
            username: u.username,
            role: u.role,
            tokenLimit: u.tokenLimit,
            tokenCount
        };
    });
    res.json(data);
});

app.post('/api/admin/create-user', authenticateAdmin, (req, res) => {
    const { username, password, tokenLimit = 5 } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const users = loadUsers();
    if (users.find(u => u.username === cleanUsername)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    const { salt, hash } = hashPassword(password);
    users.push({ 
        username: cleanUsername, 
        hash, 
        salt, 
        role: 'user', 
        tokenLimit: parseInt(tokenLimit) || 5 
    });
    saveUsers(users);
    res.json({ success: true });
});

app.post('/api/admin/update-limit', authenticateAdmin, (req, res) => {
    const { username, tokenLimit } = req.body;
    if (!username || tokenLimit === undefined) {
        return res.status(400).json({ error: 'Username and limit required' });
    }
    const limit = parseInt(tokenLimit);
    if (isNaN(limit) || limit < 0) {
        return res.status(400).json({ error: 'Invalid limit' });
    }
    const users = loadUsers();
    const user = users.find(u => u.username === username.trim().toLowerCase());
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.tokenLimit = limit;
    saveUsers(users);
    res.json({ success: true });
});

app.post('/api/admin/delete-user', authenticateAdmin, async (req, res) => {
    const { username } = req.body;
    const targetUser = username.trim().toLowerCase();
    if (targetUser === 'darshonbro') {
        return res.status(400).json({ error: 'Cannot delete primary admin account' });
    }
    const users = loadUsers();
    const idx = users.findIndex(u => u.username === targetUser);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    
    users.splice(idx, 1);
    saveUsers(users);
    
    
    const userTokens = accounts.filter(a => a.owner === targetUser);
    for (const acc of userTokens) {
        if (acc.voiceConnection) {
            try { acc.voiceConnection.destroy(); } catch(e) {}
        }
        try { await acc.client.destroy(); } catch(e) {}
    }
    accounts = accounts.filter(a => a.owner !== targetUser);
    saveTokens();
    
    res.json({ success: true });
});


app.post('/api/add-account', authenticateToken, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    
    const users = loadUsers();
    const user = users.find(u => u.username === req.username);
    if (!user) return res.status(401).json({ error: 'User not found' });

   
    const userTokenCount = accounts.filter(a => a.owner === req.username).length;
    if (userTokenCount >= user.tokenLimit) {
        return res.status(400).json({ error: `Account limit reached. You can only add up to ${user.tokenLimit} selfbots.` });
    }

    if (findAcc(token)) return res.status(400).json({ error: 'Already exists' });
    const ok = await loginAccount(token, req.username);
    if (ok) {
        saveTokens();
        const acc = findAcc(token);
        res.json({ success: true, tag: acc.tag });
    } else {
        res.status(500).json({ error: 'Invalid token' });
    }
});

app.post('/api/remove-account', authenticateToken, async (req, res) => {
    const { token } = req.body;
    const idx = accounts.findIndex(a => a.token === token && a.owner === req.username);
    if (idx === -1) return res.status(404).json({ error: 'Not found or unauthorized' });
    const acc = accounts[idx];
    if (acc.voiceConnection) {
        try { acc.voiceConnection.destroy(); } catch(e) {}
    }
    try { await acc.client.destroy(); } catch(e) {}
    accounts.splice(idx, 1);
    saveTokens();
    res.json({ success: true });
});

app.get('/api/accounts', authenticateToken, (req, res) => {
    const userAccounts = accounts.filter(a => a.owner === req.username);
    const safe = userAccounts.map(a => ({
        tag: a.tag,
        status: a.status,
        tokenPrefix: a.token.slice(0,10)+'...',
        inVoice: !!a.voiceConnection
    }));
    res.json(safe);
});

app.get('/api/get-all-tokens', authenticateToken, (req, res) => {
    const userAccounts = accounts.filter(a => a.owner === req.username);
    const tokensList = userAccounts.map(acc => ({
        prefix: acc.token.slice(0,10)+'...',
        token: acc.token
    }));
    res.json(tokensList);
});

app.post('/api/join-voice', authenticateToken, async (req, res) => {
    const { token, guildId, channelId, mute = false, deafen = false } = req.body;
    const acc = findAcc(token);
    if (!acc || acc.owner !== req.username) return res.status(404).json({ error: 'Account not found or unauthorized' });

    const guild = acc.client.guilds.cache.get(guildId);
    if (!guild) return res.status(400).json({ error: 'Invalid Guild ID' });
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoice()) return res.status(400).json({ error: 'Invalid Voice Channel ID' });

    try {
        if (acc.voiceConnection) {
            acc.voiceConnection.destroy();
            acc.voiceConnection = null;
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfMute: mute,
            selfDeaf: deafen
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`🎤 ${acc.tag} joined ${channel.name} (mute=${mute}, deaf=${deafen})`);
            acc.voiceState.mute = mute;
            acc.voiceState.deafen = deafen;
        });

        connection.on('error', err => console.error(`Voice error for ${acc.tag}:`, err));
        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 ${acc.tag} disconnected from voice`);
            if (acc.voiceConnection === connection) acc.voiceConnection = null;
        });

        acc.voiceConnection = connection;
        res.json({ success: true, message: `Joined ${channel.name}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/leave-voice', authenticateToken, (req, res) => {
    const { token } = req.body;
    const acc = findAcc(token);
    if (!acc || acc.owner !== req.username) return res.status(404).json({ error: 'Account not found or unauthorized' });
    if (acc.voiceConnection) {
        try {
            acc.voiceConnection.destroy();
        } catch(e) {}
        acc.voiceConnection = null;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Not in a voice channel' });
    }
});

app.post('/api/set-voice-state', authenticateToken, (req, res) => {
    const { token, mute, deafen } = req.body;
    const acc = findAcc(token);
    if (!acc || acc.owner !== req.username) {
        return res.status(400).json({ error: 'Account not found or unauthorized' });
    }
    if (!acc.voiceConnection) {
        return res.status(400).json({ error: 'Not in a voice channel' });
    }
    try {
        const connection = acc.voiceConnection;
        const guildId = connection.joinConfig.guildId;
        const channelId = connection.joinConfig.channelId;
        const guild = acc.client.guilds.cache.get(guildId);
        if (!guild) return res.status(400).json({ error: 'Guild not found' });

        const newMute = mute !== undefined ? mute : acc.voiceState.mute;
        const newDeafen = deafen !== undefined ? deafen : acc.voiceState.deafen;

        joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfMute: newMute,
            selfDeaf: newDeafen
        });

        acc.voiceState.mute = newMute;
        acc.voiceState.deafen = newDeafen;
        res.json({ success: true });
    } catch (err) {
        console.error(`Failed to set voice state for ${acc.tag}:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-message', authenticateToken, async (req, res) => {
    const { token, channelId, message } = req.body;
    const acc = findAcc(token);
    if (!acc || acc.owner !== req.username) return res.status(404).json({ error: 'No account or unauthorized' });
    const ch = acc.client.channels.cache.get(channelId);
    if (!ch || (ch.type !== 'GUILD_TEXT' && ch.type !== 'DM')) {
        return res.status(400).json({ error: 'Invalid channel' });
    }
    try {
        await ch.send(message);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.send('OK'));


setInterval(() => {
    fetch(`http://0.0.0.0:${PORT}/health`).catch(()=>{});
}, 30000);
setInterval(() => console.log('❤️ Heartbeat'), 30000);

app.listen(PORT, 'localhost', async () => {
    console.log(`🌐 Web panel at http://localhost:${PORT}`);
    loadUsers(); 
    await initAll();
});