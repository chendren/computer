import { Router } from 'express';
import { queryClaudeStreaming } from '../services/claude-bridge.js';

const router = Router();

const MAX_PROMPT_LENGTH = 100 * 1024; // 100KB
const MAX_SYSTEM_PROMPT_LENGTH = 50 * 1024; // 50KB

router.post('/query', (req, res) => {
  const { prompt, systemPrompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(413).json({ error: 'Prompt too large (max 100KB)' });
  }
  if (systemPrompt && (typeof systemPrompt !== 'string' || systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH)) {
    return res.status(413).json({ error: 'System prompt too large (max 50KB)' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  queryClaudeStreaming(
    prompt,
    systemPrompt,
    (chunk) => {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    },
    (code) => {
      res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
      res.end();
    }
  );

  req.on('close', () => {
    // Client disconnected — process will finish on its own
  });
});

export default router;
