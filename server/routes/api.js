import { Router } from 'express';
import { transcripts, analyses, sessions, logs, monitors, comparisons } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';
import { notify, notifyAlert, notifyComplete } from '../services/notifications.js';

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'llama4:scout';

const ANALYSIS_PROMPT = `You are a text analysis engine. Return ONLY valid JSON matching this exact structure:

{
  "summary": "2-3 sentence summary here",
  "sentiment": {
    "overall": "positive or negative or neutral or mixed",
    "confidence": 0.85,
    "breakdown": { "positive": 0.4, "negative": 0.3, "neutral": 0.3 }
  },
  "topics": [
    { "name": "Topic Name", "relevance": 0.9 }
  ],
  "entities": {
    "people": ["Person Name"],
    "organizations": ["Org Name"],
    "terms": ["key term"]
  },
  "actionItems": [
    { "text": "Action description", "priority": "high" }
  ]
}

IMPORTANT: The JSON has exactly 5 top-level keys: summary, sentiment, topics, entities, actionItems. They are siblings, NOT nested inside each other. Return ONLY the JSON object.`;

async function runAnalysis(text, title) {
  const truncated = text.length > 4000 ? text.slice(0, 4000) : text;
  const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VOICE_MODEL,
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: truncated },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });

  const json = await res.json();
  const raw = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '{}';

  // Parse JSON — strip code fences and find JSON object
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) cleaned = cleaned.slice(0, lastFence);
    cleaned = cleaned.trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from surrounding text
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        parsed = { summary: cleaned };
      }
    } else {
      parsed = { summary: cleaned };
    }
  }

  // Normalize sentiment — ensure it has the full expected structure
  let sentiment = parsed.sentiment || null;
  if (typeof sentiment === 'string') {
    sentiment = { overall: sentiment, confidence: 0.7 };
  }
  if (sentiment && !sentiment.breakdown) {
    // Generate breakdown from overall label
    const o = (sentiment.overall || 'neutral').toLowerCase();
    if (o === 'positive') sentiment.breakdown = { positive: 0.7, negative: 0.1, neutral: 0.2 };
    else if (o === 'negative') sentiment.breakdown = { positive: 0.1, negative: 0.7, neutral: 0.2 };
    else if (o === 'mixed') sentiment.breakdown = { positive: 0.4, negative: 0.35, neutral: 0.25 };
    else sentiment.breakdown = { positive: 0.15, negative: 0.15, neutral: 0.7 };
  }

  return {
    title: title || 'Analysis',
    input: text,
    timestamp: new Date().toISOString(),
    summary: parsed.summary || null,
    sentiment: sentiment,
    topics: (parsed.topics || []).map(t => typeof t === 'string' ? { name: t, relevance: 0.7 } : t),
    entities: (parsed.entities && !Array.isArray(parsed.entities)) ? parsed.entities : { people: [], organizations: [], terms: [] },
    actionItems: parsed.actionItems || [],
  };
}

const COMPARISON_PROMPT = `You are a comparison engine. Given two texts labeled A and B, compare them. Return ONLY valid JSON matching this exact structure:

{
  "verdict": "One sentence overall comparison verdict",
  "subjectA": { "name": "Name A", "summary": "1 sentence summary of A" },
  "subjectB": { "name": "Name B", "summary": "1 sentence summary of B" },
  "similarityScore": 0.5,
  "differences": [
    { "aspect": "Aspect name", "subjectA": "How A differs", "subjectB": "How B differs", "impact": "high", "winner": "A or B or tie" }
  ],
  "similarities": [
    { "aspect": "Shared aspect", "detail": "How they are similar" }
  ],
  "recommendation": "Which is better and why, or when to use each"
}

IMPORTANT: similarityScore is 0.0 to 1.0. impact is "high", "medium", or "low". Return ONLY the JSON object.`;

