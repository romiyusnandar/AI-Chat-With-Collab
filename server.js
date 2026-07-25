// server.js — Express API + static frontend
require('dotenv').config();
const path = require('path');
const os = require('os');
const express = require('express');
const { v4: uuid } = require('uuid');
const { Characters, Chats, Messages, Memory } = require('./db');
const { streamChat, summarizeConversation } = require('./llm');

const AUTO_SUMMARIZE_EVERY = 20;

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '10mb' }));

const APP_TOKEN = (process.env.APP_TOKEN || '').trim();
function auth(req, res, next) {
  if (!APP_TOKEN) return next();
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (token === APP_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized. Provide the access token.' });
}
app.get('/api/auth-required', (req, res) => res.json({ required: !!APP_TOKEN }));
app.use('/api', auth);

app.get('/api/characters', (req, res) => res.json(Characters.all()));
app.get('/api/characters/:id', (req, res) => {
  const c = Characters.get(req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/characters', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const char = Characters.create({
    id: uuid(),
    name: b.name, gender: b.gender || '', age: b.age || '', avatar: b.avatar || '',
    persona: b.persona || '', scenario: b.scenario || '',
    first_message: b.first_message || '', system_prompt: b.system_prompt || '',
  });
  res.status(201).json(char);
});
app.put('/api/characters/:id', (req, res) => {
  if (!Characters.get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json(Characters.update(req.params.id, req.body || {}));
});
app.delete('/api/characters/:id', (req, res) => {
  Characters.remove(req.params.id);
  res.json({ ok: true });
});

app.get('/api/characters/:id/chats', (req, res) => res.json(Chats.listByCharacter(req.params.id)));
app.post('/api/chats', (req, res) => {
  const { characterId } = req.body || {};
  const char = Characters.get(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const chat = Chats.create({ id: uuid(), character_id: characterId, title: 'New chat' });
  if (char.first_message) Messages.add(chat.id, 'assistant', char.first_message);
  res.status(201).json(chat);
});
app.get('/api/chats/:chatId/messages', (req, res) => {
  if (!Chats.get(req.params.chatId)) return res.status(404).json({ error: 'Chat not found' });
  res.json(Messages.listByChat(req.params.chatId));
});
app.delete('/api/chats/:chatId', (req, res) => {
  Chats.remove(req.params.chatId);
  res.json({ ok: true });
});

app.post('/api/chats/:chatId/send', async (req, res) => {
  const chat = Chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const char = Characters.get(chat.character_id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const userMessage = (req.body?.message || '').trim();
  if (!userMessage) return res.status(400).json({ error: 'message is required' });

  Messages.add(chat.id, 'user', userMessage);
  const history = Messages.listByChat(chat.id).map(m => ({ role: m.role, content: m.content }));
  const memory = Memory.get(char.id);

  if (history.filter(m => m.role === 'user').length === 1) {
    Chats.setTitle(chat.id, userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : ''));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let full = '';
  try {
    for await (const chunk of streamChat(char, history, memory)) {
      full += chunk;
      send('token', { t: chunk });
    }
    const messageId = Messages.add(chat.id, 'assistant', full || '(no response)');
    send('done', { messageId, content: full });

    const total = Messages.listByChat(chat.id).length;
    if (total > 0 && total % AUTO_SUMMARIZE_EVERY === 0) {
      summarizeIntoMemory(char, chat.id).catch(e => console.error('auto-summarize:', e.message));
    }
  } catch (err) {
    console.error('stream error:', err.message);
    if (full) Messages.add(chat.id, 'assistant', full);
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

async function summarizeIntoMemory(char, chatId) {
  const history = Messages.listByChat(chatId).map(m => ({ role: m.role, content: m.content }));
  if (history.length < 2) return { summary: '', facts: [] };

  const { summary, facts } = await summarizeConversation(char, history);
  const mem = Memory.get(char.id);
  if (summary) mem.summaries.push(summary);
  for (const f of facts) {
    if (f && !mem.facts.includes(f)) mem.facts.push(f);
  }
  mem.summaries = mem.summaries.slice(-10);
  mem.facts = mem.facts.slice(-40);
  Memory.save(char.id, mem);
  return { summary, facts };
}

app.get('/api/characters/:id/memory', (req, res) => {
  if (!Characters.get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json(Memory.get(req.params.id));
});
app.put('/api/characters/:id/memory', (req, res) => {
  if (!Characters.get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const facts = Array.isArray(req.body?.facts) ? req.body.facts : [];
  const summaries = Array.isArray(req.body?.summaries) ? req.body.summaries : [];
  res.json(Memory.save(req.params.id, { facts, summaries }));
});
app.post('/api/chats/:chatId/summarize', async (req, res) => {
  const chat = Chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const char = Characters.get(chat.character_id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  try {
    const result = await summarizeIntoMemory(char, chat.id);
    res.json({ ok: true, ...result, memory: Memory.get(char.id) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/test-connection', async (req, res) => {
  try {
    const gen = streamChat(
      { name: 'Test', persona: '', scenario: '', system_prompt: '' },
      [{ role: 'user', content: 'Say "ok".' }]
    );
    let out = '';
    for await (const c of gen) { out += c; if (out.length > 20) break; }
    res.json({ ok: true, sample: out.trim() });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function lanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AIChat Pro running:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const ips = lanIps();
  if (ips.length) ips.forEach(ip => console.log(`   Network: http://${ip}:${PORT}`));
  else console.log(`   Network: (no LAN IP found)`);
  console.log(`   Auth:    ${APP_TOKEN ? 'ON (token required)' : 'OFF (open — set APP_TOKEN in .env to enable)'}\n`);
});