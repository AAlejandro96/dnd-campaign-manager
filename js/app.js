/* =========================================================
   THE CAMPAIGN CODEX — App Logic (Firebase Cloud Edition)
   ========================================================= */

// ─── FIREBASE CONFIG ─────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAvplpY_70xPgoDaxXwiZwjAqaqav1qtaY",
    authDomain: "dm-campaign-manager-ca6a6.firebaseapp.com",
    projectId: "dm-campaign-manager-ca6a6",
    storageBucket: "dm-campaign-manager-ca6a6.firebasestorage.app",
    messagingSenderId: "750564684599",
    appId: "1:750564684599:web:f655ffeff53fd141a1a0b2"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestore = firebase.firestore();
const fbStorage = firebase.storage();

// Offline persistence
firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ─── GROQ CONFIG ─────────────────────────────────────────
const GROQ_API_KEY = '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';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── D&D DATA ────────────────────────────────────────────
const DND_RACES = [
    'Human','Elf','Half-Elf','Dwarf','Halfling','Gnome','Half-Orc',
    'Tiefling','Dragonborn','Aasimar','Goliath','Tabaxi','Kenku',
    'Firbolg','Lizardfolk','Tortle','Changeling','Warforged',
    'Kalashtar','Shifter','Bugbear','Goblin','Hobgoblin','Kobold',
    'Orc','Yuan-Ti Pureblood','Genasi','Triton','Aarakocra',
    'Harengon','Owlin','Other'
];

const DND_CLASSES = [
    'Artificer','Barbarian','Bard','Blood Hunter','Cleric','Druid',
    'Fighter','Monk','Paladin','Ranger','Rogue','Sorcerer','Warlock',
    'Wizard','Other'
];

// ─── DATABASE (Firestore) ────────────────────────────────
const DB = {
    ref() {
        return firestore.collection('users').doc(auth.currentUser.uid).collection('workbooks');
    },

    async save(workbook) {
        const data = JSON.parse(JSON.stringify(workbook));
        await this.ref().doc(workbook.id).set(data);
    },

    async get(id) {
        const doc = await this.ref().doc(id).get();
        if (!doc.exists) return null;
        return doc.data();
    },

    async getAll() {
        const snap = await this.ref().get();
        return snap.docs.map(d => d.data());
    },

    async remove(id) {
        const wb = await this.get(id);
        if (wb) {
            const allFiles = [];
            (wb.pcs || []).forEach(c => { if (c.files) allFiles.push(...c.files); });
            (wb.npcs || []).forEach(c => { if (c.files) allFiles.push(...c.files); });
            (wb.story || []).forEach(s => { if (s.files) allFiles.push(...s.files); });
            await Promise.allSettled(allFiles.map(f => {
                if (f.storagePath) return fbStorage.ref(f.storagePath).delete();
                return Promise.resolve();
            }));
        }
        await this.ref().doc(id).delete();
    }
};

// ─── STATE ───────────────────────────────────────────────
const State = {
    view: 'landing',
    workbooks: [],
    currentWorkbook: null,
    currentTab: 'summary'
};

// ─── UTILITIES ───────────────────────────────────────────
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function truncate(str, len = 200) {
    if (!str || str.length <= len) return str || '';
    return str.slice(0, len) + '…';
}

function createWorkbook(name) {
    return {
        id: uid(),
        name: name,
        createdAt: new Date().toISOString(),
        pcs: [],
        npcs: [],
        sessionLog: [],
        story: [],
        ideas: [],
        brainstormHistory: []
    };
}

// ─── DOM REFS ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    loadingOverlay: $('#loading-overlay'),
    authPage:       $('#auth-page'),
    landingPage:    $('#landing-page'),
    workbookView:   $('#workbook-view'),
    workbookList:   $('#workbook-list'),
    createBtn:      $('#create-workbook-btn'),
    backBtn:        $('#back-btn'),
    deleteBtn:      $('#delete-campaign-btn'),
    campaignTitle:  $('#campaign-title'),
    tabNav:         $('#tab-nav'),
    tabContent:     $('#tab-content'),
    modalOverlay:   $('#modal-overlay'),
    modal:          $('#modal'),
    modalContent:   $('#modal-content'),
    modalClose:     $('#modal-close'),
    signinBtn:      $('#google-signin-btn'),
    signoutBtn:     $('#signout-btn'),
    userInfo:       $('#user-info')
};

// ─── AUTH ────────────────────────────────────────────────
async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (err) {
        if (err.code === 'auth/popup-blocked') {
            await auth.signInWithRedirect(provider);
        } else {
            alert('Sign-in failed: ' + err.message);
        }
    }
}

async function signOutUser() {
    await auth.signOut();
}

function renderUserInfo(user) {
    if (!user) { dom.userInfo.innerHTML = ''; return; }
    const photo = user.photoURL
        ? `<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer">`
        : '';
    dom.userInfo.innerHTML = `${photo} ${esc(user.displayName || user.email)}`;
}

function hideLoading() {
    dom.loadingOverlay.classList.remove('active');
}

function setupAuth() {
    auth.onAuthStateChanged(async (user) => {
        hideLoading();
        if (user) {
            dom.authPage.classList.remove('active');
            renderUserInfo(user);
            showLanding();
        } else {
            dom.landingPage.classList.remove('active');
            dom.workbookView.classList.remove('active');
            dom.authPage.classList.add('active');
            State.currentWorkbook = null;
            State.workbooks = [];
        }
    });
}

