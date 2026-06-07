const { generateGemini } = require('./gemini');
const { generateGroq } = require('./groq');
const { generateOpenRouter } = require('./openrouter');

const PROVIDERS = {
  gemini: generateGemini,
  groq: generateGroq,
  openrouter: generateOpenRouter,
};

async function generateResponse(messages, settings) {
  const provider = settings.aiProvider || 'groq';
  const generateFn = PROVIDERS[provider];

  if (!generateFn) {
    throw new Error(`Unknown AI provider: ${provider}`);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await generateFn(messages, settings);
      console.log(`[PROVIDER] ${provider} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[PROVIDER] ${provider} attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[PROVIDER] Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error(`[PROVIDER] ${provider} exhausted all 3 attempts`);
  throw lastError;
}

module.exports = { generateResponse };
