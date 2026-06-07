const { generateResponse } = require('../providers/index');

async function cleanExtractedText(rawText, fileType, settings) {
  if (!rawText || rawText.length < 5) {
    return { cleanedText: rawText, cleaned: false, skipped: true };
  }

  const messages = [
    {
      role: 'system',
      content: `You are an OCR text cleaner. Your ONLY job is to fix OCR errors in the given text.

RULES:
- Fix common OCR errors (merged words, broken characters, wrong letters)
- Fix spacing issues and remove garbage characters
- Correct Urdu text where OCR has mangled characters:
  * Reconnect broken Urdu ligatures (e.g. "س لام" → "سلام")
  * Fix missing or wrong diacritics
  * Correct common Urdu OCR confusions: ک/گ, ڈ/د, ب/پ, ت/ط, س/ص, ہ/ح, etc.
  * Rejoin split words that OCR broke apart
- Preserve ALL numbers, dates, tables, and original data exactly
- NEVER add, remove, or rewrite information — only fix OCR artifacts
- NEVER change the meaning or wording — only fix what is clearly an OCR mistake
- If you cannot confidently fix a character, leave it as-is
- If the text has mixed English/Urdu, preserve both
- Return ONLY the cleaned text, no explanations, no prefixes, no comments`
    },
    {
      role: 'user',
      content: `Clean this ${fileType || 'document'} OCR output:\n\n${rawText}`
    }
  ];

  try {
    const cleaned = await generateResponse(messages, settings);
    const result = cleaned?.trim() || '';
    console.log(`[CLEANER] ${rawText.length} → ${result.length} chars`);
    return {
      cleanedText: result || rawText,
      cleaned: result !== rawText && result.length > 0,
      skipped: false
    };
  } catch (err) {
    console.error('[CLEANER] AI call failed:', err.message);
    return { cleanedText: rawText, cleaned: false, skipped: false, error: err.message };
  }
}

module.exports = { cleanExtractedText };
