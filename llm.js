// llm.js — talks to any OpenAI-compatible endpoint, with streaming + summarize
const estimateTokens = (text) => Math.ceil((text || '').length / 4);
// Reply language, configurable via .env (REPLY_LANGUAGE). Default: Indonesian.
// Special value "auto" (or "match") makes the character mirror the user's language.
function languageRule() {
  const lang = (process.env.REPLY_LANGUAGE || 'Indonesian').trim();
  if (/^(auto|match)$/i.test(lang)) {
    return 'Reply in the same language the user is writing in.';
  }
  return `Always write your replies in ${lang}, even if the user writes in another language. Keep proper nouns and quoted text as-is.`;
}

function buildSystemPrompt(char, memory = null) {
  const parts = [];
  const g = char.gender ? ` You are ${char.gender}.` : '';
  const a = char.age ? ` You are ${char.age} years old.` : '';
  parts.push(`You are ${char.name}.${g}${a} Stay in character at all times.`);
  if (char.persona)        parts.push(`\n## Personality & Description\n${char.persona}`);
  if (char.scenario)       parts.push(`\n## Current Scenario\n${char.scenario}`);
  if (char.system_prompt)  parts.push(`\n## Additional Instructions\n${char.system_prompt}`);
  if (memory && memory.facts && memory.facts.length) {
    parts.push(`\n## Things You Remember\n${memory.facts.map(f => `- ${f}`).join('\n')}`);
  }
  if (memory && memory.summaries && memory.summaries.length) {
    const recent = memory.summaries.slice(-3);
    parts.push(`\n## Story So Far (earlier conversations)\n${recent.map(s => `- ${s}`).join('\n')}`);
  }
  parts.push(
    `\n## Rules\n` +
    `- ${languageRule()}\n` +
    `- Only speak and act as ${char.name}. Never write the user's dialogue, actions, or thoughts.\n` +
    `- Do not mention being an AI or language model. Stay in character.\n`
  );
  return parts.join('\n');
}

function buildMessages(char, history, memory = null, tokenBudget = 6000) {
  const system = buildSystemPrompt(char, memory);
  let budget = tokenBudget - estimateTokens(system);
  const kept = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estimateTokens(history[i].content);
    if (budget - t < 0) break;
    budget -= t;
    kept.unshift({ role: history[i].role, content: history[i].content });
  }
  return [{ role: 'system', content: system }, ...kept];
}

function modelParams() {
  return {
    temperature: Number(process.env.TEMPERATURE ?? 0.8),
    top_p: Number(process.env.TOP_P ?? 0.9),
    top_k: Number(process.env.TOP_K ?? 40),
    max_tokens: Number(process.env.MAX_TOKENS ?? 800),
  };
}

function endpointAndAuth() {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (!base || base.includes('your-colab-url')) {
    throw new Error('BASE_URL belum dikonfigurasi. Atur di .env sesuai URL Colab/LiteLLM kamu.');
  }
  return {
    url: `${base}/v1/chat/completions`,
    apiKey: process.env.LLM_API_KEY || 'sk-colab-local',
    model: process.env.MODEL_NAME || 'character1',
  };
}

async function* streamChat(char, history, memory = null) {
  const { url, apiKey, model } = endpointAndAuth();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: true,
        messages: buildMessages(char, history, memory),
        ...modelParams(),
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${txt.slice(0, 200) || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {}
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function complete(messages, { maxTokens = 500 } = {}) {
  const { url, apiKey, model } = endpointAndAuth();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, stream: false, messages, temperature: 0.3, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function summarizeConversation(char, history) {
  const transcript = history
    .map(m => `${m.role === 'user' ? 'User' : char.name}: ${m.content}`)
    .join('\n');

  const prompt = [
    {
      role: 'system',
      content:
        'You compress roleplay conversations into memory. Respond with ONLY a JSON ' +
        'object, no prose, no markdown fences. Shape: ' +
        '{"summary": "2-4 sentence recap of what happened", ' +
        '"facts": ["short durable facts about the user or relationship worth remembering"]}. ' +
        'Keep facts concise and only include things that would matter in future chats. ' +
        `Write the summary and facts text in this language: ${(process.env.REPLY_LANGUAGE || 'Indonesian').trim()}.`
    },
    { role: 'user', content: `Conversation between the User and ${char.name}:\n\n${transcript}` },
  ];

  const raw = await complete(prompt, { maxTokens: 500 });
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : cleaned);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter(f => typeof f === 'string').map(f => f.trim()) : [],
    };
  } catch {
    return { summary: cleaned.slice(0, 400), facts: [] };
  }
}

module.exports = { streamChat, complete, summarizeConversation, buildSystemPrompt, buildMessages, estimateTokens };