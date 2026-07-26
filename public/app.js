// app.js — frontend logic
let TOKEN = localStorage.getItem('token') || '';
let currentCharacter = null;
let currentChat = null;
let characters = [];

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

// ── Screen router ─────────────────────────────────────────────────────────────
function showScreen(name) {
  ['characters', 'chats', 'chat'].forEach(n => {
    document.getElementById(`screen-${n}`).classList.toggle('hidden', n !== name);
  });
}

// ── Characters (screen 1) ────────────────────────────────────────────────────
async function loadCharacters() {
  characters = await (await api('/api/characters')).json();
  const el = document.getElementById('char-grid');
  el.innerHTML = '';
  if (!characters.length) {
    el.innerHTML = `
      <div class="empty-state big">
        <div class="empty-icon">🎭</div>
        <div class="empty-title">Belum ada karakter</div>
        <div class="empty-sub">Buat karakter dulu sebelum bisa mulai chat.</div>
        <button id="empty-new-char-btn" class="primary-btn">+ Buat karakter</button>
      </div>`;
    document.getElementById('empty-new-char-btn').onclick = () => openCharModal();
    return;
  }
  characters.forEach(c => {
    const div = document.createElement('div');
    div.className = 'char-card';
    div.innerHTML = `
      <button class="char-card-delete" title="Hapus karakter">🗑</button>
      ${avatarHtml(c, 'char-card-avatar')}
      <div class="char-card-name">${escapeHtml(c.name)}</div>
      <div class="char-card-sub">${escapeHtml(c.persona || 'Tanpa deskripsi').slice(0, 70)}</div>
    `;
    div.querySelector('.char-card-delete').onclick = (e) => { e.stopPropagation(); deleteCharacter(c); };
    div.onclick = () => selectCharacter(c);
    el.appendChild(div);
  });
}

async function deleteCharacter(c) {
  if (!confirm(`Hapus karakter “${c.name}”? Semua chat dan memorinya juga akan ikut hilang.`)) return;
  await api(`/api/characters/${c.id}`, { method: 'DELETE' });
  if (currentCharacter?.id === c.id) {
    currentCharacter = null;
    currentChat = null;
    showScreen('characters');
  }
  loadCharacters();
}

async function selectCharacter(c) {
  currentCharacter = c;
  currentChat = null;
  renderCharInfo('chats-char-info', c);
  showScreen('chats');
  await loadChats();
}

document.getElementById('back-to-chars-btn').onclick = () => {
  currentCharacter = null;
  currentChat = null;
  showScreen('characters');
  loadCharacters();
};

// ── Chats list (screen 2) ────────────────────────────────────────────────────
async function loadChats() {
  const chats = await (await api(`/api/characters/${currentCharacter.id}/chats`)).json();
  const el = document.getElementById('chat-list');
  el.innerHTML = '';
  if (!chats.length) {
    el.innerHTML = '<div class="empty-state">Belum ada chat. Klik “+ Chat baru” untuk mulai.</div>';
    return;
  }
  chats.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'item chat-row';
    div.innerHTML = `
      <div class="item-text">
        <div>${escapeHtml(ch.title || 'Obrolan baru')}</div>
        <div class="sub">${ch.message_count} pesan · ${formatDate(ch.updated_at)}</div>
      </div>
      <button class="icon-only ghost danger chat-delete-btn" title="Hapus chat ini">🗑</button>
    `;
    div.querySelector('.item-text').onclick = () => openChat(ch);
    div.querySelector('.chat-delete-btn').onclick = (e) => { e.stopPropagation(); deleteChat(ch); };
    el.appendChild(div);
  });
}

document.getElementById('new-chat-btn').onclick = async () => {
  if (!currentCharacter) return;
  const chat = await (await api('/api/chats', {
    method: 'POST', body: JSON.stringify({ characterId: currentCharacter.id }),
  })).json();
  openChat(chat);
};

async function deleteChat(chat) {
  if (!confirm(`Hapus “${chat.title || 'chat ini'}”? Tindakan ini tidak bisa dibatalkan.`)) return;
  await api(`/api/chats/${chat.id}`, { method: 'DELETE' });
  if (currentChat?.id === chat.id) {
    currentChat = null;
    showScreen('chats');
  }
  loadChats();
}

