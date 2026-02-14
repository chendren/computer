const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'nomic-embed-text';
const VECTOR_DIM = 768;
const MAX_RETRIES = 2;
const RETRY_DELAY = 500;
const CONCURRENCY = 4;

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

/**
 * Embed a single text string via Ollama.
 * @param {string} text
 * @returns {Promise<number[]>} 768-dimensional embedding
 */
export async function embed(text) {
  const res = await fetchWithRetry(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  const data = await res.json();
  if (!data.embedding || data.embedding.length !== VECTOR_DIM) {
    throw new Error(`Unexpected embedding dimensions: ${data.embedding?.length}`);
  }
  return data.embedding;
}

/**
 * Embed multiple texts with a concurrency pool.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts) {
  const results = new Array(texts.length);
  let idx = 0;

  async function worker() {
    while (idx < texts.length) {
      const i = idx++;
      results[i] = await embed(texts[i]);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, texts.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Check if Ollama is running and has the embedding model.
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.models?.some(m => m.name?.startsWith(MODEL)) ?? false;
  } catch {
    return false;
  }
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export { VECTOR_DIM, MODEL };
