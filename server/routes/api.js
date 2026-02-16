import { Router } from 'express';
import { transcripts, analyses, sessions, logs, monitors, comparisons } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';
import { notify, notifyAlert, notifyComplete } from '../services/notifications.js';
import * as gmail from '../services/gmail.js';
import * as gmailIntel from '../services/gmail-intelligence.js';

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
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
  clearTimeout(timeout);

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
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

  clearTimeout(timeout);
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

const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Extract main article content using common content selectors
function extractArticle(html, maxLen = 12000) {
  const lower = html.toLowerCase();

  // Try common article body selectors in order of specificity
  const selectors = [
    { open: '<article', close: '</article>' },
    { attr: 'class="article-body' },
    { attr: 'class="story-body' },
    { attr: 'class="entry-content' },
    { attr: 'class="post-content' },
    { attr: 'class="content-body' },
    { attr: 'data-testid="article-body' },
    { attr: 'itemprop="articleBody' },
    { open: '<main', close: '</main>' },
  ];

  for (const sel of selectors) {
    let startIdx = -1;
    let endIdx = -1;

    if (sel.open && sel.close) {
      startIdx = lower.indexOf(sel.open);
      if (startIdx !== -1) {
        endIdx = lower.indexOf(sel.close, startIdx);
        if (endIdx !== -1) endIdx += sel.close.length;
      }
    } else if (sel.attr) {
      startIdx = lower.indexOf(sel.attr);
      if (startIdx !== -1) {
        // Find the opening < for this tag
        let tagStart = startIdx;
        while (tagStart > 0 && html[tagStart] !== '<') tagStart--;
        startIdx = tagStart;
        // Find the tag name to know what closing tag to look for
        const tagNameEnd = html.indexOf(' ', tagStart + 1);
        const tagName = html.slice(tagStart + 1, tagNameEnd).toLowerCase();
        const closeTag = '</' + tagName + '>';
        // Find matching close — handle nesting by counting
        let depth = 1;
        let searchPos = html.indexOf('>', startIdx) + 1;
        const openTag = '<' + tagName;
        while (depth > 0 && searchPos < html.length) {
          const nextOpen = lower.indexOf(openTag, searchPos);
          const nextClose = lower.indexOf(closeTag, searchPos);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            searchPos = nextOpen + openTag.length;
          } else {
            depth--;
            if (depth === 0) {
              endIdx = nextClose + closeTag.length;
            }
            searchPos = nextClose + closeTag.length;
          }
        }
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      const articleHtml = html.slice(startIdx, endIdx);
      const text = extractText(articleHtml, maxLen);
      // Only use if we got meaningful content (more than nav cruft)
      if (text.length > 200) {
        return text;
      }
    }
  }

  return null; // No article found — caller should fall back to full extraction
}

function extractText(html, maxLen = 8000) {
  let clean = html;

  // Remove non-content blocks
  for (const tag of ['script', 'style', 'nav', 'footer']) {
    let idx;
    while ((idx = clean.toLowerCase().indexOf(`<${tag}`)) !== -1) {
      const end = clean.toLowerCase().indexOf(`</${tag}>`, idx);
      if (end === -1) break;
      clean = clean.slice(0, idx) + clean.slice(end + tag.length + 3);
    }
  }

  // Remove HTML comments
  let commentStart;
  while ((commentStart = clean.indexOf('<!--')) !== -1) {
    const commentEnd = clean.indexOf('-->', commentStart);
    if (commentEnd === -1) break;
    clean = clean.slice(0, commentStart) + clean.slice(commentEnd + 3);
  }

  // Convert table cells/rows
  clean = clean.split('</th>').join(' | ');
  clean = clean.split('</TH>').join(' | ');
  clean = clean.split('</td>').join(' | ');
  clean = clean.split('</TD>').join(' | ');
  clean = clean.split('</tr>').join('\n');
  clean = clean.split('</TR>').join('\n');

  // Block elements to newlines
  for (const tag of ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'hr']) {
    clean = clean.split(`</${tag}>`).join('\n');
    clean = clean.split(`</${tag.toUpperCase()}>`).join('\n');
  }
  clean = clean.split('<br>').join('\n');
  clean = clean.split('<BR>').join('\n');
  clean = clean.split('<br/>').join('\n');
  clean = clean.split('<br />').join('\n');

  // Strip remaining tags
  let result = '';
  let inTag = false;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '<') { inTag = true; continue; }
    if (clean[i] === '>') { inTag = false; result += ' '; continue; }
    if (!inTag) result += clean[i];
  }
  clean = result;

  // Decode HTML entities
  const entities = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
  for (const [entity, char] of Object.entries(entities)) {
    clean = clean.split(entity).join(char);
  }
  let entIdx;
  while ((entIdx = clean.indexOf('&')) !== -1) {
    const semi = clean.indexOf(';', entIdx);
    if (semi === -1 || semi - entIdx > 10) break;
    clean = clean.slice(0, entIdx) + ' ' + clean.slice(semi + 1);
  }

  // Collapse whitespace
  const lines = clean.split('\n').map(l => {
    let collapsed = '';
    let lastWasSpace = false;
    for (const ch of l) {
      if (ch === ' ' || ch === '\t') {
        if (!lastWasSpace) { collapsed += ' '; lastWasSpace = true; }
      } else {
        collapsed += ch; lastWasSpace = false;
      }
    }
    return collapsed.trim();
  }).filter(l => l.length > 0);

  return lines.join('\n').slice(0, maxLen);
}