// ─── VIEW SWITCHING ──────────────────────────────────────
function showPage(name) {
    State.view = name;
    dom.authPage.classList.remove('active');
    dom.landingPage.classList.toggle('active', name === 'landing');
    dom.workbookView.classList.toggle('active', name === 'workbook');
}

async function showLanding() {
    State.currentWorkbook = null;
    State.currentTab = 'summary';
    showPage('landing');
    dom.workbookList.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Loading your tomes...</div>';
    try {
        State.workbooks = await DB.getAll();
    } catch (err) {
        console.error('Failed to load workbooks:', err);
        State.workbooks = [];
    }
    renderLanding();
}

async function openWorkbook(id) {
    showPage('workbook');
    dom.tabContent.innerHTML = '<div class="empty-state">Loading campaign...</div>';
    const wb = await DB.get(id);
    if (!wb) { showLanding(); return; }
    State.currentWorkbook = wb;
    State.currentTab = 'summary';
    dom.campaignTitle.textContent = wb.name;
    setActiveTab('summary');
    renderTab();
}

// ─── LANDING RENDERER ────────────────────────────────────
function renderLanding() {
    const list = dom.workbookList;
    if (State.workbooks.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                No campaigns yet. Forge your first adventure!
            </div>`;
        return;
    }
    list.innerHTML = State.workbooks
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(wb => {
            const pcCount = (wb.pcs || []).length;
            const sessCount = (wb.sessionLog || []).length;
            return `
            <div class="workbook-card" data-id="${wb.id}">
                <span class="book-icon">📕</span>
                <div class="book-title">${esc(wb.name)}</div>
                <div class="book-date">${fmtDate(wb.createdAt)}</div>
                <div class="book-stats">${pcCount} PC${pcCount !== 1 ? 's' : ''} · ${sessCount} Session${sessCount !== 1 ? 's' : ''}</div>
            </div>`;
        }).join('');
}

// ─── TAB SWITCHING ───────────────────────────────────────
function setActiveTab(tab) {
    State.currentTab = tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function renderTab() {
    const wb = State.currentWorkbook;
    if (!wb) return;
    const renderers = {
        'summary':     renderSummary,
        'pcs':         renderPCs,
        'npcs':        renderNPCs,
        'session-log': renderSessionLog,
        'story':       renderStory,
        'ideas':       renderIdeas,
        'brainstorm':  renderBrainstorm
    };
    const render = renderers[State.currentTab];
    if (render) render(wb);
}

// ─── SUMMARY TAB ─────────────────────────────────────────
function renderSummary(wb) {
    const hasPCs = wb.pcs.length > 0;
    const hasNPCs = wb.npcs.length > 0;
    const hasSessions = wb.sessionLog.length > 0;
    const hasStory = wb.story.length > 0;
    const hasIdeas = wb.ideas.length > 0;
    const isEmpty = !hasPCs && !hasNPCs && !hasSessions && !hasStory && !hasIdeas;

    if (isEmpty) {
        dom.tabContent.innerHTML = `
            <div class="summary-empty">
                <span class="quill-icon">🪶</span>
                <p>Your campaign chronicle awaits...</p>
                <p>As you fill the pages of this tome with characters, sessions,<br>
                and stories, a summary of your adventure will materialize here.</p>
            </div>`;
        return;
    }

    let html = '';
    html += `<div class="summary-section">
        <span class="summary-stat">⚔️ ${wb.pcs.length} Player Character${wb.pcs.length !== 1 ? 's' : ''}</span>
        <span class="summary-stat">👹 ${wb.npcs.length} NPC${wb.npcs.length !== 1 ? 's' : ''}</span>
        <span class="summary-stat">📖 ${wb.sessionLog.length} Session${wb.sessionLog.length !== 1 ? 's' : ''} Logged</span>
        <span class="summary-stat">💡 ${wb.ideas.length} Idea${wb.ideas.length !== 1 ? 's' : ''}</span>
    </div>`;

    if (hasPCs) {
        html += `<div class="summary-section">
            <h3>⚔️ The Party</h3>
            <div class="summary-roster">
                ${wb.pcs.map(pc => `<span class="summary-chip">${esc(pc.name)} · Lv${pc.level} ${esc(pc.race)} ${esc(pc.class)}</span>`).join('')}
            </div>
        </div>`;
    }

    if (hasNPCs) {
        html += `<div class="summary-section">
            <h3>👹 Notable NPCs</h3>
            <div class="summary-roster">
                ${wb.npcs.map(n => `<span class="summary-chip">${esc(n.name)}${n.race ? ' · ' + esc(n.race) : ''}${n.class ? ' ' + esc(n.class) : ''}</span>`).join('')}
            </div>
        </div>`;
    }

    if (hasSessions) {
        const latest = wb.sessionLog[wb.sessionLog.length - 1];
        html += `<div class="summary-section">
            <h3>📖 Latest Session — #${latest.sessionNumber}</h3>
            <p class="summary-text">${esc(truncate(latest.entry, 400))}</p>
        </div>`;
    }

    if (hasStory) {
        const latest = wb.story[wb.story.length - 1];
        html += `<div class="summary-section">
            <h3>🌍 The Story So Far</h3>
            <p class="summary-text">${esc(truncate(latest.entry, 400))}</p>
        </div>`;
    }

    dom.tabContent.innerHTML = html;
}

// ─── PCs TAB ─────────────────────────────────────────────
function renderPCs(wb) {
    let html = `
        <div class="tab-header">
            <h2 class="tab-title">Playable Characters</h2>
            <button class="btn btn-primary" data-action="add-pc">+ Add Player</button>
        </div>`;

    if (wb.pcs.length === 0) {
        html += `<div class="empty-state">No adventurers have joined your party yet.</div>`;
    } else {
        html += `<div class="character-grid">`;
        wb.pcs.forEach(pc => {
            html += `
            <div class="character-tile" data-action="view-pc" data-id="${pc.id}">
                <div class="char-actions">
                    <button class="btn-icon-only" data-action="edit-pc" data-id="${pc.id}" title="Edit">✏️</button>
                    <button class="btn-icon-only" data-action="remove-pc" data-id="${pc.id}" title="Remove">🗑️</button>
                </div>
                <div class="char-name">${esc(pc.name)}</div>
                <div class="char-info">${esc(pc.race)} ${esc(pc.class)}</div>
                <span class="char-level">Level ${pc.level}</span>
            </div>`;
        });
        html += `</div>`;
    }

    dom.tabContent.innerHTML = html;
}

// ─── NPCs TAB ────────────────────────────────────────────
function renderNPCs(wb) {
    let html = `
        <div class="tab-header">
            <h2 class="tab-title">Non-Playable Characters</h2>
            <button class="btn btn-primary" data-action="add-npc">+ Add NPC</button>
        </div>`;

    if (wb.npcs.length === 0) {
        html += `<div class="empty-state">No NPCs have been recorded in this tome.</div>`;
    } else {
        html += `<div class="character-grid">`;
        wb.npcs.forEach(npc => {
            html += `
            <div class="character-tile" data-action="view-npc" data-id="${npc.id}">
                <div class="char-actions">
                    <button class="btn-icon-only" data-action="edit-npc" data-id="${npc.id}" title="Edit">✏️</button>
                    <button class="btn-icon-only" data-action="remove-npc" data-id="${npc.id}" title="Remove">🗑️</button>
                </div>
                <div class="char-name">${esc(npc.name)}</div>
                <div class="char-info">${esc(npc.race || '')} ${esc(npc.class || '')}</div>
                ${npc.level ? `<span class="char-level">Level ${npc.level}</span>` : ''}
            </div>`;
        });
        html += `</div>`;
    }

    dom.tabContent.innerHTML = html;
}

// ─── SESSION LOG TAB ─────────────────────────────────────
function renderSessionLog(wb) {
    let html = `
        <div class="tab-header">
            <h2 class="tab-title">Session Log</h2>
            <button class="btn btn-primary" data-action="add-session">+ Add a Session</button>
        </div>`;

    if (wb.sessionLog.length === 0) {
        html += `<div class="empty-state">No sessions have been chronicled. Begin your tale!</div>`;
    } else {
        wb.sessionLog.slice().reverse().forEach((entry, i) => {
            if (i > 0) html += `<div class="ink-divider"></div>`;
            html += `
            <div class="session-entry">
                <div class="session-entry-header">
                    <span class="session-number">Session #${entry.sessionNumber}</span>
                    <span class="session-date">${fmtDate(entry.date)}</span>
                    <button class="btn-icon-only" data-action="remove-session" data-id="${entry.id}" title="Delete">🗑️</button>
                </div>
                <div class="session-body">${esc(entry.entry)}</div>
            </div>`;
        });
    }

    dom.tabContent.innerHTML = html;
}

// ─── THE STORY TAB ───────────────────────────────────────
function renderStory(wb) {
    let html = `
        <div class="tab-header">
            <h2 class="tab-title">The Story</h2>
            <button class="btn btn-primary" data-action="add-story">+ Add to the Story</button>
        </div>
        <p class="mb-20" style="opacity:0.6; font-style:italic; font-size:0.88rem;">
            Record the lore, history, and narrative of your campaign here. Upload maps, documents, or images as needed.
        </p>`;

    if (wb.story.length === 0) {
        html += `<div class="empty-state">The pages are blank, awaiting your world's tale.</div>`;
    } else {
        wb.story.slice().reverse().forEach((entry, i) => {
            if (i > 0) html += `<div class="ink-divider"></div>`;
            html += `
            <div class="story-entry">
                <div class="session-entry-header">
                    <div class="story-entry-date">${fmtDate(entry.date)}</div>
                    <button class="btn-icon-only" data-action="remove-story" data-id="${entry.id}" title="Delete">🗑️</button>
                </div>
                <div class="story-entry-text">${esc(entry.entry)}</div>
                ${renderFileChips(entry.files)}
            </div>`;
        });
    }

    dom.tabContent.innerHTML = html;
}

