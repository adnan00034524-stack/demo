const path = require('path');

// ChromaDB integration (lazy loaded — install chromadb npm package when needed)
class ChromaClient {
  constructor() {
    this.initialized = false;
    this.collection = null;
  }

  async init() {
    if (this.initialized) return;
    try {
      const { ChromaClient: Chroma } = await import('chromadb');
      const client = new Chroma({
        path: 'http://localhost:8000', // ChromaDB default
      });

      this.collection = await client.getOrCreateCollection({
        name: 'whatsagent_docs',
      });
      this.initialized = true;
      console.log('ChromaDB initialized');
    } catch (err) {
      console.warn('ChromaDB not available:', err.message);
      console.warn('Install chromadb and run: chroma run --path chromadb');
    }
  }

  async insertChunks(docId, chunks) {
    if (!this.collection) return;
    const ids = chunks.map((_, i) => `${docId}_chunk_${i}`);
    const metadatas = chunks.map(() => ({ docId }));
    const documents = chunks.map(c => c.text);

    await this.collection.add({
      ids,
      metadatas,
      documents,
    });
  }

  async search(query, nResults = 5) {
    if (!this.collection) return [];
    const results = await this.collection.query({
      queryTexts: [query],
      nResults,
    });
    return results.documents[0] || [];
  }

  async deleteByDocId(docId) {
    if (!this.collection) return;
    await this.collection.delete({
      where: { docId },
    });
  }
}

module.exports = ChromaClient;
