// db.js — SQLite data layer (replaces flat JSON files)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    gender        TEXT,
    age           TEXT,
    avatar        TEXT,
    persona       TEXT,
    scenario      TEXT,
    first_message TEXT,
    system_prompt TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id           TEXT PRIMARY KEY,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    title        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_char ON chats(character_id);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);

  CREATE TABLE IF NOT EXISTS memory (
    character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

const Characters = {
  all: () => db.prepare('SELECT * FROM characters ORDER BY name').all(),
  get: (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
  create(c) {
    const ts = now();
    db.prepare(`INSERT INTO characters
      (id, name, gender, age, avatar, persona, scenario, first_message, system_prompt, created_at, updated_at)
      VALUES (@id, @name, @gender, @age, @avatar, @persona, @scenario, @first_message, @system_prompt, @created_at, @updated_at)`
    ).run({ ...c, created_at: ts, updated_at: ts });
    return this.get(c.id);
  },
  update(id, c) {
    const ts = now();
    db.prepare(`UPDATE characters SET
      name=@name, gender=@gender, age=@age, avatar=@avatar, persona=@persona,
      scenario=@scenario, first_message=@first_message, system_prompt=@system_prompt, updated_at=@updated_at
      WHERE id=@id`
    ).run({ ...c, id, updated_at: ts });
    return this.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM characters WHERE id = ?').run(id),
};

const Chats = {
  listByCharacter: (characterId) => db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
    FROM chats c WHERE c.character_id = ? ORDER BY c.updated_at DESC
  `).all(characterId),
  get: (id) => db.prepare('SELECT * FROM chats WHERE id = ?').get(id),
  create(chat) {
    const ts = now();
    db.prepare(`INSERT INTO chats (id, character_id, title, created_at, updated_at)
      VALUES (@id, @character_id, @title, @created_at, @updated_at)`
    ).run({ ...chat, created_at: ts, updated_at: ts });
    return this.get(chat.id);
  },
  setTitle: (id, title) => db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id),
  touch: (id) => db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now(), id),
  remove: (id) => db.prepare('DELETE FROM chats WHERE id = ?').run(id),
};

const Messages = {
  listByChat: (chatId) => db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC').all(chatId),
  add(chatId, role, content) {
    const info = db.prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(chatId, role, content, now());
    Chats.touch(chatId);
    return info.lastInsertRowid;
  },
  updateContent: (id, content) => db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id),
  remove: (id) => db.prepare('DELETE FROM messages WHERE id = ?').run(id),
};

const EMPTY_MEMORY = { facts: [], summaries: [] };
const Memory = {
  get(characterId) {
    const row = db.prepare('SELECT data FROM memory WHERE character_id = ?').get(characterId);
    if (!row) return { ...EMPTY_MEMORY };
    try { return { ...EMPTY_MEMORY, ...JSON.parse(row.data) }; }
    catch { return { ...EMPTY_MEMORY }; }
  },
  save(characterId, obj) {
    db.prepare(`INSERT INTO memory (character_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(characterId, JSON.stringify(obj), now());
    return obj;
  },
};

module.exports = { db, Characters, Chats, Messages, Memory, now };