import { Router } from 'express';
import { queryClaudeStreaming } from '../services/claude-bridge.js';

const router = Router();

router.post('/query', (req, res) => {
  const { prompt, systemPrompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
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
