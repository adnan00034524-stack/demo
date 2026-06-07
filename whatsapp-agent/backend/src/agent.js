const db = require('./db');
const { generateResponse } = require('./providers/index');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { transcribeLocal } = require('./transcribeLocal');
const { runPipeline } = require('./agents/pipeline');
const { preprocessImage } = require('./imagePreprocessor');

async function handleIncomingMessage(msg) {
  const startTime = Date.now();

  const settings = db.getSettings();
  if (!settings || !settings.autoReplyEnabled) return;

  const chatId = msg.from;
  const senderName = msg._data?.notifyName || msg._data?.pushname || 'User';

  if (msg.hasMedia) {
    return handleMediaMessage(msg, chatId, senderName, settings);
  }

  let messageText = msg.body;
  if (!messageText || !messageText.trim()) return;

  console.log(`[CHAT] ${senderName} (${chatId}): "${messageText}"`);

  db.addMessage(chatId, { from: 'user', text: messageText, timestamp: new Date() });

  const reply = await generateAIReply(messageText, settings, chatId, senderName);
  if (!reply) return;

  await sendReply(chatId, reply, settings);
  db.addMessage(chatId, { from: 'agent', text: reply, timestamp: new Date() });

  const responseTime = Date.now() - startTime;
  updateAnalytics(responseTime);

  emitEvents(chatId, senderName, messageText, reply);
}