// Escape string for use in HTML attribute
function escapeAttr(str) {
  return str.split('&').join('&amp;').split('"').join('&quot;').split('<').join('&lt;').split('>').join('&gt;');
}

// Strip <meta> tags that enforce frame-busting (X-Frame-Options, CSP frame-ancestors)
function stripMetaFrameHeaders(html) {
  // Find and remove <meta http-equiv="X-Frame-Options" ...>
  // and <meta http-equiv="Content-Security-Policy" ...> that contain frame-ancestors
  const lower = html.toLowerCase();
  let result = '';
  let i = 0;
  while (i < html.length) {
    const metaIdx = lower.indexOf('<meta', i);
    if (metaIdx === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, metaIdx);
    const closeIdx = html.indexOf('>', metaIdx);
    if (closeIdx === -1) {
      result += html.slice(metaIdx);
      break;
    }
    const tag = lower.slice(metaIdx, closeIdx + 1);
    // Check if this meta tag sets frame-busting headers
    const isFrameHeader = (tag.indexOf('x-frame-options') !== -1) ||
      (tag.indexOf('content-security-policy') !== -1 && tag.indexOf('frame-ancestors') !== -1);
    if (isFrameHeader) {
      // Skip this meta tag entirely
      i = closeIdx + 1;
    } else {
      result += html.slice(metaIdx, closeIdx + 1);
      i = closeIdx + 1;
    }
  }
  return result;
}

// Rewrite relative URLs in HTML to absolute so proxied pages render assets
function rewriteRelativeUrls(html, baseUrl) {
  // Parse base origin + path from the final URL
  let origin, basePath;
  try {
    const u = new URL(baseUrl);
    origin = u.origin;
    const lastSlash = u.pathname.lastIndexOf('/');
    basePath = u.pathname.slice(0, lastSlash + 1);
  } catch {
    return html;
  }

  // Attributes that contain URLs
  const attrs = ['src="', "src='", 'href="', "href='", 'action="', "action='"];
  let result = html;

  for (const attr of attrs) {
    const quote = attr[attr.length - 1];
    let searchFrom = 0;
    let output = '';

    while (searchFrom < result.length) {
      const idx = result.toLowerCase().indexOf(attr, searchFrom);
      if (idx === -1) {
        output += result.slice(searchFrom);
        break;
      }

      // Include everything up to and including the attribute opener
      const valStart = idx + attr.length;
      output += result.slice(searchFrom, valStart);

      // Find the closing quote
      const valEnd = result.indexOf(quote, valStart);
      if (valEnd === -1) {
        output += result.slice(valStart);
        searchFrom = result.length;
        break;
      }

      let val = result.slice(valStart, valEnd);

      // Rewrite relative URLs
      if (val.startsWith('//')) {
        // Protocol-relative — leave as-is
      } else if (val.startsWith('/')) {
        // Root-relative
        val = origin + val;
      } else if (!val.startsWith('http') && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('mailto:') && !val.startsWith('#') && val.length > 0) {
        // Relative path
        val = origin + basePath + val;
      }

      output += val;
      searchFrom = valEnd;
    }

    result = output;
  }

  return result;
}