function renderFileChips(files) {
    if (!files || files.length === 0) return '';
    let html = `<div class="story-files">`;
    files.forEach(f => {
        const icon = getFileIcon(f.type);
        if (f.type && f.type.startsWith('image/') && f.url) {
            html += `<div style="margin-top:8px"><img src="${esc(f.url)}" alt="${esc(f.name)}" class="file-preview-img" style="max-width:100%;max-height:300px;border-radius:6px;border:2px solid var(--leather-light);"></div>`;
        }
        html += `<span class="file-chip" data-action="open-file" data-url="${esc(f.url || '')}">
            ${icon} ${esc(f.name)}
        </span>`;
    });
    html += `</div>`;
    return html;
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.includes('pdf')) return '📋';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
    return '📄';
}

// ─── IDEAS TAB ───────────────────────────────────────────
function renderIdeas(wb) {
    let html = `
        <div class="tab-header">
            <h2 class="tab-title">Ideas</h2>
            <button class="btn btn-primary" data-action="add-idea">+ Add Idea</button>
        </div>`;

    if (wb.ideas.length === 0) {
        html += `<div class="empty-state">A blank canvas for your brilliant schemes and plot hooks...</div>`;
    } else {
        wb.ideas.slice().reverse().forEach(idea => {
            html += `
            <div class="idea-card">
                <div class="idea-actions">
                    <button class="btn-icon-only" data-action="remove-idea" data-id="${idea.id}" title="Delete">🗑️</button>
                </div>
                <div class="idea-date">${fmtDate(idea.date)}</div>
                <div class="idea-text">${esc(idea.text)}</div>
            </div>`;
        });
    }

    dom.tabContent.innerHTML = html;
}