async function handleMediaMessage(msg, chatId, senderName, settings) {
  console.log(`[MEDIA] ${senderName} sent type=${msg.type} mime=${msg.mimetype || '?'}`);

  let media;
  try {
    media = await msg.downloadMedia();
  } catch (err) {
    console.error('[MEDIA] Download failed:', err.message);
    await sendReply(chatId, "I couldn't process your media. Please try again.", settings);
    return;
  }

  if (!media) {
    await sendReply(chatId, "I received your message but couldn't process the media.", settings);
    return;
  }

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Derive correct file extension
  const MIME_EXT_MAP = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/rtf': 'rtf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
  };
  // Clean mime: remove parameters like "; codecs=opus"
  const cleanMime = (media.mimetype || '').split(';')[0].trim().toLowerCase();
  let originalName = media.filename || `whatsapp_${Date.now()}_${chatId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  let ext = MIME_EXT_MAP[cleanMime];
  if (!ext) {
    // Fallback: try the subtype after '/'
    const subtype = cleanMime.split('/')[1];
    ext = subtype || 'bin';
  }
  // For documents with a real filename, preserve original extension
  if (msg.type === 'document' && media.filename) {
    const origExt = path.extname(media.filename).toLowerCase().replace(/^\./, '');
    if (origExt) ext = origExt;
  }
  const filenameSafe = `${Date.now()}_${chatId.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
  const filePath = path.join(uploadsDir, filenameSafe);
  fs.writeFileSync(filePath, media.data, 'base64');
  console.log(`[MEDIA] Saved: ${filenameSafe} (${media.mimetype}) origName=${originalName}`);

  let extractedText = '';
  let mediaLabel = '';

  // Voice message
  if (msg.type === 'ptt' || msg.type === 'audio') {
    mediaLabel = '[Voice]';
    extractedText = await transcribeAudio(filePath, media.mimetype, settings);
    if (extractedText) {
      console.log(`[STT] "${extractedText}"`);
      const result = await runPipeline(extractedText, 'audio');
      extractedText = result.cleanedText || extractedText;
      if (result.validation) console.log(`[STT] Validation: confidence=${result.validation.confidence}`);
    }
  }

  // Image → OCR
  else if (msg.type === 'image') {
    mediaLabel = '[Image]';
    extractedText = await ocrImage(filePath);
    if (extractedText) {
      console.log(`[OCR] "${extractedText}"`);
      const result = await runPipeline(extractedText, 'image');
      extractedText = result.cleanedText || extractedText;
      if (result.validation) console.log(`[OCR] Validation: confidence=${result.validation.confidence}`);
    } else {
      console.log('[OCR] No text extracted');
    }
  }

  // Video → skip (no transcription yet)
  else if (msg.type === 'video') {
    mediaLabel = '[Video]';
  }

  // Document / PDF / Office files → extract text
  else if (msg.type === 'document' || cleanMime === 'application/pdf') {
    mediaLabel = '[Document]';

    // Use DocumentManager for unified extraction (handles PDF, DOCX, XLSX, images, etc.)
    if (global.documentManager) {
      extractedText = await global.documentManager.extractText(filePath);
    } else {
      // Fallback to pdf-specific extraction if documentManager not available
      extractedText = await extractPdfText(filePath);
      if (extractedText) {
        const result = await runPipeline(extractedText, '.pdf');
        extractedText = result.cleanedText || extractedText;
        if (result.validation) console.log(`[PDF] Validation: confidence=${result.validation.confidence}`);
      }
    }

    // Index for RAG synchronously so AI gets the context
    if (extractedText && settings.ragEnabled && global.documentManager) {
      try {
        const { v4: uuid } = require('uuid');
        const docId = uuid();
        db.addDocument({
          id: docId, filename: filenameSafe, originalName,
          status: 'indexing', chunkCount: 0,
          createdAt: new Date().toISOString(),
        });
        const chunkCount = await global.documentManager.processDocument(docId, filePath, originalName, extractedText);
        db.updateDocument(docId, { status: 'ready', chunkCount });
        console.log(`[MEDIA] Document indexed: ${docId} (${chunkCount} chunks)`);
      } catch (err) {
        console.error('[MEDIA] Index failed:', err.message);
      }
    }

    if (extractedText) console.log(`[DOC] Extracted ${extractedText.length} chars`);
    else console.log('[DOC] No text extracted');
  }

  // Unknown media type
  else {
    mediaLabel = `[${msg.type || 'Media'}]`;
  }

  // User's caption/query (the text sent alongside the media)
  const userQuery = (msg.body || '').trim();

  // Store in DB: use a short preview, not the full extracted text
  const textForDb = extractedText
    ? `${mediaLabel} "${extractedText.substring(0, 200)}${extractedText.length > 200 ? '...' : ''}"`
    : `${mediaLabel} (no text extracted)`;

  db.addMessage(chatId, { from: 'user', text: textForDb, timestamp: new Date() });

  // If we got text, generate AI reply
  if (extractedText) {
    const isDocument = msg.type === 'document' || cleanMime === 'application/pdf';
    const reply = await generateAIReply(extractedText, settings, chatId, senderName, isDocument, userQuery);
    if (reply) {
      await sendReply(chatId, reply, settings);
      db.addMessage(chatId, { from: 'agent', text: reply, timestamp: new Date() });
      emitEvents(chatId, senderName, textForDb, reply);
      return;
    }
  }

  // Fallback if no text extracted
  const fallbackMap = {
    ptt: "I received your voice message but couldn't transcribe it.",
    audio: "I received your audio but couldn't transcribe it.",
    image: "I received your image but couldn't read the text in it.",
    document: "I received your document. Our team will review it.",
  };
  const fallback = fallbackMap[msg.type] || "I received your file. Our team will review it.";
  await sendReply(chatId, fallback, settings);
  db.addMessage(chatId, { from: 'agent', text: fallback, timestamp: new Date() });
  if (global.io) {
    global.io.emit('new-message', { chatId, senderName, text: userText, reply: fallback });
  }
}

async function transcribeAudio(filePath, mimetype, settings) {
  try {
    const text = await transcribeLocal(filePath);
    return text;
  } catch (err) {
    console.error('[STT] Local transcription failed:', err.message);
    return '';
  }
}