// Extract embedded JSON data from script tags (SPAs, Next.js, etc.)
function extractEmbeddedData(html, maxLen = 10000) {
  const chunks = [];

  // Look for common SPA data patterns: __NEXT_DATA__, __NUXT__, window.__data, etc.
  const dataPatterns = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', 'window.__data', 'application/ld+json'];

  for (const pattern of dataPatterns) {
    let idx = html.indexOf(pattern);
    if (idx === -1) continue;

    // Find the JSON blob
    const braceStart = html.indexOf('{', idx);
    if (braceStart === -1 || braceStart - idx > 200) continue;

    // Find matching closing brace by counting
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < html.length && i < braceStart + 500000; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) continue;

    try {
      const obj = JSON.parse(html.slice(braceStart, end));
      // Extract readable text from the JSON
      const texts = extractTextsFromJson(obj, 0, 5);
      if (texts.length > 0) {
        chunks.push(...texts);
      }
    } catch {
      // Not valid JSON
    }
  }

  // Also extract og: meta tags for description/title
  const metaTags = ['og:description', 'og:title', 'description', 'twitter:description'];
  for (const tag of metaTags) {
    // Find content="..." for this meta tag
    const tagIdx = html.toLowerCase().indexOf(tag.toLowerCase());
    if (tagIdx === -1) continue;
    // Search backward and forward for the <meta> bounds
    const contentIdx = html.indexOf('content="', tagIdx - 200 > 0 ? tagIdx - 200 : 0);
    if (contentIdx === -1 || contentIdx > tagIdx + 200) {
      const contentIdx2 = html.indexOf('content="', tagIdx);
      if (contentIdx2 !== -1 && contentIdx2 < tagIdx + 200) {
        const valStart = contentIdx2 + 9;
        const valEnd = html.indexOf('"', valStart);
        if (valEnd !== -1) {
          const val = html.slice(valStart, valEnd).trim();
          if (val.length > 10) chunks.unshift(val);
        }
      }
    } else {
      const valStart = contentIdx + 9;
      const valEnd = html.indexOf('"', valStart);
      if (valEnd !== -1 && valEnd < tagIdx + 300) {
        const val = html.slice(valStart, valEnd).trim();
        if (val.length > 10) chunks.unshift(val);
      }
    }
  }

  const result = chunks.join('\n\n');
  return result.slice(0, maxLen);
}

// Recursively extract readable strings from a JSON object
function extractTextsFromJson(obj, depth, maxDepth) {
  if (depth > maxDepth) return [];
  const texts = [];

  if (typeof obj === 'string') {
    // Only include strings that look like readable text (not UUIDs, URLs, etc.)
    const trimmed = obj.trim();
    if (trimmed.length > 20 && trimmed.length < 2000 && !trimmed.startsWith('http') && !trimmed.startsWith('/') && trimmed.indexOf('{') === -1) {
      texts.push(trimmed);
    }
    return texts;
  }

  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 50)) {
      texts.push(...extractTextsFromJson(item, depth + 1, maxDepth));
      if (texts.length > 100) break;
    }
    return texts;
  }

  if (obj && typeof obj === 'object') {
    // Prioritize keys that likely contain content
    const priorityKeys = ['title', 'name', 'description', 'text', 'body', 'content', 'summary', 'headline', 'snippet', 'price', 'label'];
    const keys = Object.keys(obj);
    const sorted = keys.sort((a, b) => {
      const aP = priorityKeys.some(p => a.toLowerCase().indexOf(p) !== -1) ? 0 : 1;
      const bP = priorityKeys.some(p => b.toLowerCase().indexOf(p) !== -1) ? 0 : 1;
      return aP - bP;
    });

    for (const key of sorted.slice(0, 30)) {
      texts.push(...extractTextsFromJson(obj[key], depth + 1, maxDepth));
      if (texts.length > 100) break;
    }
  }

  return texts;
}