// ── Conversation (screen 3) ──────────────────────────────────────────────────
document.getElementById('back-to-chats-btn').onclick = () => {
  currentChat = null;
  showScreen('chats');
  loadChats();
};

async function openChat(chat) {
  currentChat = chat;
  renderCharInfo('chat-char-info', currentCharacter);
  showScreen('chat');
  const msgs = await (await api(`/api/chats/${chat.id}/messages`)).json();
  const box = document.getElementById('messages');
  box.innerHTML = '';
  msgs.forEach(m => addBubble(m.role, m.content, m.created_at));
  setComposerEnabled(true);
  scrollDown();
  document.getElementById('input').focus();
}

document.getElementById('delete-chat-btn').onclick = () => {
  if (!currentChat) return;
  deleteChat(currentChat);
};

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

  addBubble('user', text, new Date().toISOString());
  const bubble = addBubble('assistant', '', new Date().toISOString());   // empty bubble we fill as tokens arrive
  bubble.querySelector('.msg').classList.add('typing');

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
          bubble.querySelector('.content').innerHTML = renderMarkdown(acc);
          scrollDown();
        } else if (event === 'error') {
          bubble.querySelector('.content').innerHTML = renderMarkdown(acc || `⚠️ ${data.error}`);
        }
      }
    }
  } catch (err) {
    bubble.querySelector('.content').innerHTML = renderMarkdown(`⚠️ ${err.message}`);
  } finally {
    bubble.querySelector('.msg').classList.remove('typing');
    setComposerEnabled(true);
    input.focus();
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function addBubble(role, content, timestamp) {
  const box = document.getElementById('messages');
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const av = role === 'user'
    ? '<span class="avatar-fallback msg-avatar user-avatar">K</span>'
    : avatarHtml(currentCharacter, 'avatar msg-avatar');
  const name = role === 'user' ? 'Kamu' : (currentCharacter?.name || 'AI');
  const time = timestamp ? `<span class="msg-time">${formatTime(timestamp)}</span>` : '';
  row.innerHTML = `
    ${av}
    <div class="msg-bubble-wrap">
      <div class="msg-meta"><span class="who">${escapeHtml(name)}</span>${time}</div>
      <div class="msg ${role}"><div class="content"></div></div>
    </div>`;
  row.querySelector('.content').innerHTML = renderMarkdown(content);
  box.appendChild(row);
  scrollDown();
  return row;
}

// ── Lightweight markdown rendering (bold/italic/inline code/code blocks) ────
// Not a full CommonMark parser — just enough for typical AI chat replies.
function renderMarkdown(raw) {
  const text = raw || '';
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0, html = '', match;
  while ((match = codeBlockRegex.exec(text))) {
    const [full, lang, code] = match;
    html += renderInline(text.slice(lastIndex, match.index));
    html += `<div class="code-block">
      <div class="code-block-head">
        <span class="code-lang">${escapeHtml(lang || 'kode')}</span>
        <button type="button" class="copy-code-btn">Salin</button>
      </div>
      <pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>
    </div>`;
    lastIndex = match.index + full.length;
  }
  html += renderInline(text.slice(lastIndex));
  return html;
}

function renderInline(segment) {
  return escapeHtml(segment)
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\n]+?)__/g, '<strong>$1</strong>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
    .replace(/(?<![A-Za-z0-9_])_([^\n_]+?)_(?![A-Za-z0-9_])/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\n/g, '<br>');
}

// Copy-to-clipboard for code blocks (event delegation — survives re-renders).
document.getElementById('messages').addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-code-btn');
  if (!btn) return;
  const code = btn.closest('.code-block').querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Tersalin!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
  });
});

function renderCharInfo(elId, c) {
  document.getElementById(elId).innerHTML = c
    ? `${avatarHtml(c)}<span class="char-info-name">${escapeHtml(c.name)}</span>`
    : '';
}

