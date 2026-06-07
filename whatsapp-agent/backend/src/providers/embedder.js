// Pluggable embedding module
// Swap between:
//   - Gemini Embedding API
//   - ChromaDB built-in
//   - Ollama local model

async function getEmbedding(text) {
  // Placeholder — uses ChromaDB built-in for now
  // When using ChromaDB HTTP client, embeddings are handled server-side
  return text;
}

module.exports = { getEmbedding };
