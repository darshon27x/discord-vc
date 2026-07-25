const accountsDiv = document.getElementById('accountsList');
const tokenInput = document.getElementById('tokenInput');
const addBtn = document.getElementById('addBtn');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const logoutBtn = document.getElementById('logoutBtn');


const navLinks = document.getElementById('navLinks');
const viewSelfbotsBtn = document.getElementById('viewSelfbotsBtn');
const viewAdminBtn = document.getElementById('viewAdminBtn');
const selfbotsView = document.getElementById('selfbotsView');
const adminView = document.getElementById('adminView');


const userListBody = document.getElementById('userListBody');
const createUserBtn = document.getElementById('createUserBtn');

let tokenMap = new Map();
let currentView = 'selfbots'; 



function getApiBase() {
    let url = localStorage.getItem('panelBackendUrl') || '';
    if (url && url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    return url;
}

function getSessionToken() {
    return localStorage.getItem('panelSessionToken');
}

function getUsername() {
    return localStorage.getItem('panelUsername');
}

function getUserRole() {
    return localStorage.getItem('panelRole');
}


function checkAuth() {
    const token = getSessionToken();
    const username = getUsername();
    const role = getUserRole();
    const authOverlay = document.getElementById('authOverlay');
    const mainContainer = document.getElementById('mainContainer');
    const loggedInUserEl = document.getElementById('loggedInUser');
    
  
    const savedBackendUrl = localStorage.getItem('panelBackendUrl') || '';
    document.getElementById('backendUrlInput').value = savedBackendUrl;

    if (token && username) {
        authOverlay.style.display = 'none';
        mainContainer.style.display = 'block';
        loggedInUserEl.textContent = username;

        
        if (role === 'admin') {
            navLinks.style.display = 'flex';
        } else {
            navLinks.style.display = 'none';
            switchView('selfbots'); 
        }
        return true;
    } else {
        authOverlay.style.display = 'flex';
        mainContainer.style.display = 'none';
        navLinks.style.display = 'none';
        return false;
    }
}


function logoutLocal() {
    localStorage.removeItem('panelSessionToken');
    localStorage.removeItem('panelUsername');
    localStorage.removeItem('panelRole');
    checkAuth();
}


async function callApi(endpoint, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getSessionToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const res = await fetch(`${getApiBase()}${endpoint}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (res.status === 401) {
            logoutLocal();
            return { error: 'Session expired' };
        }
        
        const data = await res.json();
        if (!res.ok) alert(`Error: ${data.error || 'Unknown error'}`);
        return data;
    } catch(err) {
        console.error('API Error', err);
        return { error: 'Connection failed' };
    }
}


async function callApiGet(endpoint) {
    const headers = {};
    const token = getSessionToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${getApiBase()}${endpoint}`, {
        method: 'GET',
        headers: headers
    });
    
    if (res.status === 401) {
        logoutLocal();
        throw new Error('Unauthorized');
    }
    
    return res.json();
}


function switchView(view) {
    currentView = view;
    if (view === 'selfbots') {
        viewSelfbotsBtn.classList.add('active');
        viewAdminBtn.classList.remove('active');
        selfbotsView.style.display = 'block';
        adminView.style.display = 'none';
    } else if (view === 'admin' && getUserRole() === 'admin') {
        viewAdminBtn.classList.add('active');
        viewSelfbotsBtn.classList.remove('active');
        selfbotsView.style.display = 'none';
        adminView.style.display = 'block';
        fetchUsers(); 
    }
}


async function handleAuthSubmit() {
    const username = document.getElementById('usernameInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const backendUrlInput = document.getElementById('backendUrlInput').value.trim();
    
    if (!username || !password) {
        alert('Username and password are required');
        return;
    }

   
    let backendUrl = backendUrlInput;
    if (backendUrl && backendUrl.endsWith('/')) {
        backendUrl = backendUrl.slice(0, -1);
    }
    localStorage.setItem('panelBackendUrl', backendUrl);
    
    try {
        const res = await fetch(`${getApiBase()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('panelSessionToken', data.token);
            localStorage.setItem('panelUsername', data.username);
            localStorage.setItem('panelRole', data.role);
            document.getElementById('usernameInput').value = '';
            document.getElementById('passwordInput').value = '';
            checkAuth();
            await loadTokensFromBackend();
            await fetchAccounts();
            if (data.role === 'admin') {
                await fetchUsers();
            }
        } else {
            alert(`Login failed: ${data.error || 'Unknown error'}`);
        }
    } catch(err) {
        alert('Login failed. Cannot connect to server or invalid backend URL.');
    }
}


async function handleLogout() {
    const token = getSessionToken();
    if (token) {
        await fetch(`${getApiBase()}/api/auth/logout`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }).catch(() => {});
    }
    logoutLocal();
}


async function loadTokensFromBackend() {
    if (!getSessionToken()) return;
    try {
        const tokens = await callApiGet('/api/get-all-tokens');
        tokenMap.clear();
        for (const t of tokens) {
            tokenMap.set(t.prefix, t.token);
        }
        console.log(`🔄 Loaded ${tokenMap.size} tokens from backend`);
    } catch (err) {
        console.warn('Could not load tokens from backend', err);
    }
}


async function fetchAccounts() {
    if (!getSessionToken()) return;
    try {
        const accounts = await callApiGet('/api/accounts');
        renderAccounts(accounts);
    } catch (err) {
        accountsDiv.innerHTML = '<div class="loading">❌ Cannot connect to server</div>';
    }
}


function renderAccounts(accounts) {
    if (!accounts.length) {
        accountsDiv.innerHTML = '<div class="loading">No accounts added. Add a token above.</div>';
        return;
    }

    let html = '';
    for (const acc of accounts) {
        const prefix = acc.tokenPrefix;
        const savedGuild = localStorage.getItem(`guild_${prefix}`) || '';
        const savedVoice = localStorage.getItem(`voice_${prefix}`) || '';
        const savedMsgChan = localStorage.getItem(`msgChan_${prefix}`) || '';
        const savedMsgText = localStorage.getItem(`msgText_${prefix}`) || '';

        html += `
        <div class="account-card" data-prefix="${prefix}">
            <div class="card-header">
                <span class="username">${escapeHtml(acc.tag)}</span>
                <div>
                    <span class="status ${acc.status}">${acc.status}</span>
                    <button class="small-btn delete-btn" onclick="removeAccount('${prefix}')">🗑️</button>
                </div>
            </div>
            <div class="section-title">🎤 Voice control</div>
            <div class="voice-controls">
                <input type="text" id="guild-${prefix}" placeholder="Guild ID" value="${escapeHtml(savedGuild)}">
                <input type="text" id="voice-${prefix}" placeholder="Channel ID" value="${escapeHtml(savedVoice)}">
                <button class="small-btn primary" onclick="joinVoice('${prefix}')">Join</button>
                <button class="small-btn" onclick="leaveVoice('${prefix}')">Leave</button>
            </div>
            <div class="voice-controls">
                <button class="small-btn" onclick="setMute('${prefix}', true)">🔇 Mute</button>
                <button class="small-btn" onclick="setMute('${prefix}', false)">🎤 Unmute</button>
                <button class="small-btn" onclick="setDeafen('${prefix}', true)">🔞 Deafen</button>
                <button class="small-btn" onclick="setDeafen('${prefix}', false)">👂 Undeafen</button>
            </div>
            <div class="section-title">💬 Text message</div>
            <div class="send-message">
                <input type="text" id="msgChan-${prefix}" placeholder="Channel ID" value="${escapeHtml(savedMsgChan)}">
                <input type="text" id="msgText-${prefix}" placeholder="Message" value="${escapeHtml(savedMsgText)}">
                <button class="small-btn primary" onclick="sendMsg('${prefix}')">Send</button>
            </div>
        </div>`;
    }
    accountsDiv.innerHTML = html;

   
    for (const acc of accounts) {
        const p = acc.tokenPrefix;
        const guildInp = document.getElementById(`guild-${p}`);
        const voiceInp = document.getElementById(`voice-${p}`);
        const msgChanInp = document.getElementById(`msgChan-${p}`);
        const msgTextInp = document.getElementById(`msgText-${p}`);
        if (guildInp) guildInp.oninput = e => localStorage.setItem(`guild_${p}`, e.target.value);
        if (voiceInp) voiceInp.oninput = e => localStorage.setItem(`voice_${p}`, e.target.value);
        if (msgChanInp) msgChanInp.oninput = e => localStorage.setItem(`msgChan_${p}`, e.target.value);
        if (msgTextInp) msgTextInp.oninput = e => localStorage.setItem(`msgText_${p}`, e.target.value);
    }
}


function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}


window.removeAccount = async (prefix) => {
    const token = tokenMap.get(prefix);
    if (!token) return alert('Token not found. Please refresh the page.');
    if (confirm(`Remove ${prefix}? This will log out the account and delete its token permanently.`)) {
        await callApi('/api/remove-account', { token });
        tokenMap.delete(prefix);
        ['guild', 'voice', 'msgChan', 'msgText'].forEach(field => {
            localStorage.removeItem(`${field}_${prefix}`);
        });
        fetchAccounts();
    }
};


window.joinVoice = async (prefix) => {
    const token = tokenMap.get(prefix);
    if (!token) return alert('Token missing.');
    const guildId = document.getElementById(`guild-${prefix}`).value.trim();
    const channelId = document.getElementById(`voice-${prefix}`).value.trim();
    if (!guildId || !channelId) {
        alert('Please fill in both Guild ID and Channel ID');
        return;
    }
    const mute = confirm('Mute on join?');
    const deafen = confirm('Deafen on join?');
    const res = await callApi('/api/join-voice', { token, guildId, channelId, mute, deafen });
    if (res.success) {
        alert('✅ Joined voice channel');
    }
};


window.leaveVoice = async (prefix) => {
    const token = tokenMap.get(prefix);
    if (!token) return alert('Token missing');
    await callApi('/api/leave-voice', { token });
};


window.setMute = async (prefix, mute) => {
    const token = tokenMap.get(prefix);
    if (!token) return;
    await callApi('/api/set-voice-state', { token, mute });
};


window.setDeafen = async (prefix, deafen) => {
    const token = tokenMap.get(prefix);
    if (!token) return;
    await callApi('/api/set-voice-state', { token, deafen });
};


window.sendMsg = async (prefix) => {
    const token = tokenMap.get(prefix);
    if (!token) return alert('Token missing');
    const channelId = document.getElementById(`msgChan-${prefix}`).value.trim();
    const message = document.getElementById(`msgText-${prefix}`).value.trim();
    if (!channelId || !message) {
        alert('Channel ID and message cannot be empty');
        return;
    }
    const res = await callApi('/api/send-message', { token, channelId, message });
    if (res.success) {
        document.getElementById(`msgText-${prefix}`).value = '';
        localStorage.setItem(`msgText_${prefix}`, '');
    }
};


async function fetchUsers() {
    if (getUserRole() !== 'admin') return;
    try {
        const users = await callApiGet('/api/admin/users');
        renderUsers(users);
    } catch(err) {
        console.error('Cannot load users', err);
    }
}

function renderUsers(users) {
    let html = '';
    for (const u of users) {
        const isAdmin = u.role === 'admin';
        const isSelf = u.username === getUsername();

        html += `
        <tr>
            <td><strong>${escapeHtml(u.username)}</strong></td>
            <td><span class="role-badge ${u.role}">${u.role}</span></td>
            <td>${u.tokenCount} selfbot(s)</td>
            <td>
                <div class="limit-edit-group">
                    <input type="number" id="limit-${u.username}" value="${u.tokenLimit}" min="0" ${isAdmin ? 'disabled' : ''}>
                    ${!isAdmin ? `<button class="save-limit-btn" onclick="saveUserLimit('${u.username}')">Save</button>` : 'N/A'}
                </div>
            </td>
            <td>
                ${(!isSelf && !isAdmin) ? `<button class="delete-btn" onclick="deleteUserAccount('${u.username}')">🗑️ Delete</button>` : 'N/A'}
            </td>
        </tr>`;
    }
    userListBody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;">No users registered</td></tr>';
}

window.saveUserLimit = async (username) => {
    const limitInput = document.getElementById(`limit-${username}`);
    const tokenLimit = parseInt(limitInput.value);
    if (isNaN(tokenLimit) || tokenLimit < 0) {
        return alert('Please enter a valid limit number');
    }
    const res = await callApi('/api/admin/update-limit', { username, tokenLimit });
    if (res.success) {
        alert(`Updated account limit for ${username} to ${tokenLimit}`);
        fetchUsers();
    }
};

window.deleteUserAccount = async (username) => {
    if (confirm(`Are you sure you want to delete ${username}? This will remove all their selfbots and clear their voice connections.`)) {
        const res = await callApi('/api/admin/delete-user', { username });
        if (res.success) {
            alert(`Successfully deleted ${username}`);
            fetchUsers();
        }
    }
};


addBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
        alert('Please enter a Discord token');
        return;
    }
    const res = await callApi('/api/add-account', { token });
    if (res.success) {
        const prefix = token.slice(0, 10) + '...';
        tokenMap.set(prefix, token);
        tokenInput.value = '';
        fetchAccounts();
    }
});

createUserBtn.addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const tokenLimit = parseInt(document.getElementById('newLimit').value);
    
    if (!username || !password) {
        return alert('Username and password are required');
    }
    if (password.length < 6) {
        return alert('Password must be at least 6 characters');
    }
    
    const res = await callApi('/api/admin/create-user', { username, password, tokenLimit });
    if (res.success) {
        alert(`User ${username} created successfully!`);
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newLimit').value = '5';
        fetchUsers();
    }
});

authSubmitBtn.addEventListener('click', handleAuthSubmit);
logoutBtn.addEventListener('click', handleLogout);

viewSelfbotsBtn.addEventListener('click', () => switchView('selfbots'));
viewAdminBtn.addEventListener('click', () => switchView('admin'));


document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAuthSubmit();
});


(async () => {
    const isAuthed = checkAuth();
    if (isAuthed) {
        await loadTokensFromBackend();
        await fetchAccounts();
        if (getUserRole() === 'admin') {
            await fetchUsers();
        }
    }
   
    setInterval(() => {
        if (getSessionToken()) {
            fetchAccounts();
            if (getUserRole() === 'admin' && currentView === 'admin') {
                fetchUsers();
            }
        }
    }, 10000);
})();