async function ocrImage(filePath) {
  // Preprocess image for better OCR accuracy (grayscale + contrast)
  const processedBuffer = await preprocessImage(filePath);
  const source = processedBuffer || filePath;

  try {
    const { data } = await Tesseract.recognize(source, 'eng+urd', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    if (data.text.trim()) return data.text.trim();
    console.log('[OCR] eng+urd gave empty result, trying eng only');
    const { data: engData } = await Tesseract.recognize(source, 'eng');
    return engData.text.trim();
  } catch (err) {
    console.error('[OCR] eng+urd failed:', err.message);
    try {
      const { data: engData } = await Tesseract.recognize(source, 'eng');
      return engData.text.trim();
    } catch (err2) {
      console.error('[OCR] eng fallback also failed:', err2.message);
      return '';
    }
  }
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  console.log(`[PDF] Processing: ${path.basename(filePath)} (${buffer.length} bytes)`);

  // STEP 1: Direct text extraction (digital/text-based PDFs)
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const fullText = (result.text || '').trim();
    console.log(`[PDF] getText() returned ${fullText.length} chars`);
    if (fullText.length > 10) {
      console.log(`[PDF] Direct text extracted (${fullText.length} chars)`);
      return fullText;
    }
    console.log('[PDF] Direct text too short, trying OCR...');
  } catch (err) {
    console.warn('[PDF] Direct extraction failed:', err.message);
  }

  // STEP 2: OCR fallback (scanned PDFs — render pages to images, then OCR)
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    console.log('[PDF] Rendering pages to images...');
    const screenshots = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      scale: 2.0,
    });

    console.log(`[PDF] Got ${screenshots.pages.length} page(s)`);
    let ocrText = '';
    for (let i = 0; i < screenshots.pages.length; i++) {
      const page = screenshots.pages[i];
      console.log(`[PDF] OCR page ${i + 1}/${screenshots.pages.length}...`);
      const pngBuf = Buffer.from(page.data);
      const { data: ocrData } = await Tesseract.recognize(pngBuf, 'eng+urd');
      const pageText = (ocrData.text || '').trim();
      console.log(`[PDF] Page ${i + 1} OCR: ${pageText.length} chars`);
      if (pageText) ocrText += pageText + '\n\n';
    }

    console.log(`[PDF] OCR total: ${ocrText.length} chars`);
    return ocrText.trim();
  } catch (err) {
    console.error('[PDF] OCR fallback failed:', err.message);
    console.error('[PDF] OCR stack:', err.stack?.substring(0, 300));
    return '';
  }
}

const MAX_DOC_TEXT_LENGTH = 4000; // characters — prevents token overflow

