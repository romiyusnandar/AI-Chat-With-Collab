// app.js — frontend logic
let TOKEN = localStorage.getItem('token') || '';
let currentCharacter = null;
let currentChat = null;

// ── API helper (attaches auth token) ─────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { showLogin(true); throw new Error('unauthorized'); }
  return res;
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
async function init() {
  const { required } = await (await fetch('/api/auth-required')).json();
  if (required && !TOKEN) return showLogin();
  // Verify token works by loading characters.
  try {
    await loadCharacters();
    document.getElementById('app').classList.remove('hidden');
  } catch {
    if (required) showLogin();
  }
}
function showLogin(bad = false) {
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('token-error').classList.toggle('hidden', !bad);
}
document.getElementById('token-btn').onclick = async () => {
  TOKEN = document.getElementById('token-input').value.trim();
  localStorage.setItem('token', TOKEN);
  try {
    await loadCharacters();
    document.getElementById('login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  } catch { showLogin(true); }
};

// ── Characters ────────────────────────────────────────────────────────────────
async function loadCharacters() {
  const chars = await (await api('/api/characters')).json();
  const el = document.getElementById('char-list');
  el.innerHTML = '';
  chars.forEach(c => {
    const div = document.createElement('div');
    div.className = 'item' + (currentCharacter?.id === c.id ? ' active' : '');
    div.innerHTML = `<div>${escapeHtml(c.name)}</div><div class="sub">${escapeHtml(c.persona || '').slice(0, 48)}</div>`;
    div.onclick = () => selectCharacter(c);
    el.appendChild(div);
  });
}

async function selectCharacter(c) {
  currentCharacter = c; currentChat = null;
  document.getElementById('new-chat-btn').disabled = false;
  document.getElementById('chat-title').textContent = c.name;
  document.getElementById('header-actions').classList.remove('hidden');
  document.getElementById('messages').innerHTML = '';
  setComposerEnabled(false);
  await loadCharacters();
  await loadChats();
}

async function loadChats() {
  const chats = await (await api(`/api/characters/${currentCharacter.id}/chats`)).json();
  const el = document.getElementById('chat-list');
  el.innerHTML = '';
  chats.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'item' + (currentChat?.id === ch.id ? ' active' : '');
    div.innerHTML = `<div>${escapeHtml(ch.title || 'New chat')}</div><div class="sub">${ch.message_count} messages</div>`;
    div.onclick = () => openChat(ch);
    el.appendChild(div);
  });
}

// ── New chat / open chat ─────────────────────────────────────────────────────
document.getElementById('new-chat-btn').onclick = async () => {
  if (!currentCharacter) return;
  const chat = await (await api('/api/chats', {
    method: 'POST', body: JSON.stringify({ characterId: currentCharacter.id }),
  })).json();
  await loadChats();
  openChat(chat);
};

async function openChat(chat) {
  currentChat = chat;
  await loadChats();
  const msgs = await (await api(`/api/chats/${chat.id}/messages`)).json();
  const box = document.getElementById('messages');
  box.innerHTML = '';
  msgs.forEach(m => addBubble(m.role, m.content));
  setComposerEnabled(true);
  scrollDown();
}

function setComposerEnabled(on) {
  document.getElementById('input').disabled = !on;
  document.getElementById('send-btn').disabled = !on;
}

