/**
 * Models service — queries Ollama for available local models.
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function listModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => ({
      id: m.name || m.model,
      name: m.name || m.model,
      provider: 'ollama',
      size: m.size,
      modified: m.modified_at,
      capabilities: _detectCapabilities(m.name || m.model || ''),
    }));
  } catch {
    return [];
  }
}

function _detectCapabilities(name) {
  const caps = ['chat'];
  const lower = name.toLowerCase();
  if (lower.indexOf('llava') !== -1 || lower.indexOf('vision') !== -1 ||
      lower.indexOf('llama4') !== -1 || lower.indexOf('minicpm') !== -1) {
    caps.push('vision');
  }
  if (lower.indexOf('embed') !== -1 || lower.indexOf('nomic') !== -1) {
    caps.push('embedding');
  }
  if (lower.indexOf('xlam') !== -1 || lower.indexOf('functionary') !== -1) {
    caps.push('function-calling');
  }
  return caps;
}