// ─── BRAINSTORM TAB ──────────────────────────────────────
function renderBrainstorm(wb) {
    let html = `
        <div class="brainstorm-container">
            <div class="chat-messages" id="chat-messages">
                <div class="chat-message system">
                    🧠 I am your Campaign Oracle. I have absorbed all knowledge within this tome — 
                    characters, sessions, story, and ideas. Ask me anything, or request help planning 
                    your next session.
                </div>`;

    wb.brainstormHistory.forEach(msg => {
        html += `<div class="chat-message ${msg.role === 'user' ? 'user' : 'ai'}">${esc(msg.content)}</div>`;
    });

    html += `
            </div>
            <div class="chat-input-area">
                <textarea id="chat-input" placeholder="Ask about your campaign, request session plans, brainstorm plot hooks..." rows="2"></textarea>
                <button class="btn btn-primary" data-action="send-chat">Send</button>
            </div>
        </div>`;

    dom.tabContent.innerHTML = html;
    scrollChat();

    const input = $('#chat-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendChat();
            }
        });
    }
}

function scrollChat() {
    const msgs = $('#chat-messages');
    if (msgs) setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 50);
}

// ─── AI INTEGRATION ──────────────────────────────────────
function buildAIContext(wb) {
    let ctx = `CAMPAIGN: "${wb.name}"\n\n`;

    if (wb.pcs.length > 0) {
        ctx += `=== PLAYER CHARACTERS ===\n`;
        wb.pcs.forEach(pc => {
            ctx += `- ${pc.name} | Race: ${pc.race} | Class: ${pc.class} | Level: ${pc.level}\n`;
            if (pc.details) ctx += `  Details: ${pc.details}\n`;
            if (pc.backstory) ctx += `  Backstory: ${pc.backstory}\n`;
            if (pc.comments) ctx += `  DM Notes: ${pc.comments}\n`;
        });
        ctx += '\n';
    }

    if (wb.npcs.length > 0) {
        ctx += `=== NON-PLAYER CHARACTERS ===\n`;
        wb.npcs.forEach(n => {
            ctx += `- ${n.name}`;
            if (n.race) ctx += ` | Race: ${n.race}`;
            if (n.class) ctx += ` | Class: ${n.class}`;
            if (n.level) ctx += ` | Level: ${n.level}`;
            ctx += '\n';
            if (n.comments) ctx += `  Notes: ${n.comments}\n`;
        });
        ctx += '\n';
    }

    if (wb.sessionLog.length > 0) {
        ctx += `=== SESSION LOG ===\n`;
        wb.sessionLog.forEach(s => {
            ctx += `--- Session #${s.sessionNumber} (${fmtDate(s.date)}) ---\n`;
            ctx += `${s.entry}\n\n`;
        });
    }

    if (wb.story.length > 0) {
        ctx += `=== THE STORY / WORLD LORE ===\n`;
        wb.story.forEach(s => {
            ctx += `${s.entry}\n\n`;
        });
    }

    if (wb.ideas.length > 0) {
        ctx += `=== DM'S IDEAS ===\n`;
        wb.ideas.forEach(i => {
            ctx += `- ${i.text}\n`;
        });
        ctx += '\n';
    }

    return ctx;
}

async function sendToAI(userMessage, wb) {
    const campaignContext = buildAIContext(wb);

    const systemPrompt = `You are an experienced, creative Dungeon Master assistant and campaign co-planner for a Dungeons & Dragons campaign. You have been given complete knowledge of the campaign (characters, session logs, world lore, and DM ideas). Use this knowledge to give relevant, contextual, and creative suggestions.

Your capabilities:
- Help plan the next session with encounter ideas, plot hooks, and story arcs
- Suggest NPC interactions and character development opportunities
- Create dramatic moments tied to player backstories
- Offer encounter balancing advice
- Brainstorm world-building elements
- Help resolve plot threads and create new ones
- Generate interesting dialogue or descriptions

Be creative, dramatic, and true to the spirit of D&D. Reference specific campaign details when relevant. Format your responses clearly.

CAMPAIGN DATA:
${campaignContext}`;

    // Use last 20 messages for context window efficiency
    const recentHistory = wb.brainstormHistory.slice(-20);
    const messages = [{ role: 'system', content: systemPrompt }];

    recentHistory.forEach(msg => {
        messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        });
    });

    messages.push({ role: 'user', content: userMessage });

    const body = {
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.85,
        max_tokens: 2048
    };

    const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('No response from the Oracle.');
    return text;
}