async function runComparison(textA, textB, nameA, nameB) {
  const truncA = textA.length > 2000 ? textA.slice(0, 2000) : textA;
  const truncB = textB.length > 2000 ? textB.slice(0, 2000) : textB;
  const userMsg = `Text A (${nameA || 'Subject A'}):\n${truncA}\n\nText B (${nameB || 'Subject B'}):\n${truncB}`;

  const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VOICE_MODEL,
      messages: [
        { role: 'system', content: COMPARISON_PROMPT },
        { role: 'user', content: userMsg },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 768,
      response_format: { type: 'json_object' },
    }),
  });

  const json = await res.json();
  const raw = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '{}';

  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) cleaned = cleaned.slice(0, lastFence);
    cleaned = cleaned.trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch { parsed = { verdict: cleaned }; }
    } else {
      parsed = { verdict: cleaned };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    verdict: parsed.verdict || null,
    subjectA: parsed.subjectA || { name: nameA || 'A', summary: '' },
    subjectB: parsed.subjectB || { name: nameB || 'B', summary: '' },
    similarityScore: parsed.similarityScore != null ? parsed.similarityScore : null,
    differences: parsed.differences || [],
    similarities: parsed.similarities || [],
    recommendation: parsed.recommendation || null,
  };
}

const router = Router();

// Transcripts
router.get('/transcripts', async (req, res) => {
  res.json(await transcripts.list());
});

router.get('/transcripts/:id', async (req, res) => {
  try {
    res.json(await transcripts.get(req.params.id));
  } catch {
    res.status(404).json({ error: 'Transcript not found' });
  }
});

router.post('/transcripts', async (req, res) => {
  const item = await transcripts.save(req.body);
  broadcast('transcript', item);
  res.json(item);
});

// Analyses
router.get('/analyses', async (req, res) => {
  res.json(await analyses.list());
});

router.post('/analysis', async (req, res) => {
  let data = req.body;

  // If raw text without structured analysis, run LLM analysis
  if (data.text && !data.summary && !data.sentiment) {
    try {
      data = await runAnalysis(data.text, data.title);
    } catch (err) {
      console.error('[analysis] LLM analysis failed:', err.message);
      // Fall through — save raw data
    }
  }

  const item = await analyses.save(data);
  broadcast('analysis', item);
  res.json(item);
});

// Charts
router.post('/charts', async (req, res) => {
  broadcast('chart', req.body);
  res.json({ status: 'broadcast' });
});

// Search results
router.post('/search-results', async (req, res) => {
  broadcast('search', req.body);
  res.json({ status: 'broadcast' });
});

// Sessions
router.get('/sessions', async (req, res) => {
  res.json(await sessions.list());
});

router.post('/sessions', async (req, res) => {
  const item = await sessions.save(req.body);
  res.json(item);
});

// Captain's Logs
router.get('/logs', async (req, res) => {
  res.json(await logs.list());
});

router.post('/logs', async (req, res) => {
  const data = req.body;
  // Auto-generate stardate if not provided (TNG-style: YYYYY.D based on year + day fraction)
  if (!data.stardate) {
    const now = new Date();
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const dayFraction = Math.floor((dayOfYear / 365) * 1000);
    data.stardate = `${year - 1924}.${String(dayFraction).padStart(1, '0')}`;
  }
  if (!data.timestamp) data.timestamp = new Date().toISOString();
  if (!data.category) data.category = 'personal';

  const item = await logs.save(data);
  broadcast('log', item);
  res.json(item);
});

// Monitors
router.get('/monitors', async (req, res) => {
  res.json(await monitors.list());
});

router.post('/monitors', async (req, res) => {
  const item = await monitors.save(req.body);
  broadcast('monitor', item);
  res.json(item);
});

// Comparisons
router.get('/comparisons', async (req, res) => {
  res.json(await comparisons.list());
});

router.post('/comparisons', async (req, res) => {
  let data = req.body;

  // If raw texts without structured comparison, run LLM comparison
  if (data.textA && data.textB && !data.verdict) {
    try {
      data = await runComparison(data.textA, data.textB, data.nameA, data.nameB);
    } catch (err) {
      console.error('[comparison] LLM comparison failed:', err.message);
    }
  }

  const item = await comparisons.save(data);
  broadcast('comparison', item);
  res.json(item);
});

// Notifications — wire into existing endpoints using Express middleware
router.use('/analysis', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    origJson(body);
    try { notifyComplete('Computer', `Analysis complete: ${req.body.title || 'New analysis'}`); } catch {}
  };
  next();
});

router.use('/monitors', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    origJson(body);
    try {
      const status = req.body.status || 'updated';
      if (status === 'alert' || status === 'triggered') {
        notifyAlert('Monitor Alert', `${req.body.name || 'Monitor'}: ${req.body.message || status}`);
      } else {
        notify('Monitor', `${req.body.name || 'Monitor'}: ${status}`);
      }
    } catch {}
  };
  next();
});

export default router;
