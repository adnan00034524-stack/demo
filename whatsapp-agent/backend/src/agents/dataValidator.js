const { generateResponse } = require('../providers/index');

async function validateExtractedText(cleanedText, fileType, settings) {
  if (!cleanedText || cleanedText.length < 5) {
    return { isValid: false, confidence: 0, issues: ['Text is too short or empty'], summary: '' };
  }

  const messages = [
    {
      role: 'system',
      content: `You are a data validator for OCR-extracted text. Analyze the given text and return a JSON object ONLY (no other text).

Assess:
- Is the text meaningful (coherent sentences, structured data, recognizable content)?
- Are numbers, names, dates consistent and reasonable?
- Is there obvious truncation or corruption?
- Does the language match what's expected (English/Urdu/mixed)?

Return valid JSON with these fields:
{
  "isValid": true/false,
  "confidence": 0-100,
  "issues": ["array of problems found, or empty if none"],
  "summary": "one-line description of what the text contains"
}`
    },
    {
      role: 'user',
      content: `Validate this ${fileType || 'document'} text:\n\n${cleanedText}`
    }
  ];

  try {
    const result = await generateResponse(messages, settings);
    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch (parseErr) {
      console.warn('[VALIDATOR] Could not parse AI response as JSON, using fallback');
      parsed = {
        isValid: result.length > 20,
        confidence: Math.min(80, Math.round((result.length / (result.length + 50)) * 100)),
        issues: ['Validation response parsing failed, used heuristic fallback'],
        summary: result.substring(0, 150)
      };
    }

    console.log(`[VALIDATOR] isValid=${parsed.isValid} confidence=${parsed.confidence} issues=${(parsed.issues || []).length}`);
    return parsed;
  } catch (err) {
    console.error('[VALIDATOR] AI call failed:', err.message);
    return { isValid: true, confidence: 50, issues: [err.message], summary: 'Validation call failed, proceeding with raw data' };
  }
}

module.exports = { validateExtractedText };