async function generateAIReply(messageText, settings, chatId, senderName, isDocument = false, userQuery = '') {
  const faqs = db.getFaqs();

  // --- System prompt (single string) ---
  const systemParts = [];

  systemParts.push(`You are an AI customer support agent named "${settings.agentName || 'Support Agent'}".

Personality & Rules:
- Be friendly, concise, and helpful
- NEVER say "I'm not sure" or "contact support" — always try to help
- If you don't have specific information, provide general guidance
- Keep replies short (2-4 sentences) suitable for WhatsApp`);

  systemParts.push(`\n## Agent Persona\n${settings.agentPersona}`);

  if (faqs.length > 0) {
    const faqContext = faqs.map(f =>
      `Q: ${f.question}\nA: ${f.answer}`
    ).join('\n\n');
    systemParts.push(`\n## FAQ Reference\n${faqContext}`);
  }

  if (settings.ragEnabled && global.ragClient) {
    try {
      const results = await global.ragClient.search(messageText, 5);
      if (results.length > 0) {
        systemParts.push(`\n## Knowledge Base Context\n${results.map(r => `- ${r}`).join('\n')}`);
      }
    } catch (err) {
      console.warn('RAG search error:', err.message);
    }
  }

  systemParts.push(`\n## CRITICAL INSTRUCTION
Identify the language the user wrote in above. You MUST reply in that EXACT same language.
Examples:
- User writes in Urdu → reply in Urdu (اردو)
- User writes in English → reply in English
- User writes mix → reply in the primary language used
Do NOT switch languages. Do NOT explain this rule.`);

  if (isDocument) {
    systemParts.push(`\n## Document Analysis Instructions
You are analyzing text extracted via OCR from a user-uploaded document.

FILE TYPE HANDLING:
- If the document appears to be tabular/grid data (rows, columns, numbers, financial figures): reconstruct the table structure to find counts, sums, balances, or specific row data accurately.
- If the document appears to be continuous text (paragraphs, clauses, headings): treat it as a formal document and look for contextual answers, specific clauses, or relevant sections.

RULES:
- Text may be in English, Urdu, or a mix. Respond in the same language the user uses.
- If OCR text is messy or has spelling mistakes, use semantic context to infer the original word. Do NOT complain about OCR quality.
- Keep response short, clear, formatted for WhatsApp (bold for headings, bullet points for lists, under 200 words).
- If the answer cannot be found in the provided text, politely state: "Maazrat, is document me is sawal ka jawab nahi mil saka."`);
  }

  const systemContent = systemParts.join('\n\n');

  // --- Conversation history (last 2 pairs, preview only) ---
  const chat = db.getChat(chatId);
  const history = (chat?.messages || []).slice(-8); // last 8 entries = ~4 pairs
  const historyMessages = [];
  for (const m of history) {
    const content = m.from === 'user' && isDocument
      ? m.text.substring(0, 100) + '... [document preview in history]'
      : m.text;
    if (m.from === 'user') {
      historyMessages.push({ role: 'user', content });
    } else if (m.from === 'agent') {
      historyMessages.push({ role: 'assistant', content: m.text });
    }
  }

  // --- Build final messages array ---
  let userMessage;
  if (isDocument) {
    // Truncate long document text to prevent token overflow
    const docText = messageText.length > MAX_DOC_TEXT_LENGTH
      ? messageText.substring(0, MAX_DOC_TEXT_LENGTH) + `\n\n...[truncated, ${messageText.length - MAX_DOC_TEXT_LENGTH} more chars]`
      : messageText;
    const query = userQuery || `${senderName} is asking about this document. Please analyze and respond.`;
    userMessage = `[FILE_TYPE]: Detected from the document content\n[OCR_TEXT]:\n${docText}\n[USER_QUERY]: ${query}`;
  } else {
    userMessage = `${senderName}: "${messageText}"`;
  }

  const messages = [
    { role: 'system', content: systemContent },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ];

  console.log(`[AI] Calling provider: ${settings.aiProvider} (${messages.length} msgs, userMsg=${messageText.length} chars)`);

  let reply;
  try {
    reply = await generateResponse(messages, settings);
    console.log(`[AI] Reply generated (${reply.length} chars)`);
  } catch (err) {
    console.error(`[AI] Provider failed:`, err.message);
    if (isDocument && messageText) {
      const reason = userQuery
        ? `Main ne document parh liya hai. ${userQuery}`
        : `Main ne document parh liya hai. Aap is document ke baare mein kya jaanna chahte hain?`;
      reply = reason;
    } else {
      reply = getFaqFallback(messageText, faqs);
    }
  }

  return reply;
}

async function sendReply(chatId, text, settings) {
  try {
    const whatsapp = require('./whatsapp');
    await whatsapp.sendMessage(chatId, text);
    console.log(`[CHAT] Reply sent to ${chatId}`);
  } catch (err) {
    console.error('Failed to send reply:', err.message);
  }
}

function updateAnalytics(responseTime) {
  const analytics = db.getAnalytics();
  db.updateAnalytics({
    totalMessages: analytics.totalMessages + 1,
    aiResponses: analytics.aiResponses + 1,
    avgResponseTimeMs: Math.round(
      (analytics.avgResponseTimeMs * analytics.totalMessages + responseTime) / (analytics.totalMessages + 1)
    ),
  });
}

function emitEvents(chatId, senderName, userText, reply) {
  if (global.io) {
    global.io.emit('new-message', { chatId, senderName, text: userText, reply });
    global.io.emit('analytics-update', db.getAnalytics());
  }
}

function getFaqFallback(text, faqs) {
  if (!faqs || faqs.length === 0) {
    return "I'll look into this and get back to you shortly!";
  }
  const lower = text.toLowerCase();
  for (const faq of faqs) {
    if (lower.includes(faq.question.toLowerCase().slice(0, 15))) {
      return faq.answer;
    }
  }
  return "I'll look into this and get back to you shortly!";
}

module.exports = { handleIncomingMessage };