// ── Send with streaming (the important part) ─────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = '';
  setComposerEnabled(false);

  addBubble('user', text);
  const bubble = addBubble('assistant', '');   // empty bubble we fill as tokens arrive
  bubble.classList.add('typing');

  try {
    const res = await api(`/api/chats/${currentChat.id}/send`, {
      method: 'POST', body: JSON.stringify({ message: text }),
    });

    // Read the SSE stream chunk by chunk.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', acc = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const evMatch = part.match(/event: (\w+)/);
        const dataMatch = part.match(/data: (.+)/s);
        if (!evMatch || !dataMatch) continue;
        const event = evMatch[1];
        const data = JSON.parse(dataMatch[1]);
        if (event === 'token') {
          acc += data.t;
          bubble.querySelector('.content').textContent = acc;
          scrollDown();
        } else if (event === 'error') {
          bubble.querySelector('.content').textContent = acc || `⚠️ ${data.error}`;
        }
      }
    }
  } catch (err) {
    bubble.querySelector('.content').textContent = `⚠️ ${err.message}`;
  } finally {
    bubble.classList.remove('typing');
    setComposerEnabled(true);
    input.focus();
    loadChats();
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function addBubble(role, content) {
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="who">${role === 'user' ? 'You' : escapeHtml(currentCharacter?.name || 'AI')}</div><div class="content"></div>`;
  div.querySelector('.content').textContent = content;
  box.appendChild(div);
  scrollDown();
  return div;
}
function scrollDown() { const b = document.getElementById('messages'); b.scrollTop = b.scrollHeight; }
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Character editor ─────────────────────────────────────────────────────────
document.getElementById('new-char-btn').onclick = () => openCharModal();
document.getElementById('char-cancel').onclick = () => document.getElementById('char-modal').classList.add('hidden');
document.getElementById('char-save').onclick = async () => {
  const body = {
    name: val('f-name'), gender: val('f-gender'), age: val('f-age'),
    persona: val('f-persona'), scenario: val('f-scenario'),
    first_message: val('f-first'), system_prompt: val('f-sys'),
  };
  if (!body.name) return alert('Name is required');
  await api('/api/characters', { method: 'POST', body: JSON.stringify(body) });
  document.getElementById('char-modal').classList.add('hidden');
  loadCharacters();
};
function openCharModal() {
  ['f-name', 'f-gender', 'f-age', 'f-persona', 'f-scenario', 'f-first', 'f-sys'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('char-modal').classList.remove('hidden');
}
function val(id) { return document.getElementById(id).value.trim(); }

// ── Test connection ───────────────────────────────────────────────────────────
document.getElementById('test-btn').onclick = async () => {
  const s = document.getElementById('test-status');
  s.textContent = 'testing…';
  try {
    const r = await (await api('/api/test-connection')).json();
    s.textContent = r.ok ? '✓ connected' : `✗ ${r.error}`;
  } catch (e) { s.textContent = '✗ ' + e.message; }
};

// ── Memory ────────────────────────────────────────────────────────────────────
let currentMemory = { facts: [], summaries: [] };

async function openMemory() {
  if (!currentCharacter) return;
  currentMemory = await (await api(`/api/characters/${currentCharacter.id}/memory`)).json();
  document.getElementById('memory-title').textContent = `${currentCharacter.name} — Memory`;
  renderMemory();
  document.getElementById('memory-modal').classList.remove('hidden');
}

function renderMemory() {
  const facts = document.getElementById('memory-facts');
  facts.innerHTML = '';
  if (!currentMemory.facts.length) facts.innerHTML = '<div class="muted small">No facts yet.</div>';
  currentMemory.facts.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'mem-item';
    row.innerHTML = `<span>${escapeHtml(f)}</span>`;
    const del = document.createElement('button');
    del.textContent = '×'; del.title = 'Forget this';
    del.onclick = () => deleteFact(i);
    row.appendChild(del);
    facts.appendChild(row);
  });

  const sums = document.getElementById('memory-summaries');
  sums.innerHTML = currentMemory.summaries.length
    ? currentMemory.summaries.map(s => `<div class="mem-item"><span>${escapeHtml(s)}</span></div>`).join('')
    : '<div class="muted small">No summaries yet. Use "Remember this chat".</div>';
}

async function saveMemory() {
  currentMemory = await (await api(`/api/characters/${currentCharacter.id}/memory`, {
    method: 'PUT', body: JSON.stringify(currentMemory),
  })).json();
  renderMemory();
}

function deleteFact(i) { currentMemory.facts.splice(i, 1); saveMemory(); }

document.getElementById('add-fact-btn').onclick = () => {
  const inp = document.getElementById('new-fact');
  const v = inp.value.trim();
  if (!v) return;
  currentMemory.facts.push(v);
  inp.value = '';
  saveMemory();
};

document.getElementById('memory-btn').onclick = openMemory;
document.getElementById('memory-close').onclick = () =>
  document.getElementById('memory-modal').classList.add('hidden');

document.getElementById('summarize-btn').onclick = async () => {
  if (!currentChat) return alert('Open a chat first.');
  const btn = document.getElementById('summarize-btn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Summarizing…';
  try {
    const r = await (await api(`/api/chats/${currentChat.id}/summarize`, { method: 'POST' })).json();
    if (r.ok) {
      currentMemory = r.memory;
      alert('Saved to memory:\n\n' + (r.summary || '(no summary)'));
    } else {
      alert('Failed: ' + r.error);
    }
  } catch (e) { alert('Failed: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
};

init();