// Extract page title from HTML
function extractTitle(html) {
  const lower = html.toLowerCase();
  const titleStart = lower.indexOf('<title');
  if (titleStart === -1) return null;
  const tagEnd = html.indexOf('>', titleStart);
  if (tagEnd === -1) return null;
  const closeTag = lower.indexOf('</title>', tagEnd);
  if (closeTag === -1) return null;
  return html.slice(tagEnd + 1, closeTag).trim();
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
  const data = req.body;
  // Auto-generate stardate if not provided
  if (!data.stardate) {
    const now = new Date();
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const dayFraction = Math.floor((dayOfYear / 365) * 1000);
    data.stardate = `${year - 1924}.${String(dayFraction).padStart(1, '0')}`;
  }
  if (!data.timestamp) data.timestamp = new Date().toISOString();

  const item = await transcripts.save(data);
  broadcast('transcript', item);
  res.json(item);
});

// Captain's Log markup — extract Issues, Actions, Outcomes from log entry text
const MARKUP_PROMPT = `You are a starship log analyzer. Given a Captain's Log entry, extract any Issues, Actions, and Outcomes mentioned.

Return ONLY valid JSON matching this exact structure:
{
  "issues": ["brief issue description"],
  "actions": ["brief action description"],
  "outcomes": ["brief outcome description"]
}

Rules:
- Issues: problems, concerns, threats, anomalies, malfunctions, conflicts mentioned
- Actions: orders given, steps taken, decisions made, plans initiated
- Outcomes: results achieved, resolutions, status changes, completions
- Each item should be a concise phrase (5-15 words)
- Return empty arrays if none found for a category
- Return ONLY the JSON object, no other text`;

async function runMarkup(text) {
  const truncated = text.length > 2000 ? text.slice(0, 2000) : text;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model: VOICE_MODEL,
      messages: [
        { role: 'system', content: MARKUP_PROMPT },
        { role: 'user', content: truncated },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    }),
  });
  clearTimeout(timeout);

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
      try { parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch { parsed = {}; }
    } else {
      parsed = {};
    }
  }

  return {
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter(s => typeof s === 'string') : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions.filter(s => typeof s === 'string') : [],
    outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.filter(s => typeof s === 'string') : [],
  };
}

router.post('/transcripts/markup', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const markup = await runMarkup(text);
    res.json(markup);
  } catch (err) {
    console.error('[markup] LLM markup failed:', err.message);
    res.json({ issues: [], actions: [], outcomes: [] });
  }
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

  // Validate inputs for raw comparison requests
  if (data.textA !== undefined || data.textB !== undefined) {
    if (!data.textA || !data.textB || typeof data.textA !== 'string' || typeof data.textB !== 'string') {
      return res.status(400).json({ error: 'Both textA and textB are required and must be non-empty strings' });
    }
  }

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