async function handleSendChat() {
    const input = $('#chat-input');
    const msg = input?.value?.trim();
    if (!msg) return;

    const wb = State.currentWorkbook;
    input.value = '';

    wb.brainstormHistory.push({ role: 'user', content: msg });
    const msgsEl = $('#chat-messages');
    msgsEl.innerHTML += `<div class="chat-message user">${esc(msg)}</div>`;
    msgsEl.innerHTML += `<div class="typing-indicator" id="typing"><span></span><span></span><span></span></div>`;
    scrollChat();

    try {
        const reply = await sendToAI(msg, wb);
        wb.brainstormHistory.push({ role: 'assistant', content: reply });
        await DB.save(wb);

        const typing = $('#typing');
        if (typing) typing.remove();
        msgsEl.innerHTML += `<div class="chat-message ai">${esc(reply)}</div>`;
    } catch (err) {
        const typing = $('#typing');
        if (typing) typing.remove();
        msgsEl.innerHTML += `<div class="chat-message error">⚠️ ${esc(err.message)}</div>`;
    }

    scrollChat();
}

// ─── MODAL SYSTEM ────────────────────────────────────────
function openModal(html) {
    dom.modalContent.innerHTML = html;
    dom.modalOverlay.classList.add('active');
}

function closeModal() {
    dom.modalOverlay.classList.remove('active');
    dom.modalContent.innerHTML = '';
}

function datalistOptions(items) {
    return items.map(i => `<option value="${esc(i)}">`).join('');
}

// ─── FILE HANDLING (Firebase Storage) ────────────────────
async function processFileUploads(inputEl) {
    if (!inputEl || !inputEl.files || inputEl.files.length === 0) return [];
    const files = [];
    for (const file of inputEl.files) {
        if (file.size > 10 * 1024 * 1024) {
            alert(`File "${file.name}" exceeds 10MB limit and was skipped.`);
            continue;
        }
        const fileId = uid();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `users/${auth.currentUser.uid}/files/${fileId}_${safeName}`;
        const ref = fbStorage.ref(storagePath);
        await ref.put(file);
        const url = await ref.getDownloadURL();
        files.push({
            id: fileId,
            name: file.name,
            type: file.type,
            size: file.size,
            url: url,
            storagePath: storagePath
        });
    }
    return files;
}

async function deleteFileFromStorage(storagePath) {
    if (!storagePath) return;
    try {
        await fbStorage.ref(storagePath).delete();
    } catch (e) {
        console.warn('File deletion failed:', e);
    }
}

function openFile(url) {
    if (url) window.open(url, '_blank');
}

// ─── PC FORMS ────────────────────────────────────────────
function showAddPCModal() {
    openModal(`
        <h3>Add New Player Character</h3>
        <form id="pc-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Name *</label>
                    <input type="text" name="name" required>
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" name="level" min="1" max="20" value="1">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Race</label>
                    <input type="text" name="race" list="race-list">
                    <datalist id="race-list">${datalistOptions(DND_RACES)}</datalist>
                </div>
                <div class="form-group">
                    <label>Class</label>
                    <input type="text" name="class" list="class-list">
                    <datalist id="class-list">${datalistOptions(DND_CLASSES)}</datalist>
                </div>
            </div>
            <div class="form-group">
                <label>Details</label>
                <textarea name="details" rows="2" placeholder="Appearance, personality, quirks..."></textarea>
            </div>
            <div class="form-group">
                <label>Backstory</label>
                <textarea name="backstory" rows="4" placeholder="The character's history and motivations..."></textarea>
            </div>
            <div class="form-group">
                <label>DM Comments</label>
                <textarea name="comments" rows="2" placeholder="Private DM notes about this character..."></textarea>
            </div>
            <div class="form-group">
                <label>Attachments (images, PDFs, docs)</label>
                <input type="file" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Add Character</button>
            </div>
        </form>
    `);

    $('#pc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const files = await processFileUploads(e.target.querySelector('[name=files]'));
            const pc = {
                id: uid(),
                name: fd.get('name'),
                race: fd.get('race'),
                class: fd.get('class'),
                level: parseInt(fd.get('level')) || 1,
                details: fd.get('details'),
                backstory: fd.get('backstory'),
                comments: fd.get('comments'),
                files: files
            };
            State.currentWorkbook.pcs.push(pc);
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Add Character';
        }
    });
}

function showEditPCModal(id) {
    const pc = State.currentWorkbook.pcs.find(p => p.id === id);
    if (!pc) return;

    openModal(`
        <h3>Edit Player Character</h3>
        <form id="pc-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Name *</label>
                    <input type="text" name="name" value="${esc(pc.name)}" required>
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" name="level" min="1" max="20" value="${pc.level}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Race</label>
                    <input type="text" name="race" value="${esc(pc.race)}" list="race-list">
                    <datalist id="race-list">${datalistOptions(DND_RACES)}</datalist>
                </div>
                <div class="form-group">
                    <label>Class</label>
                    <input type="text" name="class" value="${esc(pc.class)}" list="class-list">
                    <datalist id="class-list">${datalistOptions(DND_CLASSES)}</datalist>
                </div>
            </div>
            <div class="form-group">
                <label>Details</label>
                <textarea name="details" rows="2">${esc(pc.details)}</textarea>
            </div>
            <div class="form-group">
                <label>Backstory</label>
                <textarea name="backstory" rows="4">${esc(pc.backstory)}</textarea>
            </div>
            <div class="form-group">
                <label>DM Comments</label>
                <textarea name="comments" rows="2">${esc(pc.comments)}</textarea>
            </div>
            ${pc.files && pc.files.length > 0 ? `
            <div class="attached-files mb-10">
                <div class="attached-files-label">Current Files:</div>
                <div class="file-list" id="existing-files">
                    ${pc.files.map(f => `
                        <span class="file-chip">
                            ${getFileIcon(f.type)} ${esc(f.name)}
                            <span class="remove-file" data-file-id="${f.id}" data-storage-path="${esc(f.storagePath || '')}" data-action="remove-pc-file">✕</span>
                        </span>`).join('')}
                </div>
            </div>` : ''}
            <div class="form-group">
                <label>Add More Files</label>
                <input type="file" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
        </form>
    `);

    dom.modalContent.querySelectorAll('[data-action="remove-pc-file"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fid = btn.dataset.fileId;
            const spath = btn.dataset.storagePath;
            pc.files = pc.files.filter(f => f.id !== fid);
            if (spath) deleteFileFromStorage(spath);
            btn.closest('.file-chip').remove();
        });
    });

    $('#pc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const newFiles = await processFileUploads(e.target.querySelector('[name=files]'));
            pc.name = fd.get('name');
            pc.race = fd.get('race');
            pc.class = fd.get('class');
            pc.level = parseInt(fd.get('level')) || 1;
            pc.details = fd.get('details');
            pc.backstory = fd.get('backstory');
            pc.comments = fd.get('comments');
            pc.files = [...pc.files, ...newFiles];
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save Changes';
        }
    });
}

