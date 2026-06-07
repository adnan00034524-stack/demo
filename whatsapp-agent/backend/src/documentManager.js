const fs = require('fs');
const path = require('path');

class DocumentManager {
  constructor(ragClient) {
    this.ragClient = ragClient;
  }

  async processDocument(docId, filePath, docName, preExtractedText) {
    const text = preExtractedText || await this.extractText(filePath);

    // Split into overlapping chunks (paragraph-aware)
    const chunks = this.chunkText(text, 1000, 100);

    // Store in SQLite FTS5
    if (this.ragClient) {
      await this.ragClient.insertChunks(docId, chunks, docName || path.basename(filePath));
    }

    // Cleanup uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch { /* ignore */ }

    console.log(`Document ${docId} processed: ${chunks.length} chunks`);
    return chunks.length;
  }

  async extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let rawText;

    try {
      if (ext === '.pdf') {
        rawText = await this.extractPdfText(filePath);
      } else if (ext === '.docx') {
        rawText = await this.extractDocx(filePath);
      } else if (ext === '.xlsx') {
        rawText = await this.extractXlsx(filePath);
      } else if (ext === '.pptx' || ext === '.ppt') {
        rawText = await this.extractPptx(filePath);
      } else if (ext === '.txt' || ext === '.csv' || ext === '.json') {
        rawText = fs.readFileSync(filePath, 'utf-8').trim();
      } else if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.ppm', '.gif', '.tiff', '.tif'].includes(ext)) {
        rawText = await this.extractImageText(filePath);
      } else {
        // Unknown extension — try reading as plain text
        try {
          rawText = fs.readFileSync(filePath, 'utf-8').trim();
        } catch {
          rawText = `[Could not extract text from: ${path.basename(filePath)}]`;
        }
      }
    } catch (err) {
      console.error(`[DOC] extractText failed for ${ext}:`, err.message);
      rawText = `[Could not extract text from: ${path.basename(filePath)}]`;
    }

    // Run through cleanup and validation pipeline (Agent 2 + Agent 3)
    if (rawText && rawText.length > 5) {
      const { runPipeline } = require('./agents/pipeline');
      const result = await runPipeline(rawText, ext);
      if (result.pipelineLog?.length) {
        for (const line of result.pipelineLog) console.log(line);
      }
      return result.cleanedText || rawText;
    }
    return rawText || '';
  }

  async extractPdfText(filePath) {
    const { PDFParse } = require('pdf-parse');
    const Tesseract = require('tesseract.js');
    const { preprocessImage } = require('./imagePreprocessor');

    try {
      const buffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });

      // STEP 1: Direct text extraction (digital/text-based PDFs)
      try {
        const result = await parser.getText();
        if (result.text && result.text.trim().length > 10) {
          console.log(`[DOC] PDF direct text: ${result.text.trim().length} chars`);
          return result.text.trim();
        }
        console.log('[DOC] PDF direct text too short');
      } catch (directErr) {
        console.warn('[DOC] PDF direct extraction failed:', directErr.message);
      }

      // STEP 2: OCR fallback (scanned PDFs — render pages to images, then OCR)
      console.log('[DOC] Rendering pages for OCR...');
      let screenshots;
      try {
        screenshots = await parser.getScreenshot({
          imageBuffer: true,
          imageDataUrl: false,
          scale: 2.0,
        });
      } catch (screenshotErr) {
        console.error('[DOC] PDF screenshot failed:', screenshotErr.message);
        return '';
      }

      console.log(`[DOC] Got ${screenshots.pages.length} page(s)`);
      let ocrText = '';

      for (let i = 0; i < screenshots.pages.length; i++) {
        const page = screenshots.pages[i];
        console.log(`[DOC] OCR page ${i + 1}/${screenshots.pages.length}...`);

        let pageText = '';
        try {
          // Preprocess the screenshot for better OCR
          const pageBuffer = Buffer.from(page.data);
          const processedBuffer = await preprocessImage(pageBuffer);
          const source = processedBuffer || pageBuffer;

          // Try eng+urd first
          const { data: ocrData } = await Tesseract.recognize(source, 'eng+urd');
          pageText = (ocrData.text || '').trim();

          // Fallback to eng only if eng+urd returned nothing
          if (!pageText) {
            console.log(`[DOC] Page ${i + 1} eng+urd empty, trying eng only`);
            const { data: engData } = await Tesseract.recognize(source, 'eng');
            pageText = (engData.text || '').trim();
          }
        } catch (pageErr) {
          console.warn(`[DOC] Page ${i + 1} OCR failed:`, pageErr.message);
        }

        if (pageText.length > 0) {
          console.log(`[DOC] Page ${i + 1} OCR: ${pageText.length} chars`);
          ocrText += pageText + '\n\n';
        } else {
          console.log(`[DOC] Page ${i + 1} no text extracted`);
        }
      }

      const finalText = ocrText.trim();
      if (finalText) {
        console.log(`[DOC] PDF OCR total: ${finalText.length} chars`);
        return finalText;
      }
      console.log('[DOC] PDF OCR extracted no text');
      return '';
    } catch (err) {
      console.error('[DOC] extractPdfText failed:', err.message);
      return '';
    }
  }

  async extractImageText(filePath) {
    const Tesseract = require('tesseract.js');
    const { preprocessImage } = require('./imagePreprocessor');
    const processedBuffer = await preprocessImage(filePath);
    const source = processedBuffer || filePath;
    const { data } = await Tesseract.recognize(source, 'eng+urd', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[DOC-OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    return (data.text || '').trim();
  }

  async extractDocx(filePath) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  async extractXlsx(filePath) {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const rows = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (data.length > 0) {
        if (workbook.SheetNames.length > 1) rows.push(`--- Sheet: ${name} ---`);
        for (const row of data) {
          rows.push(row.filter(c => c != null).join('\t'));
        }
      }
    }
    return rows.join('\n');
  }

  async extractPptx(filePath) {
    const fs = require('fs');
    const JSZip = require('jszip');
    try {
      const data = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(data);
      const slideFiles = Object.keys(zip.files)
        .filter(f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
        .sort();
      if (slideFiles.length === 0) {
        return '[No slides found in PPTX]';
      }
      const textParts = [];
      for (const slideFile of slideFiles) {
        const content = await zip.files[slideFile].async('text');
        const textMatches = content.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
        const slideTexts = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
        if (slideTexts.length > 0) {
          if (slideFiles.length > 1) textParts.push(`--- Slide ${slideFiles.indexOf(slideFile) + 1} ---`);
          textParts.push(slideTexts.join(' '));
        }
      }
      const result = textParts.join('\n\n');
      console.log(`[DOC] PPTX extracted ${result.length} chars`);
      return result || '[Empty PPTX]';
    } catch (err) {
      console.error('[DOC] PPTX extraction failed:', err.message);
      return `[Could not extract text from PPTX]`;
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
