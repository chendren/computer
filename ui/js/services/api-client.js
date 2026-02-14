export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async post(path, data) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async delete(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
    return res.json();
  }

  async uploadFile(path, file) {
    const form = new FormData();
    form.append('audio', file);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      body: form,
    });
    return res.json();
  }

  async queryClaudeStream(prompt, systemPrompt, onChunk) {
    const res = await fetch(`${this.baseUrl}/claude/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemPrompt }),
    });

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
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) return;
            if (data.text) onChunk(data.text);
          } catch {
            // skip malformed
          }
        }
      }
    }
  }
}