function showViewPC(id) {
    const pc = State.currentWorkbook.pcs.find(p => p.id === id);
    if (!pc) return;

    let html = `<h3>${esc(pc.name)}</h3><div class="char-detail">`;
    html += `<div class="detail-row"><span class="detail-label">Race:</span><span class="detail-value">${esc(pc.race) || '—'}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">Class:</span><span class="detail-value">${esc(pc.class) || '—'}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">Level:</span><span class="detail-value">${pc.level}</span></div>`;

    if (pc.details) {
        html += `<h4>Details</h4><div class="detail-block">${esc(pc.details)}</div>`;
    }
    if (pc.backstory) {
        html += `<h4>Backstory</h4><div class="detail-block">${esc(pc.backstory)}</div>`;
    }
    if (pc.comments) {
        html += `<h4>DM Comments</h4><div class="detail-block">${esc(pc.comments)}</div>`;
    }

    if (pc.files && pc.files.length > 0) {
        html += `<h4>Attachments</h4><div class="file-list">`;
        pc.files.forEach(f => {
            if (f.type && f.type.startsWith('image/') && f.url) {
                html += `<div><img src="${esc(f.url)}" alt="${esc(f.name)}" class="file-preview-img" style="cursor:pointer" onclick="window.open('${esc(f.url)}','_blank')"></div>`;
            }
            html += `<span class="file-chip" style="cursor:pointer" onclick="openFile('${esc(f.url || '')}')">
                ${getFileIcon(f.type)} ${esc(f.name)}
            </span>`;
        });
        html += `</div>`;
    }

    html += `</div>
    <div class="form-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal(); showEditPCModal('${pc.id}')">Edit</button>
    </div>`;

    openModal(html);
}

// ─── NPC FORMS ───────────────────────────────────────────
function showAddNPCModal() {
    openModal(`
        <h3>Add New NPC</h3>
        <form id="npc-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Name *</label>
                    <input type="text" name="name" required>
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" name="level" min="1" max="30" value="">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Race</label>
                    <input type="text" name="race" list="race-list">
                    <datalist id="race-list">${datalistOptions(DND_RACES)}</datalist>
                </div>
                <div class="form-group">
                    <label>Class / Role</label>
                    <input type="text" name="class" list="class-list" placeholder="e.g. Wizard, Innkeeper, Guard Captain">
                    <datalist id="class-list">${datalistOptions(DND_CLASSES)}</datalist>
                </div>
            </div>
            <div class="form-group">
                <label>Comments / Notes</label>
                <textarea name="comments" rows="4" placeholder="Personality, motivations, relationship to party, secrets..."></textarea>
            </div>
            <div class="form-group">
                <label>Attachments</label>
                <input type="file" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Add NPC</button>
            </div>
        </form>
    `);

    $('#npc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const files = await processFileUploads(e.target.querySelector('[name=files]'));
            const npc = {
                id: uid(),
                name: fd.get('name'),
                race: fd.get('race'),
                class: fd.get('class'),
                level: fd.get('level') ? parseInt(fd.get('level')) : null,
                comments: fd.get('comments'),
                files: files
            };
            State.currentWorkbook.npcs.push(npc);
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Add NPC';
        }
    });
}

