const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class DocumentManager {
  constructor(ragClient) {
    this.ragClient = ragClient;
  }

  async processDocument(docId, filePath, docName) {
    // Step 1: Convert to markdown using Python MarkItDown
    const markdown = await this.convertToMarkdown(filePath);

    // Step 2: Split into overlapping chunks (paragraph-aware)
    const chunks = this.chunkText(markdown, 1000, 100);

    // Step 3: Store in SQLite FTS5
    if (this.ragClient) {
      await this.ragClient.insertChunks(docId, chunks, docName || path.basename(filePath));
    }

    // Step 4: Cleanup uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch { /* ignore */ }

    console.log(`Document ${docId} processed: ${chunks.length} chunks`);
    return chunks.length;
  }

  async convertToMarkdown(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // PDFs: use pdf-parse directly (no Python needed)
    if (ext === '.pdf') {
      try {
        const { PDFParse } = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        if (result.text && result.text.trim().length > 0) {
          return result.text.trim();
        }
      } catch (err) {
        console.error('[DOC] pdf-parse failed:', err.message);
      }
    }

    // Other formats: try Python MarkItDown
    try {
      const result = execSync(
        `python -m markitdown "${filePath}"`,
        { timeout: 30000, stdio: 'pipe', encoding: 'utf-8' }
      );
      return result.stdout || '';
    } catch (err) {
      console.error('MarkItDown conversion failed:', err.message);
      // Fallback: try reading as plain text
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch {
        return `[Could not convert file: ${path.basename(filePath)}]`;
      }
    }
  }

  chunkText(text, chunkSize, overlap) {
    if (!text || text.length === 0) return [];

    const chunks = [];
    // Split by double newlines first (paragraph boundaries)
    const paragraphs = text.split(/\n{2,}/);
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // If adding this paragraph exceeds chunk size, save current and start new
      if (currentChunk.length + trimmed.length + 2 > chunkSize && currentChunk.length > 0) {
        chunks.push({ text: currentChunk.trim() });
        // Keep overlap from end of current chunk
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + trimmed;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push({ text: currentChunk.trim() });
    }

    // If no chunks were created (single paragraph), force split by size
    if (chunks.length === 0 && text.length > 0) {
      let start = 0;
      while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push({ text: text.slice(start, end).trim() });
        start += chunkSize - overlap;
      }
    }

    return chunks;
  }
}

module.exports = DocumentManager;
