async function generateOpenRouter(messages, settings) {
  const apiKey = settings.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost:5000',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: messages,
      temperature: settings.temperature || 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = { generateOpenRouter };
