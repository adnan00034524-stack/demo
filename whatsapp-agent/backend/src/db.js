const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    chatId TEXT PRIMARY KEY,
    senderName TEXT DEFAULT 'User',
    messages TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS analytics (
    totalMessages INTEGER DEFAULT 0,
    aiResponses INTEGER DEFAULT 0,
    humanEscalations INTEGER DEFAULT 0,
    avgResponseTimeMs INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT,
    originalName TEXT,
    status TEXT DEFAULT 'pending',
    chunkCount INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    doc_id, chunk_index, content, doc_name,
    tokenize='unicode61'
  );
`);

// Ensure analytics row exists
const analyticRow = db.prepare('SELECT rowid FROM analytics LIMIT 1').get();
if (!analyticRow) {
  db.prepare('INSERT INTO analytics DEFAULT VALUES').run();
}

// Ensure settings exist
const settingRow = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
if (!settingRow) {
  const defaults = {
    agentName: 'WhatsAgent AI',
    agentPersona: 'You are a friendly customer support agent.',
    geminiApiKey: '',
    groqApiKey: '',
    openrouterApiKey: '',
    aiProvider: 'groq',
    responseDelay: 1500,
    autoReplyEnabled: true,
    temperature: 0.7,
    ragEnabled: true,
  };
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(defaults));
}

function getSettings() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  if (!row) return null;
  const s = JSON.parse(row.value);
  // Ensure valid default provider
  if (!s.aiProvider || !['gemini', 'groq', 'openrouter'].includes(s.aiProvider)) {
    s.aiProvider = 'groq';
  }
  return s;
}

function saveSettings(data) {
  const current = getSettings() || {};
  const merged = { ...current, ...data };
  db.prepare("UPDATE meta SET value = ? WHERE key = 'settings'").run(JSON.stringify(merged));
  return merged;
}

function getFaqs() {
  return db.prepare('SELECT * FROM faqs ORDER BY id').all();
}

function saveFaqs(faqs) {
  const tx = db.transaction((items) => {
    db.prepare('DELETE FROM faqs').run();
    const insert = db.prepare('INSERT INTO faqs (question, answer) VALUES (?, ?)');
    for (const f of items) {
      insert.run(f.question || f.question, f.answer || f.answer);
    }
  });
  tx(faqs);
  return getFaqs();
}

function getChat(chatId) {
  const row = db.prepare('SELECT * FROM chats WHERE chatId = ?').get(chatId);
  if (!row) return null;
  return { chatId: row.chatId, senderName: row.senderName, messages: JSON.parse(row.messages) };
}

function saveChat(chat) {
  db.prepare(`
    INSERT INTO chats (chatId, senderName, messages) VALUES (?, ?, ?)
    ON CONFLICT(chatId) DO UPDATE SET senderName = excluded.senderName, messages = excluded.messages
  `).run(chat.chatId, chat.senderName || 'User', JSON.stringify(chat.messages || []));
}

function addMessage(chatId, message) {
  let chat = getChat(chatId);
  if (!chat) {
    chat = { chatId, senderName: 'User', messages: [] };
  }
  chat.messages.push(message);
  saveChat(chat);
}

function getAnalytics() {
  const row = db.prepare('SELECT * FROM analytics LIMIT 1').get();
  return row || { totalMessages: 0, aiResponses: 0, humanEscalations: 0, avgResponseTimeMs: 0 };
}

function updateAnalytics(data) {
  const current = getAnalytics();
  const merged = { ...current, ...data };
  db.prepare(`
    UPDATE analytics SET totalMessages = ?, aiResponses = ?, humanEscalations = ?, avgResponseTimeMs = ?
  `).run(merged.totalMessages, merged.aiResponses, merged.humanEscalations, merged.avgResponseTimeMs);
  return getAnalytics();
}

function getDocuments() {
  return db.prepare('SELECT * FROM documents ORDER BY createdAt DESC').all();
}

function getDocument(id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

function addDocument(doc) {
  db.prepare(`
    INSERT INTO documents (id, filename, originalName, status, chunkCount, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(doc.id, doc.filename, doc.originalName, doc.status || 'pending', doc.chunkCount || 0, doc.createdAt || new Date().toISOString());
  return doc;
}

function updateDocument(id, data) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(data)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return getDocument(id);
  vals.push(id);
  db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getDocument(id);
}

function deleteDocument(id) {
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
}

// FTS5 RAG functions
function insertChunks(docId, chunks, docName) {
  const insert = db.prepare('INSERT INTO documents_fts (doc_id, chunk_index, content, doc_name) VALUES (?, ?, ?, ?)');
  const tx = db.transaction((items) => {
    for (let i = 0; i < items.length; i++) {
      insert.run(docId, i, items[i].text, docName || '');
    }
  });
  tx(chunks);
}

function searchChunks(query, limit = 5) {
  try {
    const rows = db.prepare(`
      SELECT content, doc_name, rank
      FROM documents_fts
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
    return rows.map(r => r.content);
  } catch (err) {
    console.warn('FTS search error:', err.message);
    return [];
  }
}

function deleteChunksByDocId(docId) {
  db.prepare('DELETE FROM documents_fts WHERE doc_id = ?').run(docId);
}

module.exports = {
  getSettings, saveSettings,
  getFaqs, saveFaqs,
  getChat, saveChat, addMessage,
  getAnalytics, updateAnalytics,
  getDocuments, getDocument, addDocument, updateDocument, deleteDocument,
  insertChunks, searchChunks, deleteChunksByDocId,
};
