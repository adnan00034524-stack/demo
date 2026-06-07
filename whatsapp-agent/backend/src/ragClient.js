const db = require('./db');

class RagClient {
  constructor() {
    this.initialized = true;
  }

  async init() {
    console.log('RagClient (SQLite FTS5) initialized');
  }

  async insertChunks(docId, chunks, docName) {
    db.insertChunks(docId, chunks, docName);
    console.log(`[RAG] Inserted ${chunks.length} chunks for doc: ${docName || docId}`);
  }

  async search(query, limit = 5) {
    if (!query || !query.trim()) return [];
    return db.searchChunks(query, limit);
  }

  async deleteByDocId(docId) {
    db.deleteChunksByDocId(docId);
    console.log(`[RAG] Deleted chunks for doc: ${docId}`);
  }
}

module.exports = RagClient;