// Browse — proxy endpoint for browser panel iframe
// GET returns raw HTML (proxied) for iframe rendering
// POST returns structured JSON with extracted text
router.get('/browse/proxy', async (req, res) => {
  // Remove restrictive security headers so proxied pages can load their own assets
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Cross-Origin-Resource-Policy');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; font-src * data:;");

  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL query parameter required');
  }

  let targetUrl = url;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fetchRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': WEB_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const contentType = fetchRes.headers.get('content-type') || '';
    const body = await fetchRes.text();

    if (contentType.includes('html') || contentType.includes('xml')) {
      // Rewrite relative URLs to absolute so assets load through the page's origin
      const baseUrl = fetchRes.url;
      const rewritten = rewriteRelativeUrls(body, baseUrl);

      // Inject <base> tag and link-intercept script so navigation stays in the proxy
      const token = req.query.token || '';
      const proxyScript = `
<script>
// Anti-frame-busting: must run BEFORE any site scripts
// Make the page think it is the top frame
try {
  Object.defineProperty(window, 'top', { get: function() { return window; } });
} catch(e) {}
try {
  Object.defineProperty(window, 'parent', { get: function() { return window; }, configurable: true });
} catch(e) {}
try {
  Object.defineProperty(window, 'frameElement', { get: function() { return null; } });
} catch(e) {}
// Override location-based frame busting
var _realParent = window.parent;
</script>
<script>
(function() {
  var proxyToken = '${token.split("'").join("\\'")}';
  function makeProxyUrl(href) {
    return '/api/browse/proxy?url=' + encodeURIComponent(href) + '&token=' + encodeURIComponent(proxyToken);
  }
  function notifyParent(href) {
    try { _realParent.postMessage({ type: 'browser-navigate', url: href }, '*'); } catch(ex) {}
  }
  // Intercept all link clicks — route through proxy
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;
    var rawHref = el.getAttribute('href') || '';
    if (!rawHref || rawHref.indexOf('javascript:') === 0) return;
    if (rawHref.charAt(0) === '#') return;
    var href = el.href;
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    window.location.href = makeProxyUrl(href);
    notifyParent(href);
  }, true);
  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    e.preventDefault();
  }, true);
  // Force all links with target=_blank to stay in proxy frame
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.querySelectorAll) {
          node.querySelectorAll('a[target="_blank"], a[target="_new"]').forEach(function(a) {
            a.removeAttribute('target');
          });
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[target="_blank"], a[target="_new"]').forEach(function(a) {
      a.removeAttribute('target');
    });
  });
  // Intercept window.open to keep navigation in proxy
  var origOpen = window.open;
  window.open = function(url) {
    if (url && url.indexOf('http') === 0) {
      window.location.href = makeProxyUrl(url);
      notifyParent(url);
      return null;
    }
    return origOpen.apply(window, arguments);
  };
})();
</script>`;

      let html = rewritten;

      // Strip <meta> tags that enforce frame restrictions
      html = stripMetaFrameHeaders(html);

      const basePlusScript = '\n<base href="' + escapeAttr(baseUrl) + '">' + proxyScript;

      if (html.toLowerCase().indexOf('<head') !== -1) {
        const headEnd = html.indexOf('>', html.toLowerCase().indexOf('<head'));
        if (headEnd !== -1) {
          html = html.slice(0, headEnd + 1) + basePlusScript + html.slice(headEnd + 1);
        }
      } else if (html.toLowerCase().indexOf('<html') !== -1) {
        const htmlEnd = html.indexOf('>', html.toLowerCase().indexOf('<html'));
        if (htmlEnd !== -1) {
          html = html.slice(0, htmlEnd + 1) + '\n<head>' + basePlusScript + '</head>' + html.slice(htmlEnd + 1);
        }
      } else {
        html = '<head>' + basePlusScript + '</head>' + html;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      // Non-HTML content — pass through as-is
      res.setHeader('Content-Type', contentType || 'text/plain');
      res.send(body);
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
    res.status(502).send('<html><body style="background:#0d0d20;color:#CC4444;font-family:monospace;padding:20px;">Error: ' + msg + '</body></html>');
  }
});

router.post('/browse', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  let targetUrl = url;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fetchRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': WEB_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const contentType = fetchRes.headers.get('content-type') || '';
    const rawText = await fetchRes.text();

    if (contentType.includes('json')) {
      res.json({
        url: fetchRes.url,
        status: fetchRes.status,
        title: null,
        content: rawText.slice(0, 8000),
        contentType: 'json',
      });
    } else {
      const title = extractTitle(rawText);

      // Try smart article extraction first, fall back to full page
      let content = extractArticle(rawText, 12000);
      let isArticle = !!content;
      if (!content) {
        content = extractText(rawText, 12000);
      }

      // If extracted text is thin (SPA/JS-heavy), try embedded data
      if (content.length < 1000) {
        const embedded = extractEmbeddedData(rawText, 10000);
        if (embedded.length > content.length) {
          content = (content ? content + '\n\n--- Embedded Data ---\n\n' : '') + embedded;
        }
      }

      // Extract meta content by finding the enclosing <meta> tag
      function extractMetaContent(html, attrMatch) {
        const lower = html.toLowerCase();
        const idx = lower.indexOf(attrMatch.toLowerCase());
        if (idx === -1) return '';
        // Find the <meta tag start
        let tagStart = idx;
        while (tagStart > 0 && html[tagStart] !== '<') tagStart--;
        // Find tag end
        const tagEnd = html.indexOf('>', tagStart);
        if (tagEnd === -1) return '';
        const tag = html.slice(tagStart, tagEnd + 1);
        // Find content="..." in this tag
        const contentIdx = tag.toLowerCase().indexOf('content="');
        if (contentIdx === -1) return '';
        const valStart = contentIdx + 9;
        const valEnd = tag.indexOf('"', valStart);
        if (valEnd === -1) return '';
        return tag.slice(valStart, valEnd)
          .split('&quot;').join('"').split('&amp;').join('&').split('&#x27;').join("'").split('&lt;').join('<').split('&gt;').join('>');
      }

      const description = extractMetaContent(rawText, 'name="description"');
      const image = extractMetaContent(rawText, 'property="og:image"');

      res.json({
        url: fetchRes.url,
        status: fetchRes.status,
        title,
        description,
        image,
        content,
        isArticle,
        contentType: 'html',
      });
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out (15s)' : err.message;
    res.status(502).json({ error: msg });
  }
});