function showEditNPCModal(id) {
    const npc = State.currentWorkbook.npcs.find(n => n.id === id);
    if (!npc) return;

    openModal(`
        <h3>Edit NPC</h3>
        <form id="npc-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Name *</label>
                    <input type="text" name="name" value="${esc(npc.name)}" required>
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" name="level" min="1" max="30" value="${npc.level || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Race</label>
                    <input type="text" name="race" value="${esc(npc.race)}" list="race-list">
                    <datalist id="race-list">${datalistOptions(DND_RACES)}</datalist>
                </div>
                <div class="form-group">
                    <label>Class / Role</label>
                    <input type="text" name="class" value="${esc(npc.class)}" list="class-list">
                    <datalist id="class-list">${datalistOptions(DND_CLASSES)}</datalist>
                </div>
            </div>
            <div class="form-group">
                <label>Comments / Notes</label>
                <textarea name="comments" rows="4">${esc(npc.comments)}</textarea>
            </div>
            ${npc.files && npc.files.length > 0 ? `
            <div class="attached-files mb-10">
                <div class="attached-files-label">Current Files:</div>
                <div class="file-list" id="existing-files">
                    ${npc.files.map(f => `
                        <span class="file-chip">
                            ${getFileIcon(f.type)} ${esc(f.name)}
                            <span class="remove-file" data-file-id="${f.id}" data-storage-path="${esc(f.storagePath || '')}" data-action="remove-npc-file">✕</span>
                        </span>`).join('')}
                </div>
            </div>` : ''}
            <div class="form-group">
                <label>Add More Files</label>
                <input type="file" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
        </form>
    `);

    dom.modalContent.querySelectorAll('[data-action="remove-npc-file"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fid = btn.dataset.fileId;
            const spath = btn.dataset.storagePath;
            npc.files = npc.files.filter(f => f.id !== fid);
            if (spath) deleteFileFromStorage(spath);
            btn.closest('.file-chip').remove();
        });
    });

    $('#npc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const newFiles = await processFileUploads(e.target.querySelector('[name=files]'));
            npc.name = fd.get('name');
            npc.race = fd.get('race');
            npc.class = fd.get('class');
            npc.level = fd.get('level') ? parseInt(fd.get('level')) : null;
            npc.comments = fd.get('comments');
            npc.files = [...npc.files, ...newFiles];
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save Changes';
        }
    });
}

function showViewNPC(id) {
    const npc = State.currentWorkbook.npcs.find(n => n.id === id);
    if (!npc) return;

    let html = `<h3>${esc(npc.name)}</h3><div class="char-detail">`;
    if (npc.race) html += `<div class="detail-row"><span class="detail-label">Race:</span><span class="detail-value">${esc(npc.race)}</span></div>`;
    if (npc.class) html += `<div class="detail-row"><span class="detail-label">Class/Role:</span><span class="detail-value">${esc(npc.class)}</span></div>`;
    if (npc.level) html += `<div class="detail-row"><span class="detail-label">Level:</span><span class="detail-value">${npc.level}</span></div>`;

    if (npc.comments) {
        html += `<h4>Notes</h4><div class="detail-block">${esc(npc.comments)}</div>`;
    }

    if (npc.files && npc.files.length > 0) {
        html += `<h4>Attachments</h4><div class="file-list">`;
        npc.files.forEach(f => {
            if (f.type && f.type.startsWith('image/') && f.url) {
                html += `<div><img src="${esc(f.url)}" alt="${esc(f.name)}" class="file-preview-img" style="cursor:pointer" onclick="window.open('${esc(f.url)}','_blank')"></div>`;
            }
            html += `<span class="file-chip" style="cursor:pointer" onclick="openFile('${esc(f.url || '')}')">
                ${getFileIcon(f.type)} ${esc(f.name)}
            </span>`;
        });
        html += `</div>`;
    }

    html += `</div>
    <div class="form-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal(); showEditNPCModal('${npc.id}')">Edit</button>
    </div>`;

    openModal(html);
}

// ─── SESSION LOG FORM ────────────────────────────────────
function showAddSessionModal() {
    const wb = State.currentWorkbook;
    const nextNum = wb.sessionLog.length > 0
        ? Math.max(...wb.sessionLog.map(s => s.sessionNumber)) + 1
        : 1;

    openModal(`
        <h3>Log a New Session</h3>
        <form id="session-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Session #</label>
                    <input type="number" name="sessionNumber" min="1" value="${nextNum}">
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <input type="text" name="date" value="${new Date().toLocaleDateString('en-US')}" placeholder="e.g. April 1, 2026">
                </div>
            </div>
            <div class="form-group">
                <label>What happened this session? *</label>
                <textarea name="entry" rows="10" required placeholder="Describe the main events, story beats, combat encounters, and key moments from this session..."></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Entry</button>
            </div>
        </form>
    `);

    $('#session-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const entry = {
                id: uid(),
                sessionNumber: parseInt(fd.get('sessionNumber')) || nextNum,
                date: new Date().toISOString(),
                entry: fd.get('entry')
            };
            wb.sessionLog.push(entry);
            await DB.save(wb);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save Entry';
        }
    });
}

// ─── STORY FORM ──────────────────────────────────────────
function showAddStoryModal() {
    openModal(`
        <h3>Add to the Story</h3>
        <form id="story-form">
            <div class="form-group">
                <label>Story Entry *</label>
                <textarea name="entry" rows="8" required placeholder="World lore, campaign history, current narrative threads, location descriptions..."></textarea>
            </div>
            <div class="form-group">
                <label>Attachments (maps, images, documents)</label>
                <input type="file" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Entry</button>
            </div>
        </form>
    `);

    $('#story-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const files = await processFileUploads(e.target.querySelector('[name=files]'));
            const entry = {
                id: uid(),
                date: new Date().toISOString(),
                entry: fd.get('entry'),
                files: files
            };
            State.currentWorkbook.story.push(entry);
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save Entry';
        }
    });
}

// ─── IDEA FORM ───────────────────────────────────────────
function showAddIdeaModal() {
    openModal(`
        <h3>Jot Down an Idea</h3>
        <form id="idea-form">
            <div class="form-group">
                <label>Your Idea</label>
                <textarea name="text" rows="6" required placeholder="Plot hooks, encounter ideas, NPC concepts, world details, anything goes..."></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Idea</button>
            </div>
        </form>
    `);

    $('#idea-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const fd = new FormData(e.target);
            const idea = {
                id: uid(),
                date: new Date().toISOString(),
                text: fd.get('text')
            };
            State.currentWorkbook.ideas.push(idea);
            await DB.save(State.currentWorkbook);
            closeModal();
            renderTab();
        } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save Idea';
        }
    });
}