// Renders a round avatar image, or a colored circle with the first letter if none.
function avatarHtml(char, cls = 'avatar') {
  if (char && char.avatar) return `<img class="${cls}" src="${char.avatar}" alt="" />`;
  const letter = escapeHtml((char?.name || '?').charAt(0).toUpperCase());
  return `<span class="avatar-fallback ${cls === 'avatar' ? '' : cls}">${letter}</span>`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function scrollDown() { const b = document.getElementById('messages'); b.scrollTop = b.scrollHeight; }
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Character editor ─────────────────────────────────────────────────────────
let charAvatarData = '';   // resized base64 data URL of the chosen avatar

document.getElementById('new-char-btn').onclick = () => openCharModal();
document.getElementById('char-cancel').onclick = () => document.getElementById('char-modal').classList.add('hidden');

document.getElementById('f-avatar').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  charAvatarData = await fileToResizedDataURL(file);
  document.getElementById('f-avatar-preview').src = charAvatarData;
};

document.getElementById('char-save').onclick = async () => {
  const body = {
    name: val('f-name'), gender: val('f-gender'), age: val('f-age'),
    persona: val('f-persona'), scenario: val('f-scenario'),
    first_message: val('f-first'), system_prompt: val('f-sys'),
    avatar: charAvatarData,
  };
  if (!body.name) return alert('Nama wajib diisi');
  await api('/api/characters', { method: 'POST', body: JSON.stringify(body) });
  document.getElementById('char-modal').classList.add('hidden');
  loadCharacters();
};

function openCharModal() {
  ['f-name', 'f-gender', 'f-age', 'f-persona', 'f-scenario', 'f-first', 'f-sys'].forEach(id => document.getElementById(id).value = '');
  charAvatarData = '';
  document.getElementById('f-avatar').value = '';
  document.getElementById('f-avatar-preview').removeAttribute('src');
  document.getElementById('char-modal').classList.remove('hidden');
}

// Read an image file and shrink it to a small JPEG data URL (keeps the DB light).
function fileToResizedDataURL(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        else if (height >= width && height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function val(id) { return document.getElementById(id).value.trim(); }

// ── Test connection ───────────────────────────────────────────────────────────
document.getElementById('test-btn').onclick = async () => {
  const s = document.getElementById('test-status');
  s.textContent = 'menguji…';
  try {
    const r = await (await api('/api/test-connection')).json();
    s.textContent = r.ok ? '✓ terhubung' : `✗ ${r.error}`;
  } catch (e) { s.textContent = '✗ ' + e.message; }
};

// ── Memory ────────────────────────────────────────────────────────────────────
let currentMemory = { facts: [], summaries: [] };

async function openMemory() {
  if (!currentCharacter) return;
  currentMemory = await (await api(`/api/characters/${currentCharacter.id}/memory`)).json();
  document.getElementById('memory-title').textContent = `${currentCharacter.name} — Memori`;
  renderMemory();
  document.getElementById('memory-modal').classList.remove('hidden');
}

function renderMemory() {
  const facts = document.getElementById('memory-facts');
  facts.innerHTML = '';
  if (!currentMemory.facts.length) facts.innerHTML = '<div class="muted small">Belum ada fakta.</div>';
  currentMemory.facts.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'mem-item';
    row.innerHTML = `<span>${escapeHtml(f)}</span>`;
    const del = document.createElement('button');
    del.textContent = '×'; del.title = 'Lupakan ini';
    del.onclick = () => deleteFact(i);
    row.appendChild(del);
    facts.appendChild(row);
  });

  const sums = document.getElementById('memory-summaries');
  sums.innerHTML = currentMemory.summaries.length
    ? currentMemory.summaries.map(s => `<div class="mem-item"><span>${escapeHtml(s)}</span></div>`).join('')
    : '<div class="muted small">Belum ada ringkasan. Gunakan tombol "Ringkas chat ini".</div>';
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
  if (!currentChat) return alert('Buka chat dulu.');
  const btn = document.getElementById('summarize-btn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await (await api(`/api/chats/${currentChat.id}/summarize`, { method: 'POST' })).json();
    if (r.ok) {
      currentMemory = r.memory;
      alert('Tersimpan ke memori:\n\n' + (r.summary || '(tidak ada ringkasan)'));
    } else {
      alert('Gagal: ' + r.error);
    }
  } catch (e) { alert('Gagal: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
};

init();
