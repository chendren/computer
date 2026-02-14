/**
 * LLM Bridge — routes queries to local Ollama (Qwen 2.5 7B).
 *
 * Replaces the previous Claude CLI bridge with local inference.
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const CHAT_MODEL = process.env.VOICE_MODEL || 'qwen2.5:7b-instruct-q4_K_M';

export function queryClaude(prompt, systemPrompt) {
  return queryOllama(prompt, systemPrompt);
}

export async function queryOllama(prompt, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export function queryClaudeStreaming(prompt, systemPrompt, onChunk, onDone) {
  queryOllamaStreaming(prompt, systemPrompt, onChunk, onDone);
}

async function queryOllamaStreaming(prompt, systemPrompt, onChunk, onDone) {
  try {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      onChunk(`Error: Ollama returned ${res.status}`);
      onDone(1);
      return;
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
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            onChunk(data.message.content);
          }
          if (data.done) {
            onDone(0);
            return;
          }
        } catch {}
      }
    }
    onDone(0);
  } catch (err) {
    onChunk(`Error: ${err.message}`);
    onDone(1);
  }
}