// ─── CREATE WORKBOOK FORM ────────────────────────────────
function showCreateWorkbookModal() {
    openModal(`
        <h3>Forge a New Campaign</h3>
        <form id="create-wb-form">
            <div class="form-group">
                <label>Campaign Name *</label>
                <input type="text" name="name" required placeholder="e.g. Curse of Strahd, The Lost Mines..." autofocus>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Campaign</button>
            </div>
        </form>
    `);

    $('#create-wb-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Creating...';
        try {
            const name = new FormData(e.target).get('name').trim();
            if (!name) return;
            const wb = createWorkbook(name);
            await DB.save(wb);
            closeModal();
            openWorkbook(wb.id);
        } catch (err) {
            alert('Failed to create: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Create Campaign';
        }
    });
}

// ─── CONFIRM DIALOG ──────────────────────────────────────
function showConfirm(message, onConfirm) {
    openModal(`
        <div class="confirm-content">
            <p>${message}</p>
            <div class="confirm-actions">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn btn-danger" id="confirm-yes">Confirm</button>
            </div>
        </div>
    `);
    $('#confirm-yes').addEventListener('click', () => {
        closeModal();
        onConfirm();
    });
}

// ─── EVENT DELEGATION ────────────────────────────────────
function setupEventListeners() {
    // Auth
    dom.signinBtn.addEventListener('click', signIn);
    dom.signoutBtn.addEventListener('click', signOutUser);

    // Landing page — open workbook
    dom.workbookList.addEventListener('click', (e) => {
        const card = e.target.closest('.workbook-card');
        if (card) openWorkbook(card.dataset.id);
    });

    // Create workbook
    dom.createBtn.addEventListener('click', showCreateWorkbookModal);

    // Back to landing
    dom.backBtn.addEventListener('click', showLanding);

    // Delete campaign
    dom.deleteBtn.addEventListener('click', () => {
        const wb = State.currentWorkbook;
        if (!wb) return;
        showConfirm(
            `Are you sure you wish to destroy the campaign <strong>"${esc(wb.name)}"</strong>? This cannot be undone.`,
            async () => {
                await DB.remove(wb.id);
                showLanding();
            }
        );
    });

    // Tab navigation
    dom.tabNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        setActiveTab(btn.dataset.tab);
        renderTab();
    });

    // Tab content actions (delegation)
    dom.tabContent.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const id = target.dataset.id;

        switch (action) {
            case 'add-pc':      showAddPCModal(); break;
            case 'edit-pc':     e.stopPropagation(); showEditPCModal(id); break;
            case 'remove-pc':
                e.stopPropagation();
                showConfirm('Remove this character from your party?', async () => {
                    const pc = State.currentWorkbook.pcs.find(p => p.id === id);
                    if (pc && pc.files) {
                        await Promise.allSettled(pc.files.map(f => deleteFileFromStorage(f.storagePath)));
                    }
                    State.currentWorkbook.pcs = State.currentWorkbook.pcs.filter(p => p.id !== id);
                    await DB.save(State.currentWorkbook);
                    renderTab();
                });
                break;
            case 'view-pc':     showViewPC(id); break;

            case 'add-npc':     showAddNPCModal(); break;
            case 'edit-npc':    e.stopPropagation(); showEditNPCModal(id); break;
            case 'remove-npc':
                e.stopPropagation();
                showConfirm('Remove this NPC from your records?', async () => {
                    const npc = State.currentWorkbook.npcs.find(n => n.id === id);
                    if (npc && npc.files) {
                        await Promise.allSettled(npc.files.map(f => deleteFileFromStorage(f.storagePath)));
                    }
                    State.currentWorkbook.npcs = State.currentWorkbook.npcs.filter(n => n.id !== id);
                    await DB.save(State.currentWorkbook);
                    renderTab();
                });
                break;
            case 'view-npc':    showViewNPC(id); break;

            case 'add-session': showAddSessionModal(); break;
            case 'remove-session':
                showConfirm('Delete this session log entry?', async () => {
                    State.currentWorkbook.sessionLog = State.currentWorkbook.sessionLog.filter(s => s.id !== id);
                    await DB.save(State.currentWorkbook);
                    renderTab();
                });
                break;

            case 'add-story':   showAddStoryModal(); break;
            case 'remove-story':
                showConfirm('Delete this story entry?', async () => {
                    const se = State.currentWorkbook.story.find(s => s.id === id);
                    if (se && se.files) {
                        await Promise.allSettled(se.files.map(f => deleteFileFromStorage(f.storagePath)));
                    }
                    State.currentWorkbook.story = State.currentWorkbook.story.filter(s => s.id !== id);
                    await DB.save(State.currentWorkbook);
                    renderTab();
                });
                break;

            case 'add-idea':    showAddIdeaModal(); break;
            case 'remove-idea':
                showConfirm('Delete this idea?', async () => {
                    State.currentWorkbook.ideas = State.currentWorkbook.ideas.filter(i => i.id !== id);
                    await DB.save(State.currentWorkbook);
                    renderTab();
                });
                break;

            case 'send-chat':   handleSendChat(); break;

            case 'open-file': {
                const url = target.dataset.url;
                if (url) window.open(url, '_blank');
                break;
            }
        }
    });

    // Modal close
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalOverlay.addEventListener('click', (e) => {
        if (e.target === dom.modalOverlay) closeModal();
    });

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ─── INIT ────────────────────────────────────────────────
function init() {
    setupEventListeners();
    setupAuth();
}

init();