// ── Gmail Integration ─────────────────────────────────

router.get('/gmail/status', async (req, res) => {
  try {
    const status = await gmail.getStatus();
    res.json(status);
  } catch (err) {
    res.json({ connected: false, hasCredentials: false, error: err.message });
  }
});

router.get('/gmail/auth/start', (req, res) => {
  if (!gmail.hasCredentials()) {
    return res.status(400).json({ error: 'No Google OAuth credentials found. Create data/google-oauth.json with clientId and clientSecret.' });
  }
  const url = gmail.getAuthUrl();
  if (!url) return res.status(500).json({ error: 'Failed to generate auth URL' });
  res.redirect(url);
});

router.get('/gmail/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<html><body style="background:#0d0d20;color:#CC4444;font-family:monospace;padding:40px;text-align:center">
      <h2>OAuth Error</h2><p>${error}</p>
      <script>setTimeout(()=>window.close(),3000)</script>
    </body></html>`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }
  try {
    const result = await gmail.handleCallback(code);
    res.send(`<html><body style="background:#0d0d20;color:#ff9900;font-family:monospace;padding:40px;text-align:center">
      <h2>Gmail Connected</h2>
      <p>${result.email ? 'Account: ' + result.email : 'Authorization complete.'}</p>
      <p>You can close this window.</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`);
  } catch (err) {
    res.send(`<html><body style="background:#0d0d20;color:#CC4444;font-family:monospace;padding:40px;text-align:center">
      <h2>Authorization Failed</h2><p>${err.message}</p>
      <script>setTimeout(()=>window.close(),5000)</script>
    </body></html>`);
  }
});

router.post('/gmail/auth/revoke', async (req, res) => {
  try {
    const result = await gmail.revoke();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gmail/inbox', async (req, res) => {
  try {
    const max = parseInt(req.query.max) || 20;
    const q = req.query.q || '';
    const result = await gmail.getInbox(max, q);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/messages/:id', async (req, res) => {
  try {
    const msg = await gmail.getMessage(req.params.id);
    res.json(msg);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/threads/:id', async (req, res) => {
  try {
    const thread = await gmail.getThread(req.params.id);
    res.json(thread);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/labels', async (req, res) => {
  try {
    const labels = await gmail.getLabels();
    res.json({ labels });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const max = parseInt(req.query.max) || 20;
    const result = await gmail.searchMessages(q, max);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/gmail/send', async (req, res) => {
  try {
    const result = await gmail.sendMessage(req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/gmail/messages/:id/read', async (req, res) => {
  try {
    const result = await gmail.markRead(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/gmail/messages/:id/unread', async (req, res) => {
  try {
    const result = await gmail.markUnread(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Gmail Intelligence endpoints

router.get('/gmail/summary', async (req, res) => {
  try {
    const inbox = await gmail.getInbox(30);
    const summary = await gmailIntel.summarizeInbox(inbox.messages);
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/priorities', async (req, res) => {
  try {
    const inbox = await gmail.getInbox(30);
    const prioritized = await gmailIntel.prioritizeMessages(inbox.messages);
    res.json({ messages: prioritized });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/followups', async (req, res) => {
  try {
    const inbox = await gmail.getInbox(40);
    const followups = await gmailIntel.detectFollowups(inbox.messages);
    res.json({ followups });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/gmail/threads/:id/summary', async (req, res) => {
  try {
    const thread = await gmail.getThread(req.params.id);
    const summary = await gmailIntel.summarizeThread(thread.messages);
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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
