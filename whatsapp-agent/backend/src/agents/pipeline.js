const { cleanExtractedText } = require('./dataCleaner');
const { validateExtractedText } = require('./dataValidator');

function getDefaultSettings() {
  const db = require('../db');
  return db.getSettings() || { aiProvider: 'groq' };
}

async function runPipeline(rawText, fileType) {
  if (!rawText || !rawText.trim()) {
    return { cleanedText: '', validation: null, pipelineLog: [] };
  }

  const settings = getDefaultSettings();
  const log = [];
  const startTime = Date.now();

  // Agent 2: Clean the OCR text
  log.push('[PIPELINE] Agent 2 (Cleaner) starting...');
  const cleanerStart = Date.now();
  const cleanResult = await cleanExtractedText(rawText, fileType, settings);
  log.push(`[PIPELINE] Agent 2 done in ${Date.now() - cleanerStart}ms — cleaned=${cleanResult.cleaned}`);
  if (cleanResult.error) log.push(`[PIPELINE] Agent 2 error: ${cleanResult.error}`);

  const textForValidation = cleanResult.cleanedText || rawText;

  // Agent 3: Validate the cleaned text
  log.push('[PIPELINE] Agent 3 (Validator) starting...');
  const validatorStart = Date.now();
  const validation = await validateExtractedText(textForValidation, fileType, settings);
  log.push(`[PIPELINE] Agent 3 done in ${Date.now() - validatorStart}ms — isValid=${validation.isValid} confidence=${validation.confidence}`);
  if (validation.issues?.length) {
    log.push(`[PIPELINE] Agent 3 issues: ${validation.issues.join('; ')}`);
  }

  log.push(`[PIPELINE] Total: ${Date.now() - startTime}ms`);

  return {
    cleanedText: textForValidation,
    validation,
    pipelineLog: log
  };
}

module.exports = { runPipeline };
