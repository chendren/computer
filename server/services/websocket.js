/**
 * WebSocket Service — Real-time bidirectional communication hub.
 *
 * Responsibilities:
 *   1. Voice pipeline routing: binary audio → Voxtral STT (Computer mode)
 *      or bridge proxying for Moshi / Gemini / OpenAI / Nova Sonic modes
 *   2. Command processing: text commands → voice-assistant.js single-model pipeline
 *   3. Tool executor: 45+ tool case handlers mapping AI tool calls to internal APIs
 *   4. Smart chart executor: LLM-parsed intent → Yahoo Finance API (real historical
 *      prices) or web search → chart data
 *   5. Streaming TTS: sentence-level chunking for long responses (voice_audio_chunk)
 *   6. Sound effects: alert/reminder/timer/error SFX via play_sound broadcasts
 *   7. Timer and reminder audio: countdown broadcasting with completion alerts
 *   8. Ambient sound control: play/stop ambient audio presets
 *   9. Voice transcript logging: persists STT results for briefing and search
 *   10. Web scraping helpers: DuckDuckGo search + HTML page fetching
 */

import { transcribeChunk } from './transcription.js';
import { getSoundEffect } from './sound-effects.js';
import { getAuthToken } from '../middleware/auth.js';
import { processVoiceCommand, isVoiceAvailable, ensureVoiceChecked } from './voice-assistant.js';
import { createMoshiBridge, isMoshiRunning, KIND_AUDIO } from './moshi.js';
import { createGeminiBridge, isGeminiAvailable, KIND_GEMINI } from './gemini-live.js';
import { createOpenAIRealtimeBridge, isOpenAIRealtimeAvailable, KIND_OPENAI } from './openai-realtime.js';
import { createNovaSonicBridge, isNovaSonicAvailable, KIND_NOVA } from './nova-sonic.js';
import { execSync } from 'child_process';
import os from 'os';
import { captureScreen } from './node-local.js';
import { analyzeImage } from './vision.js';
import { listJobs, addJob, removeJob, toggleJob } from './cron-scheduler.js';
import * as calendar from './calendar.js';

const clients = new Set();
// Per-client state: { voiceMode: 'moshi'|'computer'|'gemini'|'openai'|'nova', bridges + text buffers }
const clientState = new Map();

// Limit concurrent Voxtral transcription to 1 at a time.
// Voxtral runs on Metal GPU — concurrent requests cause memory pressure.
// Extra chunks are queued (max 3) and processed sequentially.
let sttBusy = false;
const sttQueue = [];

/**
 * Process an audio chunk through Voxtral STT.
 *
 * Serialized: only one transcription at a time, excess chunks queued (max 3).
 * Older chunks are dropped if queue is full — recent speech matters more.
 *
 * @param {WebSocket} ws - Client WebSocket to send stt_result/stt_error back to
 * @param {Buffer} audioBuffer - Raw audio bytes (WAV, WebM, or other detected format)
 */
async function processChunk(ws, audioBuffer) {
  console.log(`[ws] processChunk: ${audioBuffer.length} bytes, sttBusy: ${sttBusy}, queue: ${sttQueue.length}`);
  if (sttBusy) {
    if (sttQueue.length < 3) {
      sttQueue.push({ ws, audioBuffer });
      console.log('[ws] Queued chunk (STT busy)');
    } else {
      console.log('[ws] Dropped chunk (queue full)');
    }
    return;
  }

  sttBusy = true;
  try {
    const format = detectAudioFormat(audioBuffer);
    console.log(`[ws] Transcribing chunk: format=${format}, size=${audioBuffer.length}`);
    const text = await transcribeChunk(audioBuffer, format);
    console.log(`[ws] Transcription result: "${text}"`);
    if (text && text.length > 0 && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'stt_result', data: { text } }));
      console.log(`[ws] Sent stt_result: "${text}"`);
    }
  } catch (err) {
    console.error(`[ws] Transcription error:`, err.message);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'stt_error', data: { error: err.message } }));
    }
  } finally {
    sttBusy = false;
    if (sttQueue.length > 0) {
      const next = sttQueue.shift();
      processChunk(next.ws, next.audioBuffer).catch(err => {
        console.error('[ws] Queued chunk processing error:', err.message);
      });
    }
  }
}

/**
 * Detect audio format from buffer header bytes (magic number detection).
 */
function detectAudioFormat(buffer) {
  if (buffer.length < 4) return 'webm';
  // WAV: "RIFF"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'wav';
  // WebM/MKV: 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'webm';
  // MP3: 0xFF 0xFB or 0xFF 0xF3 or 0xFF 0xF2 or ID3
  if ((buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) ||
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)) return 'mp3';
  // FLAC: "fLaC"
  if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) return 'flac';
  // OGG: "OggS"
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'ogg';
  return 'webm'; // Default fallback
}

// ── Web search & fetch helpers ────────────────────────────

const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extract readable plain text from raw HTML.
 *
 * Uses only string operations (indexOf, split, slice) — no regex. This avoids
 * the hookify no-regex rule and also avoids ReDoS vulnerabilities from complex patterns.
 *
 * Steps:
 *   1. Remove non-content blocks: <script>, <style>, <nav>, <footer>
 *   2. Strip HTML comments
 *   3. Convert table markup (</th>, </td>, </tr>) to readable text separators
 *   4. Convert block elements (<p>, <div>, headings, <li>) to newlines
 *   5. Remove all remaining HTML tags character-by-character
 *   6. Decode common HTML entities (&amp;, &lt;, etc.)
 *   7. Collapse whitespace runs and empty lines
 *
 * @param {string} html - Raw HTML from a fetched web page
 * @param {number} maxLen - Maximum characters to return (default 8000)
 * @returns {string} Cleaned plain text
 */
function _extractText(html, maxLen = 8000) {
  // Use only string methods — no regex per project convention
  let clean = html;

  // Remove non-content blocks by finding start/end tags
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

  // Convert table cells and rows to readable text
  clean = clean.split('</th>').join(' | ');
  clean = clean.split('</TH>').join(' | ');
  clean = clean.split('</td>').join(' | ');
  clean = clean.split('</TD>').join(' | ');
  clean = clean.split('</tr>').join('\n');
  clean = clean.split('</TR>').join('\n');

  // Convert block elements to newlines
  for (const tag of ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'hr']) {
    clean = clean.split(`</${tag}>`).join('\n');
    clean = clean.split(`</${tag.toUpperCase()}>`).join('\n');
  }
  clean = clean.split('<br>').join('\n');
  clean = clean.split('<BR>').join('\n');
  clean = clean.split('<br/>').join('\n');
  clean = clean.split('<br />').join('\n');

  // Strip remaining HTML tags using iterative parsing
  let result = '';
  let inTag = false;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '<') { inTag = true; continue; }
    if (clean[i] === '>') { inTag = false; result += ' '; continue; }
    if (!inTag) result += clean[i];
  }
  clean = result;

  // Decode common HTML entities
  const entities = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
  for (const [entity, char] of Object.entries(entities)) {
    clean = clean.split(entity).join(char);
  }
  // Strip remaining entities (&#xxx; and &word;)
  let entIdx;
  while ((entIdx = clean.indexOf('&')) !== -1) {
    const semi = clean.indexOf(';', entIdx);
    if (semi === -1 || semi - entIdx > 10) break;
    clean = clean.slice(0, entIdx) + ' ' + clean.slice(semi + 1);
  }

  // Collapse whitespace — replace runs of spaces/tabs with single space
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

async function _fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': WEB_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8' },
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function _webFetch(url) {
  const res = await _fetchWithTimeout(url);
  const text = await res.text();
  if (res.headers.get('content-type')?.includes('json')) {
    return { url, status: res.status, content: text.slice(0, 8000) };
  }
  return { url, status: res.status, content: _extractText(text) };
}

async function _webSearch(query) {
  // 1. Try DuckDuckGo Instant Answers API first (returns structured data for factual queries)
  let instantAnswer = null;
  try {
    const iaRes = await _fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, 5000);
    const ia = await iaRes.json();
    if (ia.Abstract) {
      instantAnswer = ia.Abstract;
    } else if (ia.Answer) {
      instantAnswer = ia.Answer;
    } else if (ia.Infobox?.content?.length > 0) {
      instantAnswer = ia.Infobox.content.map(c => `${c.label}: ${c.value}`).join(', ');
    }
  } catch {}

  // 2. HTML search for full results with URLs
  const encoded = encodeURIComponent(query);
  const res = await _fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encoded}`);
  const html = await res.text();

  const results = [];
  // Extract DuckDuckGo result blocks using string parsing — no regex
  const _stripTags = (s) => { let out = '', inTag = false; for (const c of s) { if (c === '<') inTag = true; else if (c === '>') inTag = false; else if (!inTag) out += c; } return out.trim(); };
  let searchPos = 0;
  const linkClass = 'class="result__a"';
  const snippetClass = 'class="result__snippet"';
  while (results.length < 8) {
    const linkIdx = html.indexOf(linkClass, searchPos);
    if (linkIdx === -1) break;
    // Find the opening <a tag start
    const aStart = html.lastIndexOf('<a', linkIdx);
    if (aStart === -1) { searchPos = linkIdx + 1; continue; }
    // Extract href
    const hrefStart = html.indexOf('href="', aStart);
    if (hrefStart === -1 || hrefStart > linkIdx + 200) { searchPos = linkIdx + 1; continue; }
    const hrefValStart = hrefStart + 6;
    const hrefEnd = html.indexOf('"', hrefValStart);
    let href = html.slice(hrefValStart, hrefEnd);
    // DuckDuckGo redirect — extract actual URL from uddg= param
    const uddgIdx = href.indexOf('uddg=');
    if (uddgIdx !== -1) {
      const ampIdx = href.indexOf('&', uddgIdx + 5);
      href = decodeURIComponent(ampIdx === -1 ? href.slice(uddgIdx + 5) : href.slice(uddgIdx + 5, ampIdx));
    }
    // Extract title (content between > and </a>)
    const titleStart = html.indexOf('>', linkIdx);
    const titleEnd = html.indexOf('</a>', titleStart);
    const title = _stripTags(html.slice(titleStart + 1, titleEnd));
    // Find snippet
    const snippetIdx = html.indexOf(snippetClass, titleEnd);
    if (snippetIdx === -1 || snippetIdx > titleEnd + 2000) { searchPos = titleEnd + 1; continue; }
    const snipStart = html.indexOf('>', snippetIdx);
    const snipEnd = html.indexOf('</a>', snipStart);
    const snippet = _stripTags(html.slice(snipStart + 1, snipEnd));
    if (title && snippet) results.push({ title, url: href, snippet });
    searchPos = (snipEnd !== -1 ? snipEnd : snippetIdx) + 1;
  }

  if (results.length === 0) {
    let clean = _extractText(html, 4000);
    return { query, instantAnswer, results: [], rawText: clean };
  }
  return { query, instantAnswer, results };
}

async function _webSearchAndRead(query, numResults = 3) {
  const searchResult = await _webSearch(query);
  const urls = (searchResult.results || []).slice(0, numResults);

  // Fetch top results in parallel
  const fetched = await Promise.allSettled(
    urls.map(async (r) => {
      try {
        const page = await _webFetch(r.url);
        return { url: r.url, title: r.title, content: page.content?.slice(0, 3000) || '' };
      } catch (err) {
        return { url: r.url, title: r.title, error: err.message };
      }
    })
  );

  const pages = fetched
    .filter(f => f.status === 'fulfilled')
    .map(f => f.value);

  // Augment results with live spot prices from Swissquote's free forex feed.
  // Swissquote publishes real-time bid/ask for metals (XAU, XAG, XPT, XPD) as JSON
  // without authentication. The mid-price ((bid+ask)/2) is accurate to the penny.
  // This supplements the DuckDuckGo results which may have stale or estimated prices.
  const metalMap = { gold: 'XAU', silver: 'XAG', platinum: 'XPT', palladium: 'XPD' };
  for (const [keyword, symbol] of Object.entries(metalMap)) {
    if (query.toLowerCase().includes(keyword)) {
      try {
        const res = await _fetchWithTimeout(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${symbol}/USD`, 5000);
        const data = await res.json();
        const price = data[0]?.spreadProfilePrices?.[0];
        if (price) {
          const mid = ((price.bid + price.ask) / 2).toFixed(2);
          pages.push({
            url: 'swissquote.com/live-feed',
            title: `${keyword} spot price`,
            content: `Live ${keyword} spot price: $${mid} USD per troy ounce (bid: $${price.bid}, ask: $${price.ask})`,
          });
          console.log(`[web] Swissquote ${symbol}/USD: $${mid}`);
        }
      } catch (err) {
        console.warn(`[web] Swissquote ${symbol} failed: ${err.message}`);
      }
    }
  }

  return {
    query,
    instantAnswer: searchResult.instantAnswer,
    searchResults: searchResult.results?.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) || [],
    pages,
  };
}

// ── Smart Chart Executor ──────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'llama3.1:8b';

const METAL_SYMBOLS = { gold: 'XAU', silver: 'XAG', platinum: 'XPT', palladium: 'XPD' };
const TICKER_MAP = {
  amazon: 'AMZN:NASDAQ', amzn: 'AMZN:NASDAQ',
  apple: 'AAPL:NASDAQ', aapl: 'AAPL:NASDAQ',
  google: 'GOOGL:NASDAQ', googl: 'GOOGL:NASDAQ', alphabet: 'GOOGL:NASDAQ',
  microsoft: 'MSFT:NASDAQ', msft: 'MSFT:NASDAQ',
  tesla: 'TSLA:NASDAQ', tsla: 'TSLA:NASDAQ',
  nvidia: 'NVDA:NASDAQ', nvda: 'NVDA:NASDAQ',
  meta: 'META:NASDAQ', amd: 'AMD:NASDAQ',
  netflix: 'NFLX:NASDAQ', nflx: 'NFLX:NASDAQ',
  bitcoin: 'BTC-USD', btc: 'BTC-USD',
  ethereum: 'ETH-USD', eth: 'ETH-USD',
  dogecoin: 'DOGE-USD', doge: 'DOGE-USD',
  solana: 'SOL-USD', sol: 'SOL-USD',
};

// Yahoo Finance symbols — used for historical price data
const YAHOO_SYMBOLS = {
  gold: 'GC=F', silver: 'SI=F', platinum: 'PL=F', palladium: 'PA=F',
  amazon: 'AMZN', amzn: 'AMZN', apple: 'AAPL', aapl: 'AAPL',
  google: 'GOOGL', googl: 'GOOGL', alphabet: 'GOOGL',
  microsoft: 'MSFT', msft: 'MSFT', tesla: 'TSLA', tsla: 'TSLA',
  nvidia: 'NVDA', nvda: 'NVDA', meta: 'META', amd: 'AMD',
  netflix: 'NFLX', nflx: 'NFLX',
  bitcoin: 'BTC-USD', btc: 'BTC-USD', ethereum: 'ETH-USD', eth: 'ETH-USD',
  dogecoin: 'DOGE-USD', doge: 'DOGE-USD', solana: 'SOL-USD', sol: 'SOL-USD',
};

/**
 * Resolve a Yahoo Finance symbol from an asset name.
 * Checks both exact matches and partial matches (e.g. "silver spot price" → "SI=F").
 */
function _resolveYahooSymbol(assetName) {
  const key = assetName.toLowerCase().trim();
  // Exact match
  if (YAHOO_SYMBOLS[key]) return YAHOO_SYMBOLS[key];
  // Partial match — check if any key is contained in the asset name
  for (const [name, symbol] of Object.entries(YAHOO_SYMBOLS)) {
    if (key.includes(name)) return symbol;
  }
  return null;
}

// ── Active timers ─────────────────────────────────────────
const _activeTimers = new Map();
export { _activeTimers };

// ── Weather code descriptions (WMO) ──────────────────────
const WMO_CODES = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'slight rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'slight snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'slight showers', 81: 'showers', 82: 'heavy showers',
  85: 'slight snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

// ── Cached IP geolocation ────────────────────────────────
let _cachedLocation = null;
let _locationCacheTime = 0;

const CHART_INTENT_PROMPT = `You are a data visualization intent parser. Given a user's request, extract structured intent.
Return ONLY valid JSON, no explanation. Schema:
{
  "subjects": ["entity1", "entity2"],
  "timeRange": { "count": 7, "unit": "day" } or null,
  "chartType": "line"|"bar"|"pie"|"doughnut"|"radar"|"table"|null,
  "isComparison": true|false,
  "searchQuery": "best web search query to find the numeric data needed"
}

Rules:
- subjects: the things to chart. Use canonical names (e.g. "Amazon" not "AMZN"). Never include chart/graph/plot words.
- timeRange: null if no time period. unit: day, week, month, year, quarter, hour.
- chartType: null means auto-select. Only set if user explicitly requests a type.
- isComparison: true if comparing multiple things.
- searchQuery: specific web search to find the data. Include "statistics" or "data" keywords. Be specific.`;

/**
 * Use LLM to parse natural language chart request into structured intent.
 */
async function _parseChartIntent(query) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VOICE_MODEL,
        messages: [
          { role: 'system', content: CHART_INTENT_PROMPT },
          { role: 'user', content: query },
        ],
        stream: false,
        temperature: 0,
      }),
    });
    clearTimeout(timeout);

    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    console.log(`[chart] LLM intent: ${JSON.stringify(parsed)}`);

    return {
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects.filter(s => s && s.length > 0) : [],
      timeRange: parsed.timeRange || null,
      chartType: parsed.chartType || null,
      isComparison: !!parsed.isComparison,
      searchQuery: parsed.searchQuery || query,
    };
  } catch (err) {
    console.warn(`[chart] LLM intent parse failed: ${err.message}`);
    return { subjects: [query], timeRange: null, chartType: null, isComparison: false, searchQuery: query };
  }
}

/**
 * Fetch live price for a financial asset via direct APIs.
 * Returns { price, source } or null.
 */
async function _fetchFinancialPrice(name) {
  const key = name.toLowerCase().trim();

  // Metals — Swissquote
  for (const [metal, symbol] of Object.entries(METAL_SYMBOLS)) {
    if (key.includes(metal)) {
      try {
        const res = await _fetchWithTimeout(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${symbol}/USD`, 5000);
        const data = await res.json();
        const spread = data[0]?.spreadProfilePrices?.[0];
        if (spread) {
          const price = parseFloat(((spread.bid + spread.ask) / 2).toFixed(2));
          console.log(`[chart] Swissquote ${symbol}: $${price}`);
          return { price, source: { title: `${metal} spot price`, url: 'https://swissquote.com/live-feed' } };
        }
      } catch (err) { console.warn(`[chart] Swissquote ${symbol} failed: ${err.message}`); }
    }
  }

  // Stocks/crypto — Google Finance
  const ticker = TICKER_MAP[key];
  if (ticker) {
    try {
      const gfUrl = `https://www.google.com/finance/quote/${ticker}`;
      const res = await _fetchWithTimeout(gfUrl, 5000);
      const html = await res.text();
      const priceAttr = 'data-last-price="';
      const priceIdx = html.indexOf(priceAttr);
      if (priceIdx !== -1) {
        const valStart = priceIdx + priceAttr.length;
        const valEnd = html.indexOf('"', valStart);
        const price = parseFloat(html.slice(valStart, valEnd));
        if (!isNaN(price)) {
          console.log(`[chart] Google Finance ${ticker}: $${price}`);
          return { price, source: { title: `Google Finance ${ticker.split(':')[0]}`, url: gfUrl } };
        }
      }
    } catch (err) { console.warn(`[chart] Google Finance ${ticker} failed: ${err.message}`); }
  }

  return null;
}

/**
 * Fetch actual historical prices via Yahoo Finance API.
 *
 * Yahoo Finance provides real daily close prices for stocks, crypto,
 * metals futures, and more. This replaces the old simulated random walk.
 *
 * @param {number} currentPrice - Today's live price (used as fallback for today)
 * @param {{ count: number, unit: string }} timeRange - How many units of history
 * @param {string} assetName - Asset name (e.g. "silver", "gold", "bitcoin")
 * @returns {{ labels: string[], data: number[] }} Chart-ready data with real prices
 */
async function _fetchHistoricalPrices(currentPrice, timeRange, assetName) {
  const { count, unit } = timeRange;
  const now = new Date();

  // Build expected date labels using noon UTC to avoid timezone date-shift issues.
  // Without this, local-time dates passed through toISOString() shift forward a day
  // in western hemisphere timezones, causing mismatches with Yahoo Finance dates.
  const dates = [];
  for (let i = count - 1; i >= 0; i--) {
    const y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
    let d;
    if (unit === 'day') d = new Date(Date.UTC(y, m, day - i, 12));
    else if (unit === 'week') d = new Date(Date.UTC(y, m, day - i * 7, 12));
    else if (unit === 'month') d = new Date(Date.UTC(y, m - i, day, 12));
    else if (unit === 'year') d = new Date(Date.UTC(y - i, m, day, 12));
    else if (unit === 'hour') { d = new Date(now); d.setHours(d.getHours() - i); }
    else if (unit === 'quarter') d = new Date(Date.UTC(y, m - i * 3, day, 12));
    else d = new Date(Date.UTC(y, m, day - i, 12));
    dates.push(d);
  }

  const labels = dates.map(d => {
    if (unit === 'hour') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (unit === 'year') return d.getFullYear().toString();
    if (unit === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  // Map time range to Yahoo Finance range parameter
  const rangeMap = { hour: '1d', day: '1mo', week: '3mo', month: '1y', quarter: '5y', year: '10y' };
  const yahooRange = rangeMap[unit] || '1mo';
  const intervalMap = { hour: '1h', day: '1d', week: '1wk', month: '1mo', quarter: '3mo', year: '1mo' };
  const yahooInterval = intervalMap[unit] || '1d';

  const yahooSymbol = _resolveYahooSymbol(assetName);
  if (yahooSymbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=${yahooRange}&interval=${yahooInterval}`;
      console.log(`[chart] Yahoo Finance: ${url}`);
      // Yahoo blocks browser-like UAs from Node.js — use a simple identifier
      const controller = new AbortController();
      const yahooTimeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'computer-lcars/1.0', 'Accept': 'application/json' },
      });
      clearTimeout(yahooTimeout);
      const json = await res.json();
      const result = json.chart?.result?.[0];

      if (result?.timestamp?.length > 0) {
        const timestamps = result.timestamp;
        const closes = result.indicators?.quote?.[0]?.close || [];

        // Build a date→price map from Yahoo data.
        // Yahoo timestamps are market-close times (Eastern US). Convert to
        // local date keys so they match the requested date keys.
        const priceByDate = new Map();
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] != null) {
            const d = new Date(timestamps[i] * 1000);
            // Use local date parts to build the key — matches how labels are built
            const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            priceByDate.set(key, parseFloat(closes[i].toFixed(2)));
          }
        }
        console.log(`[chart] Yahoo dates available: ${[...priceByDate.keys()].join(', ')}`);

        // Map our requested dates to Yahoo prices
        const data = dates.map(d => {
          const key = d.toISOString().split('T')[0];
          if (priceByDate.has(key)) return priceByDate.get(key);
          // Weekend/holiday: find nearest prior trading day
          for (let offset = 1; offset <= 5; offset++) {
            const prior = new Date(d);
            prior.setDate(prior.getDate() - offset);
            const priorKey = prior.toISOString().split('T')[0];
            if (priceByDate.has(priorKey)) return priceByDate.get(priorKey);
          }
          return null;
        });

        // Fill any remaining nulls
        for (let i = data.length - 1; i >= 0; i--) {
          if (data[i] === null && i < data.length - 1) data[i] = data[i + 1];
        }
        for (let i = 0; i < data.length; i++) {
          if (data[i] === null && i > 0) data[i] = data[i - 1];
        }

        const foundCount = data.filter(v => v !== null).length;
        console.log(`[chart] Yahoo Finance: ${foundCount}/${count} prices for ${yahooSymbol}`);

        if (foundCount > 0) return { labels, data };
      }
    } catch (err) {
      console.warn(`[chart] Yahoo Finance failed for ${yahooSymbol}: ${err.message}`);
    }
  }

  // Fallback: use live price for all days (flat line but honest)
  console.log(`[chart] No historical API available for "${assetName}", using live price`);
  const data = new Array(count).fill(currentPrice);
  return { labels, data };
}

/**
 * Extract time-series data (year→value pairs) from text.
 */
const DATA_EXTRACT_PROMPT = `You are a data extraction engine. Given text from web pages and a subject, extract structured numeric data.
Return ONLY valid JSON, no explanation. Schema:
{
  "labels": ["2020", "2021", "2022"],
  "values": [331000000, 332000000, 333000000],
  "unit": "people"
}

Rules:
- labels: time periods (years, months, dates) or category names
- values: raw numbers — convert "331 million" to 331000000, "1.4 billion" to 1400000000, "$198.79" to 198.79
- unit: what the values measure (people, dollars, percent, etc.)
- Sort chronologically for time-series, by value descending for categories
- Extract ALL available data points, not just a few
- If the text contains a table, extract all rows
- If no numeric data found, return {"labels":[],"values":[],"unit":"unknown"}`;

/**
 * Use LLM to extract structured data from web search text.
 * Much more reliable than regex for diverse web content.
 */
async function _llmExtractData(text, subject) {
  try {
    // Truncate to fit context window
    const truncated = text.slice(0, 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VOICE_MODEL,
        messages: [
          { role: 'system', content: DATA_EXTRACT_PROMPT },
          { role: 'user', content: `Subject: ${subject}\n\nText:\n${truncated}` },
        ],
        stream: false,
        temperature: 0,
      }),
    });
    clearTimeout(timeout);
    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.labels) && Array.isArray(parsed.values) && parsed.labels.length >= 2 && parsed.labels.length === parsed.values.length) {
      // Validate all values are numeric
      const validValues = parsed.values.every(v => typeof v === 'number' && !isNaN(v));
      if (validValues) {
        // Hallucination guard: verify that at least 30% of the extracted labels
        // actually appear verbatim in the source text. If fewer match, the LLM
        // is making up data points that weren't in the web page — reject the result
        // and fall back to HTML table extraction or snippet summary.
        const sourceText = truncated.toLowerCase();
        const matchingLabels = parsed.labels.filter(l => sourceText.includes(String(l).toLowerCase()));
        const labelMatchRatio = matchingLabels.length / parsed.labels.length;
        if (labelMatchRatio < 0.3) {
          console.warn(`[chart] Hallucination guard: only ${matchingLabels.length}/${parsed.labels.length} labels found in source text for "${subject}"`);
          return null;
        }
        console.log(`[chart] LLM extracted ${parsed.labels.length} data points for "${subject}" (unit: ${parsed.unit || 'unknown'}, label match: ${Math.round(labelMatchRatio * 100)}%)`);
        return { labels: parsed.labels.map(String), values: parsed.values, unit: parsed.unit || '' };
      }
    }
    console.log(`[chart] LLM extraction returned insufficient data for "${subject}"`);
    return null;
  } catch (err) {
    console.warn(`[chart] LLM data extraction failed for "${subject}": ${err.message}`);
    return null;
  }
}

/**
 * Extract table data from raw HTML using string parsing — no regex.
 */
function _extractHtmlTable(html) {
  const _stripTags = (s) => { let out = '', inTag = false; for (const c of s) { if (c === '<') inTag = true; else if (c === '>') inTag = false; else if (!inTag) out += c; } return out.trim(); };
  const _hasDigit = (s) => { for (const c of s) { if (c >= '0' && c <= '9') return true; } return false; };
  const _findAllBetween = (text, startTag, endTag) => {
    const items = [];
    let pos = 0;
    const lowerText = text.toLowerCase();
    const lStart = startTag.toLowerCase();
    const lEnd = endTag.toLowerCase();
    while (true) {
      const idx = lowerText.indexOf(lStart, pos);
      if (idx === -1) break;
      const contentStart = lowerText.indexOf('>', idx) + 1;
      const endIdx = lowerText.indexOf(lEnd, contentStart);
      if (endIdx === -1) break;
      items.push(text.slice(contentStart, endIdx));
      pos = endIdx + lEnd.length;
    }
    return items;
  };

  // Find all <table>...</table> blocks
  const tables = _findAllBetween(html, '<table', '</table>');
  if (tables.length === 0) return null;

  for (const tableHtml of tables.slice(0, 5)) {
    const headers = [];
    const rows = [];

    // Extract <th> cells
    const ths = _findAllBetween(tableHtml, '<th', '</th>');
    for (const th of ths) { const t = _stripTags(th); if (t) headers.push(t); }

    // Extract <tr> rows, then <td> cells within each
    const trs = _findAllBetween(tableHtml, '<tr', '</tr>');
    if (trs.length === 0) continue;

    let hasNums = false;
    for (const tr of trs) {
      const tds = _findAllBetween(tr, '<td', '</td>');
      if (tds.length === 0) continue;
      const cells = tds.map(td => _stripTags(td));
      if (cells.some(c => _hasDigit(c))) hasNums = true;
      if (cells.length > 0) rows.push(cells);
    }

    if (hasNums && rows.length >= 2 && (headers.length > 0 || rows[0].length > 1)) {
      if (headers.length === 0 && rows.length > 0) headers.push(...rows.shift());
      return { headers, rows };
    }
  }
  return null;
}

/**
 * Broadcast a chart/table to the UI.
 */
function _broadcastChart(broadcastFn, { type, title, labels, datasets, sources, table }) {
  const chartConfig = {
    type: type || 'bar',
    data: { labels: labels || [], datasets: datasets || [] },
    options: { plugins: { title: { display: true, text: title } } },
  };
  broadcastFn('chart', { chartConfig, sources: sources || [], table: table || null });
}

/**
 * Smart chart executor — the complete chart generation pipeline.
 *
 * Accepts { query: string } from the action model and handles the full pipeline:
 *
 * Step 1: LLM intent parsing (_parseChartIntent)
 *   Llama 4 Scout extracts: subjects, timeRange, chartType, isComparison, searchQuery
 *
 * Step 2: Financial fast path (_fetchFinancialPrice)
 *   For known assets (metals via Swissquote, stocks/crypto via Google Finance),
 *   fetch live price and generate a simulated time-series for the chart.
 *   This path skips web search entirely — much faster and more accurate.
 *
 * Step 3: Web search path (for non-financial data like population, revenue, rankings)
 *   Search DuckDuckGo + fetch top pages → extract HTML tables + LLM data extraction.
 *   Multiple fallback strategies: LLM extraction → HTML table → snippet summary.
 *
 * Step 4: Visualization
 *   Build chartConfig and push it to the browser via broadcastFn('chart', data).
 *   The Charts panel renders it using Chart.js.
 *
 * @param {{ query: string }} input - Natural language visualization request
 * @param {function} broadcastFn - (type, data) => void, scoped to requesting client
 * @returns {{ ok: boolean, chart?: string, panelSwitch?: string, summary?: string }}
 */
async function _smartChartExecutor(input, broadcastFn) {
  const query = input.query || input.title || '';
  console.log(`[chart] Smart executor: "${query}"`);

  // Step 1: LLM parses the intent
  const intent = await _parseChartIntent(query);
  const { subjects, timeRange, isComparison, searchQuery } = intent;
  let { chartType } = intent;
  const sources = [];

  // Override chartType from raw query — LLM is unreliable at extracting this
  const lq = query.toLowerCase();
  if (lq.includes('table')) chartType = 'table';
  else if (lq.includes('bar chart') || lq.includes('bar graph') || lq.includes(' bar ')) chartType = 'bar';
  else if (lq.includes('pie chart') || lq.includes('pie graph') || lq.includes(' pie ')) chartType = 'pie';
  else if (lq.includes('doughnut')) chartType = 'doughnut';
  else if (lq.includes('radar')) chartType = 'radar';
  // "line" and null (auto) left to LLM / default logic

  if (subjects.length === 0) {
    console.log(`[chart] No subjects found`);
    return { ok: false, error: 'Could not determine what to chart' };
  }

  console.log(`[chart] Intent: subjects=[${subjects.join(', ')}], time=${timeRange ? `${timeRange.count} ${timeRange.unit}s` : 'none'}, type=${chartType || 'auto'}`);

  // Step 2: Try financial fast paths
  const financialHits = [];
  for (const subj of subjects) {
    const fp = await _fetchFinancialPrice(subj);
    if (fp) { financialHits.push({ subject: subj, ...fp }); sources.push(fp.source); }
  }

  // All subjects are financial → fetch actual historical prices and build visualization
  if (financialHits.length === subjects.length && financialHits.length > 0) {
    const range = timeRange || { count: 7, unit: 'day' };
    if (!chartType) chartType = 'line';

    // Fetch real historical prices for each subject
    const seriesData = [];
    let labels = null;
    for (const fh of financialHits) {
      const ts = await _fetchHistoricalPrices(fh.price, range, fh.subject);
      if (!labels) labels = ts.labels;
      const name = fh.subject.charAt(0).toUpperCase() + fh.subject.slice(1);
      seriesData.push({ name, data: ts.data, price: fh.price });
    }

    const rangeLabel = `Last ${range.count} ${range.unit}${range.count > 1 ? 's' : ''}`;
    const firstName = seriesData[0].name;
    // Avoid "Silver price Price" — only append Price if name doesn't already contain it
    const titleName = firstName.toLowerCase().includes('price') ? firstName : `${firstName} Price`;
    const title = seriesData.length > 1
      ? `${seriesData.map(d => d.name).join(' vs ')} — ${rangeLabel}`
      : `${titleName} — ${rangeLabel}`;

    // Table mode
    if (chartType === 'table') {
      const headers = ['Date', ...seriesData.map(d => d.name)];
      const rows = labels.map((lbl, i) =>
        [lbl, ...seriesData.map(d => `$${d.data[i].toLocaleString()}`)]
      );
      _broadcastChart(broadcastFn, { type: 'bar', title, labels: [], datasets: [], sources, table: { headers, rows } });
      console.log(`[chart] Financial table: ${title} (${rows.length} rows)`);
      return { ok: true, chart: title, panelSwitch: 'charts', summary: `${title} table with ${rows.length} rows.` };
    }

    // Chart mode
    const datasets = seriesData.map(d => ({ label: d.name, data: d.data }));
    _broadcastChart(broadcastFn, { type: chartType, title, labels, datasets, sources });
    const priceInfo = financialHits.map(f => `${f.subject} at $${f.price >= 1000 ? f.price.toLocaleString() : f.price}`).join(', ');
    console.log(`[chart] Financial ${chartType}: ${title}`);
    return { ok: true, chart: title, panelSwitch: 'charts', summary: `${title}. ${priceInfo}.` };
  }

  // Step 3: Web search for non-financial data
  console.log(`[chart] Web search path for: "${searchQuery}"`);
  const allData = [];

  for (const subj of subjects) {
    // Use existing financial data if available
    const fh = financialHits.find(f => f.subject === subj);
    if (fh && timeRange) {
      const ts = _generatePriceSeries(fh.price, timeRange, subj);
      allData.push({ subject: subj, labels: ts.labels, values: ts.data, source: fh.source });
      continue;
    }

    const sq = subjects.length === 1 ? searchQuery : `${subj} ${searchQuery.replace(subjects[0], '').trim()}`;
    try {
      const sr = await _webSearchAndRead(sq, 3);
      const allText = [
        ...(sr.pages || []).map(p => p.content || ''),
        ...(sr.searchResults || []).map(r => `${r.title}: ${r.snippet}`),
      ].join('\n');

      // Try HTML table extraction from top result
      let tableData = null;
      const topUrl = sr.searchResults?.[0]?.url;
      if (topUrl) {
        try {
          const rawRes = await _fetchWithTimeout(topUrl, 5000);
          const rawHtml = await rawRes.text();
          tableData = _extractHtmlTable(rawHtml);
        } catch {}
      }

      const srcUrl = sr.searchResults?.[0]?.url || '';
      const srcTitle = sr.searchResults?.[0]?.title || subj;

      // Use LLM to extract structured data from the text
      const extracted = await _llmExtractData(allText, subj);

      if (extracted) {
        allData.push({ subject: subj, labels: extracted.labels, values: extracted.values, unit: extracted.unit, source: { title: srcTitle, url: srcUrl } });
        sources.push({ title: srcTitle, url: srcUrl });
      } else if (tableData) {
        // Fallback: use HTML table if LLM extraction fails
        allData.push({ subject: subj, table: tableData, source: { title: srcTitle, url: srcUrl } });
        sources.push({ title: srcTitle, url: srcUrl });
        console.log(`[chart] HTML table fallback for "${subj}" (${tableData.rows.length} rows)`);
      } else {
        // Last resort: build summary table from search snippets
        const rows = (sr.searchResults || []).slice(0, 8)
          .filter(r => r.snippet?.length > 10)
          .map(r => [r.title.slice(0, 60), r.snippet.slice(0, 120)]);
        if (rows.length > 0) {
          allData.push({ subject: subj, table: { headers: ['Source', 'Data'], rows }, source: { title: 'Web search', url: srcUrl } });
          sources.push({ title: 'Web search results', url: srcUrl });
          console.log(`[chart] Snippet summary fallback for "${subj}" (${rows.length} rows)`);
        }
      }
    } catch (err) {
      console.warn(`[chart] Search failed for "${subj}": ${err.message}`);
    }
  }

  if (allData.length === 0) {
    return { ok: false, error: `No data found for: ${subjects.join(', ')}` };
  }

  // Step 4: Build visualization
  const hasTable = allData.some(d => d.table && !d.values);
  const hasNumeric = allData.some(d => d.values);

  if (!chartType) {
    if (hasTable && !hasNumeric) chartType = 'table';
    else if (timeRange) chartType = 'line';
    else chartType = 'bar';
  }

  if (chartType === 'table' || (hasTable && !hasNumeric)) {
    const merged = { headers: [], rows: [] };
    for (const d of allData) {
      if (d.table) {
        // Native table data from HTML extraction
        if (merged.headers.length === 0) merged.headers = d.table.headers;
        merged.rows.push(...d.table.rows);
      } else if (d.values && d.labels) {
        // Convert numeric labels/values into table rows
        const name = d.subject.charAt(0).toUpperCase() + d.subject.slice(1);
        if (merged.headers.length === 0) {
          merged.headers = allData.filter(x => x.values).length > 1
            ? ['Period', ...allData.filter(x => x.values).map(x => x.subject.charAt(0).toUpperCase() + x.subject.slice(1))]
            : ['Period', name];
        }
        // For single subject, add as rows; for multi, handled below
        if (allData.filter(x => x.values).length === 1) {
          for (let i = 0; i < d.labels.length; i++) {
            merged.rows.push([d.labels[i], d.values[i].toLocaleString()]);
          }
        }
      }
    }
    // Multi-subject numeric → aligned table rows
    const numericSets = allData.filter(x => x.values);
    if (numericSets.length > 1) {
      // Use the longest label set as the base
      const baseLabelSet = numericSets.reduce((a, b) => a.labels.length >= b.labels.length ? a : b);
      for (let i = 0; i < baseLabelSet.labels.length; i++) {
        const lbl = baseLabelSet.labels[i];
        const row = [lbl];
        for (const ds of numericSets) {
          const idx = ds.labels.indexOf(lbl);
          row.push(idx >= 0 ? ds.values[idx].toLocaleString() : '—');
        }
        merged.rows.push(row);
      }
    }
    const title = `${subjects.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' & ')} — Data`;
    _broadcastChart(broadcastFn, { type: 'bar', title, labels: [], datasets: [], sources, table: merged });
    const srcLabel = sources.length === 1 ? '1 source' : `${sources.length} sources`;
    console.log(`[chart] Table: ${title} (${merged.rows.length} rows)`);
    return { ok: true, chart: title, panelSwitch: 'charts', summary: `${title} table with ${merged.rows.length} rows from ${srcLabel}.` };
  }

  // Numeric chart
  const datasets = [];
  let labels = null;
  for (const d of allData) {
    if (!d.values) continue;
    if (!labels) labels = d.labels;
    datasets.push({ label: d.subject.charAt(0).toUpperCase() + d.subject.slice(1), data: d.values });
  }

  if (!labels || datasets.length === 0) {
    return { ok: false, error: 'No numeric data to chart' };
  }

  const title = datasets.length > 1
    ? `${datasets.map(d => d.label).join(' vs ')}${timeRange ? ` — Last ${timeRange.count} ${timeRange.unit}${timeRange.count > 1 ? 's' : ''}` : ''}`
    : `${datasets[0].label}${timeRange ? ` — Last ${timeRange.count} ${timeRange.unit}${timeRange.count > 1 ? 's' : ''}` : ''}`;

  // Include table alongside chart if any subject had table data
  let table = null;
  for (const d of allData) { if (d.table) { table = d.table; break; } }

  _broadcastChart(broadcastFn, { type: chartType, title, labels, datasets, sources, table });
  console.log(`[chart] ${chartType} chart: ${title} (${datasets.length} datasets)`);
  const srcLabel = sources.length === 1 ? '1 source' : `${sources.length} sources`;
  return { ok: true, chart: title, panelSwitch: 'charts', summary: `${title} chart with ${labels.length} data points from ${srcLabel}.` };
}

// ── Tool executor ─────────────────────────────────────────

/**
 * Create a tool executor that maps voice-assistant tool calls
 * to internal API endpoints via localhost fetch.
 */
/**
 * Create a tool executor that broadcasts to all clients (for cron, API use).
 */
export function createGlobalToolExecutor(baseUrl) {
  return createToolExecutor(baseUrl, null);
}

function createToolExecutor(baseUrl, ws) {
  return async (toolName, input) => {
    try {
    switch (toolName) {
      case 'search_knowledge': {
        const res = await fetch(`${baseUrl}/api/knowledge/search`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: input.query, limit: input.limit || 5 }),
        });
        return await res.json();
      }
      case 'store_knowledge': {
        const res = await fetch(`${baseUrl}/api/knowledge`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: input.text, title: input.title }),
        });
        return await res.json();
      }
      case 'create_log': {
        const logData = { text: input.text };
        if (input.stardate) logData.stardate = input.stardate;
        if (input.category) logData.category = input.category;
        const res = await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(logData),
        });
        return await res.json();
      }
      case 'save_note': {
        const noteText = input.text || '';
        const res = await fetch(baseUrl + '/api/knowledge', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: noteText, title: 'Note', tags: ['note'], source: 'voice-note' }),
        });
        return await res.json();
      }
      case 'list_notes': {
        const res = await fetch(baseUrl + '/api/knowledge/search', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: 'note', limit: 10, method: 'keyword' }),
        });
        const data = await res.json();
        const notes = (data.results || []).filter(r => {
          const tags = r.tags || [];
          return tags.includes('note') || (r.source && r.source === 'voice-note');
        });
        return { notes: notes.slice(0, 5), count: notes.length };
      }
      case 'get_time': {
        const now = new Date();
        const year = now.getFullYear();
        const startOfYear = new Date(year, 0, 1);
        const dayOfYear = Math.floor((now - startOfYear) / 86400000);
        const dayFraction = Math.floor((dayOfYear / 365) * 1000);
        const stardate = `${year - 1924}.${dayFraction}`;
        return {
          time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          stardate,
          iso: now.toISOString(),
        };
      }
      case 'set_alert': {
        const level = input.level || 'red';
        const reason = input.reason || '';
        const alertSfxMap = { red: 'sfx-alert-red', yellow: 'sfx-alert-yellow', blue: 'sfx-alert-blue' };
        const alertSfxUrl = getSoundEffect(alertSfxMap[level]);
        if (alertSfxUrl) broadcast('play_sound', { url: alertSfxUrl });
        broadcast('alert_status', { level, reason, timestamp: new Date().toISOString() });
        broadcast('status', { message: `${level.toUpperCase()} ALERT${reason ? ': ' + reason : ''}`, speak: true });
        return { ok: true, level, reason };
      }
      case 'compare_data': {
        const res = await fetch(`${baseUrl}/api/comparisons`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            textA: input.textA,
            textB: input.textB,
            nameA: input.nameA || 'Subject A',
            nameB: input.nameB || 'Subject B',
          }),
        });
        return await res.json();
      }
      case 'create_reminder': {
        let delayMs;
        if (input.delay_minutes) {
          delayMs = input.delay_minutes * 60 * 1000;
        } else if (input.time) {
          // Parse time like "14:00" or "2pm"
          const now = new Date();
          let hours, minutes = 0;
          const t = input.time.toLowerCase().trim();
          if (t.includes(':')) {
            const parts = t.split(':');
            hours = parseInt(parts[0], 10);
            minutes = parseInt(parts[1], 10) || 0;
          } else {
            hours = parseInt(t, 10);
            if (t.includes('pm') && hours < 12) hours += 12;
            if (t.includes('am') && hours === 12) hours = 0;
          }
          const target = new Date(now);
          target.setHours(hours, minutes, 0, 0);
          if (target <= now) target.setDate(target.getDate() + 1);
          delayMs = target - now;
        } else {
          delayMs = 15 * 60 * 1000; // Default 15 minutes
        }
        const fireAt = new Date(Date.now() + delayMs);
        const reminderId = setTimeout(() => {
          const reminderSfx = getSoundEffect('sfx-alert-blue');
          if (reminderSfx) broadcast('play_sound', { url: reminderSfx });
          broadcast('status', { message: `REMINDER: ${input.message}`, speak: true });
          broadcast('alert_status', { level: 'blue', reason: input.message });
        }, delayMs);
        return {
          ok: true,
          message: input.message,
          fireAt: fireAt.toISOString(),
          fireIn: Math.round(delayMs / 60000) + ' minutes',
        };
      }
      case 'display_on_screen': {
        broadcast('voice_panel_switch', { panel: input.panel });
        return { ok: true, panel: input.panel };
      }
      case 'send_message': {
        const res = await fetch(`${baseUrl}/api/gateway/send`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ channel: input.channel, target: input.target, text: input.text }),
        });
        return await res.json();
      }
      case 'list_channels': {
        const res = await fetch(`${baseUrl}/api/gateway/channels`, { headers: authHeaders() });
        return await res.json();
      }
      case 'get_status': {
        const res = await fetch(`${baseUrl}/api/health`, { headers: authHeaders() });
        const data = await res.json();
        delete data.authToken;
        return data;
      }
      case 'search_transcripts': {
        const res = await fetch(`${baseUrl}/api/transcripts?q=${encodeURIComponent(input.query)}`, {
          headers: authHeaders(),
        });
        return await res.json();
      }
      case 'create_monitor': {
        const res = await fetch(`${baseUrl}/api/monitors`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: input.name, target: input.target }),
        });
        return await res.json();
      }
      case 'get_briefing': {
        const [transcripts, logs] = await Promise.all([
          fetch(`${baseUrl}/api/transcripts?limit=10`, { headers: authHeaders() }).then(r => r.json()),
          fetch(`${baseUrl}/api/logs?limit=10`, { headers: authHeaders() }).then(r => r.json()),
        ]);
        return { transcripts, logs };
      }
      case 'generate_chart': {
        // Scope chart to requesting client if available, otherwise broadcast to all
        const clientBroadcast = ws ? (type, data) => sendTo(ws, type, data) : broadcast;
        return await _smartChartExecutor(input, clientBroadcast);
      }
      case 'browse_url': {
        broadcast('browser_navigate', { url: input.url });
        return { ok: true, url: input.url };
      }
      case 'analyze_text': {
        const res = await fetch(`${baseUrl}/api/analysis`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: input.text, title: input.title }),
        });
        return await res.json();
      }
      case 'web_fetch': {
        try {
          return await _webFetch(input.url);
        } catch (err) {
          return { error: `Failed to fetch ${input.url}: ${err.message}` };
        }
      }
      case 'web_search': {
        try {
          return await _webSearch(input.query);
        } catch (err) {
          return { error: `Search failed: ${err.message}` };
        }
      }
      case 'web_search_and_read': {
        try {
          return await _webSearchAndRead(input.query, input.num_results || 3);
        } catch (err) {
          return { error: `Search+read failed: ${err.message}` };
        }
      }
      case 'check_email': {
        const res = await fetch(`${baseUrl}/api/gmail/inbox?max=10`, { headers: authHeaders() });
        return await res.json();
      }
      case 'summarize_inbox': {
        const res = await fetch(`${baseUrl}/api/gmail/summary`, { headers: authHeaders() });
        return await res.json();
      }
      case 'check_followups': {
        const res = await fetch(`${baseUrl}/api/gmail/followups`, { headers: authHeaders() });
        return await res.json();
      }
      case 'read_email': {
        // Search for the email, then read the first result
        const q = input.query || '';
        const searchRes = await fetch(`${baseUrl}/api/gmail/search?q=${encodeURIComponent(q)}&max=1`, { headers: authHeaders() });
        const searchData = await searchRes.json();
        const msgs = searchData.messages || [];
        if (msgs.length === 0) return { messages: [], error: 'No matching email found' };
        // Get full message
        const msgRes = await fetch(`${baseUrl}/api/gmail/messages/${encodeURIComponent(msgs[0].id)}`, { headers: authHeaders() });
        return await msgRes.json();
      }
      case 'send_email': {
        const { to, subject, body } = input;
        // If we have all fields, send directly
        if (to && body) {
          const sendRes = await fetch(`${baseUrl}/api/gmail/send`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ to, subject: subject || '', body }),
          });
          const result = await sendRes.json();
          return { sent: true, to, subject, ...result };
        }
        // Otherwise signal to open compose
        return { drafted: !!to, to: to || '', subject: subject || '', body: body || '' };
      }
      case 'reply_email': {
        const { query, body } = input;
        // Find the email to reply to
        const searchRes2 = await fetch(`${baseUrl}/api/gmail/search?q=${encodeURIComponent(query || '')}&max=1`, { headers: authHeaders() });
        const searchData2 = await searchRes2.json();
        const msgs2 = searchData2.messages || [];
        if (msgs2.length === 0) return { found: false, error: 'No matching email found' };
        const original = msgs2[0];
        // If we have a body, send the reply
        if (body) {
          const replySubject = (original.subject || '').startsWith('Re:') ? original.subject : 'Re: ' + (original.subject || '');
          const sendRes = await fetch(`${baseUrl}/api/gmail/send`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              to: original.from || '',
              subject: replySubject,
              body,
              threadId: original.threadId,
            }),
          });
          const result = await sendRes.json();
          return { sent: true, to: original.from, subject: replySubject, ...result };
        }
        // Otherwise just report we found it
        return { found: true, from: original.from, subject: original.subject, threadId: original.threadId };
      }
      // ── New Tools ─────────────────────────────────────────
      case 'system_info': {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cpuArr = os.cpus();
        const uptimeSec = os.uptime();
        const sysD = Math.floor(uptimeSec / 86400);
        const sysH = Math.floor((uptimeSec % 86400) / 3600);
        const uptimeHuman = sysD > 0 ? `${sysD} day${sysD > 1 ? 's' : ''}, ${sysH} hour${sysH > 1 ? 's' : ''}` : `${sysH} hour${sysH > 1 ? 's' : ''}`;
        let disk = null;
        try {
          const dfOut = execSync('df -h /').toString();
          const lines = dfOut.trim().split('\n');
          if (lines.length >= 2) {
            const parts = lines[1].split(' ').filter(s => s.length > 0);
            disk = { total: parts[1], used: parts[2], free: parts[3], percent: parts[4] };
          }
        } catch {}
        return {
          totalMemoryGB: totalMem / (1024 ** 3), freeMemoryGB: freeMem / (1024 ** 3),
          cpuCount: cpuArr.length, cpuModel: cpuArr[0]?.model || 'Unknown',
          uptimeHuman, loadAvg: os.loadavg()[0].toFixed(1), disk,
        };
      }
      case 'clipboard_read': {
        const clipText = execSync('pbpaste', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return { text: clipText || '' };
      }
      case 'clipboard_write': {
        const textToWrite = input.text || '';
        execSync('pbcopy', { input: textToWrite });
        return { ok: true, length: textToWrite.length };
      }
      case 'start_timer': {
        const secs = input.duration_seconds || 60;
        const label = input.label || '';
        const timerId = `timer-${Date.now()}`;
        const tD = Math.floor(secs / 86400), tH = Math.floor((secs % 86400) / 3600);
        const tM = Math.floor((secs % 3600) / 60), tS = secs % 60;
        let durationHuman = '';
        if (tD > 0) durationHuman += `${tD} day${tD > 1 ? 's' : ''} `;
        if (tH > 0) durationHuman += `${tH} hour${tH > 1 ? 's' : ''} `;
        if (tM > 0) durationHuman += `${tM} minute${tM > 1 ? 's' : ''} `;
        if (tS > 0 && tH === 0 && tD === 0) durationHuman += `${tS} second${tS > 1 ? 's' : ''}`;
        durationHuman = durationHuman.trim();
        const timerHandle = setTimeout(async () => {
          _activeTimers.delete(timerId);
          const msg = label ? `Timer complete: ${label}` : 'Timer complete';
          const timerSfx = getSoundEffect('sfx-alert-blue');
          if (timerSfx) broadcast('play_sound', { url: timerSfx });
          broadcast('alert_status', { level: 'blue', reason: msg });
          broadcast('status', { message: msg });
          try {
            const ttsRes = await fetch(`${baseUrl}/api/tts/speak`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: msg }) });
            const ttsData = await ttsRes.json();
            if (ttsData.audioUrl) broadcast('play_sound', { url: ttsData.audioUrl });
          } catch {}
          setTimeout(() => broadcast('alert_status', { level: 'normal', reason: 'Timer acknowledged' }), 5000);
        }, secs * 1000);
        const endsAtMs = Date.now() + secs * 1000;
        _activeTimers.set(timerId, { handle: timerHandle, label, endsAt: endsAtMs });
        broadcast('timer_started', { endsAt: new Date(endsAtMs).toISOString(), label });
        return { ok: true, timerId, durationHuman, label, endsAt: new Date(endsAtMs).toISOString() };
      }
      case 'get_weather': {
        let lat, lon, locationName;
        if (input.location) {
          const geoRes = await _fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input.location)}&count=1`, 5000);
          const geoData = await geoRes.json();
          if (geoData.results?.length > 0) { lat = geoData.results[0].latitude; lon = geoData.results[0].longitude; locationName = geoData.results[0].name; }
          else return { error: `Location not found: ${input.location}` };
        } else {
          const now = Date.now();
          if (!_cachedLocation || now - _locationCacheTime > 3600000) {
            // Try multiple free geolocation APIs
            const geoApis = [
              { url: 'https://ipapi.co/json/', parse: d => ({ lat: d.latitude, lon: d.longitude, city: d.city }) },
              { url: 'http://ip-api.com/json/', parse: d => ({ lat: d.lat, lon: d.lon, city: d.city }) },
            ];
            for (const api of geoApis) {
              try {
                const ipRes = await _fetchWithTimeout(api.url, 3000);
                const ipData = await ipRes.json();
                const loc = api.parse(ipData);
                if (loc.lat && loc.lon) { _cachedLocation = loc; _locationCacheTime = now; break; }
              } catch {}
            }
            if (!_cachedLocation) return { error: 'Could not determine location. Try specifying a city.' };
          }
          lat = _cachedLocation.lat; lon = _cachedLocation.lon; locationName = _cachedLocation.city;
        }
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3`;
        const wxRes = await _fetchWithTimeout(wxUrl, 5000);
        const wx = await wxRes.json();
        const cur = wx.current;
        const daily = wx.daily;
        const forecast = daily ? daily.time.map((d, i) => ({ day: d, high: daily.temperature_2m_max[i], low: daily.temperature_2m_min[i], description: WMO_CODES[daily.weather_code[i]] || 'unknown' })) : [];
        return {
          current: { temperature: cur.temperature_2m, feelsLike: cur.apparent_temperature, humidity: cur.relative_humidity_2m, wind: cur.wind_speed_10m, description: WMO_CODES[cur.weather_code] || 'unknown' },
          forecast, location: locationName,
        };
      }
      case 'calculate': {
        const expr = input.expression || '';
        const lower = expr.toLowerCase();
        const currencies = ['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'cny', 'inr', 'krw', 'dollars', 'euros', 'pounds', 'yen', 'yuan'];
        if (currencies.some(c => lower.includes(c))) {
          try {
            const llmRes = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: VOICE_MODEL, stream: false, temperature: 0,
                messages: [{ role: 'user', content: `Extract from: "${expr}"\nReturn ONLY JSON: {"amount": 500, "from": "EUR", "to": "USD"}\nUse 3-letter ISO codes.` }] }),
            });
            const llmData = await llmRes.json();
            let content = (llmData.choices?.[0]?.message?.content || '').trim();
            if (content.startsWith('```')) { content = content.slice(content.indexOf('\n') + 1); const last = content.lastIndexOf('```'); if (last !== -1) content = content.slice(0, last); }
            const parsed = JSON.parse(content.trim());
            const rateRes = await _fetchWithTimeout(`https://open.er-api.com/v6/latest/${parsed.from}`, 5000);
            const rateData = await rateRes.json();
            const rate = rateData.rates?.[parsed.to];
            if (rate) {
              const converted = (parsed.amount * rate).toFixed(2);
              return { result: parseFloat(converted), formatted: `${parsed.amount} ${parsed.from} is approximately ${converted} ${parsed.to}.` };
            }
          } catch {}
          return { error: 'Currency conversion failed' };
        }
        // Unit conversion check
        const unitKeywords = ['miles', 'kilometers', 'km', 'feet', 'meters', 'inches', 'centimeters',
          'pounds', 'kilograms', 'kg', 'lbs', 'ounces', 'grams', 'celsius', 'fahrenheit',
          'gallons', 'liters', 'cups', 'tablespoons', 'teaspoons', 'acres', 'hectares',
          'mph', 'kph', 'knots'];
        const isUnit = unitKeywords.some(u => lower.includes(u));
        if (isUnit) {
          try {
            const llmRes = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: VOICE_MODEL, stream: false, temperature: 0,
                messages: [{ role: 'user', content: 'Convert: "' + expr + '". Return ONLY JSON: {"result": 160.934, "formatted": "100 miles is 160.93 kilometers."}' }],
              }),
            });
            const llmData = await llmRes.json();
            let content = (llmData.choices?.[0]?.message?.content || '').trim();
            if (content.startsWith('```')) { content = content.slice(content.indexOf('\n') + 1); const last = content.lastIndexOf('```'); if (last !== -1) content = content.slice(0, last); }
            const parsed = JSON.parse(content.trim());
            if (parsed.formatted) return { result: parsed.result, expression: expr, formatted: parsed.formatted };
          } catch {}
        }
        // Math: preprocess and evaluate safely
        let sanitized = expr;
        // Handle "X% of Y" as a unit before splitting % and "of" separately
        sanitized = sanitized.split('% of ').join('/100*');
        sanitized = sanitized.split('%').join('/100');
        sanitized = sanitized.split(' of ').join('*');
        sanitized = sanitized.split('^').join('**');
        sanitized = sanitized.split('sqrt').join('Math.sqrt');
        sanitized = sanitized.split('abs').join('Math.abs');
        sanitized = sanitized.split('log').join('Math.log10');
        sanitized = sanitized.split('PI').join('Math.PI');
        sanitized = sanitized.split('pi').join('Math.PI');
        const dangerous = ['import', 'require', 'fetch', 'eval', 'process', 'child', 'exec', 'fs', 'Buffer'];
        if (dangerous.some(d => sanitized.includes(d))) return { error: 'Expression contains disallowed tokens' };
        try {
          const fn = new Function('return ' + sanitized);
          const val = fn();
          if (typeof val === 'number' && isFinite(val)) {
            const display = Number.isInteger(val) ? val.toString() : parseFloat(val.toFixed(4)).toString();
            return { result: val, expression: expr, formatted: `${expr} equals ${display}.` };
          }
        } catch {}
        return { result: null, expression: expr, formatted: null };
      }
      case 'take_screenshot': {
        const base64 = await captureScreen();
        if (!base64) return { error: 'Screenshot capture failed' };
        const shouldDescribe = input.describe !== false;
        let description = '';
        if (shouldDescribe) {
          try {
            const vr = await analyzeImage(base64, 'image/png', 'Describe what you see on this screen concisely in 2-3 sentences.');
            description = vr?.text || '';
          } catch (err) { description = 'Vision analysis unavailable: ' + err.message; }
        }
        return { ok: true, description, hasImage: true };
      }
      case 'translate_text': {
        const textToTranslate = input.text || '';
        const target = input.target_language || 'English';
        const source = input.source_language || 'English';
        const trRes = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: VOICE_MODEL, stream: false, temperature: 0,
            messages: [{ role: 'user', content: `Translate the following ${source} text to ${target}. Return ONLY the translation.\n\nText: ${textToTranslate}` }] }),
        });
        const trData = await trRes.json();
        return { translation: (trData.choices?.[0]?.message?.content || '').trim(), source, target, original: textToTranslate };
      }
      case 'manage_schedule': {
        const action = input.action || 'list';
        if (action === 'list') return { jobs: listJobs() };
        if (action === 'add') return { created: await addJob({ name: input.name || 'Unnamed', schedule: input.schedule || '*/5 * * * *', command: input.command || '' }) };
        if (action === 'remove') return { removed: await removeJob(input.job_id) };
        if (action === 'toggle') return { toggled: await toggleJob(input.job_id) };
        return { error: 'Unknown action: ' + action };
      }
      case 'check_calendar': {
        try {
          const dateStr = input.date || 'today';
          const now = new Date();
          let targetDate;
          if (dateStr === 'today') targetDate = now;
          else if (dateStr === 'tomorrow') { targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + 1); }
          else targetDate = new Date(dateStr);
          const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);
          const events = await calendar.listEvents(startOfDay.toISOString(), endOfDay.toISOString());
          return { events, date: targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) };
        } catch (err) { return { error: 'Calendar not connected. ' + err.message, events: [] }; }
      }
      case 'create_event': {
        try {
          return await calendar.createEvent({ summary: input.summary, startTime: input.start_time, durationMinutes: input.duration_minutes || 60, description: input.description });
        } catch (err) { return { error: 'Calendar not connected. ' + err.message }; }
      }
      case 'analyze_document': {
        const res = await fetch(`${baseUrl}/api/documents/analyze`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ path: input.path || '' }),
        });
        const result = await res.json();
        if (result.error) return result;
        return { summary: result.summary, topics: result.topics, actionItems: result.actionItems, title: result.title };
      }
      case 'get_news': {
        const topic = input.topic || '';
        const query = topic ? `${topic} news today` : 'top news headlines today';
        const searchResult = await _webSearch(query);
        const headlines = (searchResult.results || []).slice(0, 5).map(r => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        }));
        broadcast('search', { query, results: headlines, source: 'news' });
        return { headlines, topic: topic || 'general', count: headlines.length };
      }
      case 'generate_report': {
        const timeframe = input.timeframe || 'today';
        const [transcripts, analyses, logs, comparisons] = await Promise.all([
          fetch(baseUrl + '/api/transcripts', { headers: authHeaders() }).then(r => r.json()).catch(() => []),
          fetch(baseUrl + '/api/analyses', { headers: authHeaders() }).then(r => r.json()).catch(() => []),
          fetch(baseUrl + '/api/logs', { headers: authHeaders() }).then(r => r.json()).catch(() => []),
          fetch(baseUrl + '/api/comparisons', { headers: authHeaders() }).then(r => r.json()).catch(() => []),
        ]);

        const now = new Date();
        const cutoff = new Date();
        if (timeframe === 'yesterday') { cutoff.setDate(cutoff.getDate() - 1); cutoff.setHours(0,0,0,0); }
        else if (timeframe === 'this week') { cutoff.setDate(cutoff.getDate() - 7); }
        else { cutoff.setHours(0,0,0,0); }

        const filterByDate = (items) => items.filter(item => {
          const ts = item.timestamp || item.createdAt || item.date;
          return ts && new Date(ts) >= cutoff;
        });

        const filteredTranscripts = filterByDate(transcripts);
        const filteredAnalyses = filterByDate(analyses);
        const filteredLogs = filterByDate(logs);
        const filteredComparisons = filterByDate(comparisons);

        const report = {
          timeframe,
          generated: now.toISOString(),
          summary: {
            voiceCommands: filteredTranscripts.filter(t => t.source === 'voice').length,
            transcriptions: filteredTranscripts.filter(t => t.source !== 'voice').length,
            analyses: filteredAnalyses.length,
            logEntries: filteredLogs.length,
            comparisons: filteredComparisons.length,
          },
          voiceCommands: filteredTranscripts.filter(t => t.source === 'voice').slice(0, 10).map(t => (t.text || '').slice(0, 200)),
          logEntries: filteredLogs.slice(0, 5).map(l => (l.text || '').slice(0, 100)),
        };

        broadcast('comparison', {
          title: 'Activity Report — ' + timeframe.charAt(0).toUpperCase() + timeframe.slice(1),
          textA: JSON.stringify(report.summary, null, 2),
          textB: (report.voiceCommands || []).join('\n'),
          nameA: 'Summary',
          nameB: 'Voice Commands',
          verdict: `${report.summary.voiceCommands} voice commands, ${report.summary.analyses} analyses, ${report.summary.logEntries} log entries.`,
        });

        return report;
      }
      case 'define_word': {
        const word = input.word || '';
        const defRes = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VOICE_MODEL, stream: false, temperature: 0, max_tokens: 150,
            messages: [{ role: 'user', content: 'Define the word "' + word + '" concisely in 1-2 sentences. Include the part of speech. Example format: "Ephemeral (adjective): lasting for a very short time."' }],
          }),
        });
        const defData = await defRes.json();
        const definition = (defData.choices?.[0]?.message?.content || '').trim();
        return { word, definition };
      }
      case 'play_ambient': {
        const preset = input.preset || 'bridge';
        if (preset === 'stop') {
          broadcast('ambient_control', { action: 'stop' });
          return { ok: true, action: 'stopped' };
        }
        broadcast('ambient_control', { action: 'play', preset });
        return { ok: true, preset, action: 'playing' };
      }
      case 'random_fact': {
        const topic = input.topic || '';
        const prompt = topic
          ? 'Tell me one fascinating, true fact about ' + topic + '. Keep it under 2 sentences. Be specific with numbers or dates. Do not start with "Did you know".'
          : 'Tell me one fascinating, true, lesser-known fact. Keep it under 2 sentences. Be specific with numbers or dates. Cover any topic — science, history, nature, space, technology. Do not start with "Did you know".';
        const factRes = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VOICE_MODEL, stream: false, temperature: 0.8, max_tokens: 100,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const factData = await factRes.json();
        const fact = (factData.choices?.[0]?.message?.content || '').trim();
        return { fact, topic: topic || 'random' };
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
    } catch (err) {
      console.error(`[ws] Tool executor error (${toolName}):`, err.message);
      return { error: `Tool '${toolName}' failed: ${err.message}` };
    }
  };
}

function authHeaders() {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Split text into sentences at ". ", "! ", "? " boundaries.
 * Uses string methods only (no regex). Returns non-empty trimmed segments.
 */
function splitSentences(text) {
  const delimiters = ['. ', '! ', '? '];
  const sentences = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestIdx = -1;
    let earliestDelim = '';

    for (const delim of delimiters) {
      const idx = remaining.indexOf(delim);
      if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
        earliestIdx = idx;
        earliestDelim = delim;
      }
    }

    if (earliestIdx === -1) {
      // No more delimiters — rest is the final segment
      const trimmed = remaining.trim();
      if (trimmed.length > 0) sentences.push(trimmed);
      break;
    }

    // Include the punctuation character but not the trailing space
    const segment = remaining.slice(0, earliestIdx + earliestDelim.length - 1).trim();
    if (segment.length > 0) sentences.push(segment);
    remaining = remaining.slice(earliestIdx + earliestDelim.length);
  }

  return sentences;
}

/**
 * Handle a voice command: Claude Haiku processing → TTS → response.
 */
async function handleVoiceCommand(ws, sessionId, text, baseUrl) {
  console.log(`[ws] handleVoiceCommand: sessionId=${sessionId}, text="${text}"`);
  try {
    sendTo(ws, 'voice_thinking', {});

    // Play acknowledge sound on wake word detection
    const ackUrl = getSoundEffect('sfx-acknowledge');
    if (ackUrl) sendTo(ws, 'play_sound', { url: ackUrl });

    const toolExecutor = createToolExecutor(baseUrl, ws);
    const result = await processVoiceCommand(sessionId, text, toolExecutor);
    console.log(`[ws] Voice result: text="${result.text?.slice(0, 100)}", tools=[${result.toolsUsed?.join(', ')}], panel=${result.panelSwitch}`);

    // Broadcast panel switch for any tool that requests it
    if (result.panelSwitch) {
      sendTo(ws, 'voice_panel_switch', { panel: result.panelSwitch });
    }

    // Generate TTS for the response
    let audioUrl = null;
    let streamed = false;

    if (result.text) {
      if (result.text.length <= 100) {
        // Short response — single WAV (fast enough, no streaming needed)
        try {
          const ttsRes = await fetch(`${baseUrl}/api/tts/speak`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ text: result.text }),
          });
          const ttsData = await ttsRes.json();
          audioUrl = ttsData.audioUrl || null;
          console.log(`[ws] TTS (single): audioUrl=${audioUrl}`);
        } catch (err) {
          console.error(`[ws] TTS failed:`, err.message);
        }
      } else {
        // Long response — split into sentences and stream each chunk
        const sentences = splitSentences(result.text);
        console.log(`[ws] TTS streaming: ${sentences.length} sentence(s)`);

        let chunkIndex = 0;
        let anyChunkSent = false;
        for (const sentence of sentences) {
          try {
            const ttsRes = await fetch(`${baseUrl}/api/tts/speak`, {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ text: sentence }),
            });
            const ttsData = await ttsRes.json();
            if (ttsData.audioUrl) {
              sendTo(ws, 'voice_audio_chunk', {
                audioUrl: ttsData.audioUrl,
                index: chunkIndex,
                total: sentences.length,
              });
              anyChunkSent = true;
              console.log(`[ws] TTS chunk ${chunkIndex + 1}/${sentences.length}: ${ttsData.audioUrl}`);
            }
          } catch (err) {
            console.error(`[ws] TTS chunk ${chunkIndex + 1} failed:`, err.message);
          }
          chunkIndex++;
        }

        if (anyChunkSent) {
          streamed = true;
        } else {
          // All chunks failed — fall back to single WAV for the full text
          try {
            const ttsRes = await fetch(`${baseUrl}/api/tts/speak`, {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ text: result.text }),
            });
            const ttsData = await ttsRes.json();
            audioUrl = ttsData.audioUrl || null;
            console.log(`[ws] TTS fallback (single): audioUrl=${audioUrl}`);
          } catch (err) {
            console.error(`[ws] TTS fallback failed:`, err.message);
          }
        }
      }
    }

    // Save voice interaction to transcript history
    try {
      await fetch(`${baseUrl}/api/transcripts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          source: 'voice',
          text: `User: ${text}\n\nComputer: ${result.text}`,
          filename: 'voice-command',
          language: 'en',
          segments: [
            { text: text, start: 0, end: 0, speaker: 'user' },
            { text: result.text, start: 0, end: 0, speaker: 'computer' },
          ],
        }),
      });
    } catch {}

    sendTo(ws, 'voice_response', {
      text: result.text,
      audioUrl: streamed ? null : audioUrl,
      toolsUsed: result.toolsUsed,
      panelSwitch: result.panelSwitch,
    });
  } catch (err) {
    console.error(`[ws] handleVoiceCommand ERROR:`, err);
    const errUrl = getSoundEffect('sfx-error');
    if (errUrl) sendTo(ws, 'play_sound', { url: errUrl });
    sendTo(ws, 'voice_error', { error: err.message || 'Voice processing failed' });
  } finally {
    sendTo(ws, 'voice_done', {});
  }
}

function sendTo(ws, type, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, data }));
  }
}

// ── Moshi Bridge Helpers ──────────────────────────────────

const WAKE_WORDS = ['computer,', 'computer.', 'computer!', 'computer '];

/**
 * Check if text contains the wake word "Computer" to trigger mode switch.
 */
function detectWakeWord(text) {
  const lower = text.toLowerCase().trim();
  if (lower === 'computer') return { detected: true, command: '' };
  for (const wake of WAKE_WORDS) {
    const idx = lower.indexOf(wake);
    if (idx !== -1) {
      const command = text.slice(idx + wake.length).trim();
      return { detected: true, command };
    }
  }
  return { detected: false, command: '' };
}

/**
 * Connect a client to Moshi via a WebSocket bridge.
 */
async function connectMoshiBridge(ws, state, baseUrl, sessionId) {
  if (state.moshiBridge && state.moshiBridge.isOpen()) {
    return true; // Already connected
  }

  const running = await isMoshiRunning();
  if (!running) {
    sendTo(ws, 'moshi_error', { error: 'Moshi is not running' });
    return false;
  }

  const bridge = createMoshiBridge();

  // Relay Moshi audio responses back to browser
  bridge.onAudio((opusFrame) => {
    // Only relay Moshi audio when in Moshi mode — prevents dual-audio during Computer command processing
    if (ws.readyState === 1 && state.voiceMode === 'moshi') {
      const frame = Buffer.alloc(1 + opusFrame.length);
      frame[0] = KIND_AUDIO;
      opusFrame.copy(frame, 1);
      ws.send(frame);
    }
  });

  // Relay Moshi text tokens to browser + check for wake word
  bridge.onText((text) => {
    state.moshiTextBuffer += text;
    sendTo(ws, 'moshi_text', { text, fullText: state.moshiTextBuffer });

    // Only check for wake word in Moshi mode — prevents recursive switchToComputerMode
    // while a command is already being processed (Moshi may say "computer" in its response)
    if (state.voiceMode !== 'moshi') return;

    const { detected, command } = detectWakeWord(state.moshiTextBuffer);
    if (detected && command.length > 3) {
      console.log('[ws] Wake word detected in Moshi text, switching to Computer mode: "' + command + '"');
      state.moshiTextBuffer = '';
      switchToComputerMode(ws, state, sessionId, command, baseUrl);
    }
  });

  bridge.onHandshake((config) => {
    sendTo(ws, 'moshi_handshake', config);
  });

  bridge.onClose(() => {
    state.moshiBridge = null;
    sendTo(ws, 'voice_mode_changed', { mode: 'computer', reason: 'moshi_disconnected' });
  });

  try {
    await bridge.connect();
    state.moshiBridge = bridge;
    state.moshiTextBuffer = '';
    console.log('[ws] Moshi bridge connected for client');
    return true;
  } catch (err) {
    console.error('[ws] Moshi bridge connection failed: ' + err.message);
    sendTo(ws, 'moshi_error', { error: 'Failed to connect to Moshi: ' + err.message });
    return false;
  }
}

/**
 * Connect a client to Gemini Live via the @google/genai SDK bridge.
 */
async function connectGeminiBridge(ws, state, baseUrl, sessionId) {
  if (state.geminiBridge && state.geminiBridge.isOpen()) {
    return true; // Already connected
  }

  if (!isGeminiAvailable()) {
    sendTo(ws, 'gemini_error', { error: 'GEMINI_API_KEY not set' });
    return false;
  }

  const toolExecutor = createToolExecutor(baseUrl, ws);
  const bridge = createGeminiBridge({ toolExecutor });

  // Relay Gemini audio responses back to browser as raw PCM with 0x03 prefix
  bridge.onAudio((pcmBuffer) => {
    if (ws.readyState === 1 && state.voiceMode === 'gemini') {
      const frame = Buffer.alloc(1 + pcmBuffer.length);
      frame[0] = KIND_GEMINI;
      pcmBuffer.copy(frame, 1);
      ws.send(frame);
    }
  });

  // Relay Gemini text transcripts to browser
  bridge.onText((text) => {
    state.geminiTextBuffer += text;
    sendTo(ws, 'gemini_text', { text, fullText: state.geminiTextBuffer });
  });

  // Relay tool call events to browser for UI feedback
  bridge.onToolCall((calls) => {
    const names = calls.map(c => c.name);
    sendTo(ws, 'gemini_tool_call', { tools: names });
    console.log('[ws] Gemini tool calls:', names.join(', '));
  });

  bridge.onClose(() => {
    state.geminiBridge = null;
    sendTo(ws, 'voice_mode_changed', { mode: 'computer', reason: 'gemini_disconnected' });
  });

  try {
    await bridge.connect();
    state.geminiBridge = bridge;
    state.geminiTextBuffer = '';
    console.log('[ws] Gemini bridge connected for client');
    return true;
  } catch (err) {
    console.error('[ws] Gemini bridge connection failed: ' + err.message);
    sendTo(ws, 'gemini_error', { error: 'Failed to connect to Gemini: ' + err.message });
    return false;
  }
}

/**
 * Temporarily switch to Computer mode to process a tool command,
 * then switch back to Moshi mode.
 */
/**
 * Connect a client to OpenAI Realtime via the openai SDK bridge.
 */
async function connectOpenAIBridge(ws, state, baseUrl, sessionId) {
  if (state.openAIBridge && state.openAIBridge.isOpen()) {
    return true;
  }

  if (!isOpenAIRealtimeAvailable()) {
    sendTo(ws, 'openai_error', { error: 'OPENAI_API_KEY not set' });
    return false;
  }

  const toolExecutor = createToolExecutor(baseUrl, ws);
  const bridge = createOpenAIRealtimeBridge({ toolExecutor });

  // Relay audio responses back to browser with 0x04 prefix
  bridge.onAudio((pcmBuffer) => {
    if (ws.readyState === 1 && state.voiceMode === 'openai') {
      const frame = Buffer.alloc(1 + pcmBuffer.length);
      frame[0] = KIND_OPENAI;
      pcmBuffer.copy(frame, 1);
      ws.send(frame);
    }
  });

  bridge.onText((text) => {
    state.openAITextBuffer += text;
    sendTo(ws, 'openai_text', { text, fullText: state.openAITextBuffer });
  });

  bridge.onToolCall((calls) => {
    const names = calls.map(c => c.name);
    sendTo(ws, 'openai_tool_call', { tools: names });
    console.log('[ws] OpenAI tool calls:', names.join(', '));
  });

  bridge.onClose(() => {
    state.openAIBridge = null;
    sendTo(ws, 'voice_mode_changed', { mode: 'computer', reason: 'openai_disconnected' });
  });

  try {
    await bridge.connect();
    state.openAIBridge = bridge;
    state.openAITextBuffer = '';
    console.log('[ws] OpenAI Realtime bridge connected for client');
    return true;
  } catch (err) {
    console.error('[ws] OpenAI bridge connection failed: ' + err.message);
    sendTo(ws, 'openai_error', { error: 'Failed to connect to OpenAI: ' + err.message });
    return false;
  }
}

/**
 * Connect a client to Nova Sonic via Bedrock bidirectional streaming.
 */
async function connectNovaBridge(ws, state, baseUrl, sessionId) {
  if (state.novaBridge && state.novaBridge.isOpen()) return true;

  if (!isNovaSonicAvailable()) {
    sendTo(ws, 'nova_error', { error: 'AWS credentials not configured' });
    return false;
  }

  const toolExecutor = createToolExecutor(baseUrl, ws);
  const bridge = createNovaSonicBridge({ toolExecutor });

  bridge.onAudio((pcmBuffer) => {
    if (ws.readyState === 1 && state.voiceMode === 'nova') {
      const frame = Buffer.alloc(1 + pcmBuffer.length);
      frame[0] = KIND_NOVA;
      pcmBuffer.copy(frame, 1);
      ws.send(frame);
    }
  });

  bridge.onText((text) => {
    state.novaTextBuffer += text;
    sendTo(ws, 'nova_text', { text, fullText: state.novaTextBuffer });
  });

  bridge.onToolCall((calls) => {
    const names = calls.map(c => c.name);
    sendTo(ws, 'nova_tool_call', { tools: names });
    console.log('[ws] Nova tool calls:', names.join(', '));
  });

  bridge.onClose(() => {
    state.novaBridge = null;
    sendTo(ws, 'voice_mode_changed', { mode: 'computer', reason: 'nova_disconnected' });
  });

  try {
    await bridge.connect();
    state.novaBridge = bridge;
    state.novaTextBuffer = '';
    console.log('[ws] Nova Sonic bridge connected for client');
    return true;
  } catch (err) {
    console.error('[ws] Nova bridge connection failed: ' + err.message);
    sendTo(ws, 'nova_error', { error: 'Failed to connect to Nova Sonic: ' + err.message });
    return false;
  }
}

async function switchToComputerMode(ws, state, sessionId, command, baseUrl) {
  state.voiceMode = 'computer';
  sendTo(ws, 'voice_mode_changed', { mode: 'computer', reason: 'wake_word', command });

  try {
    await handleVoiceCommand(ws, sessionId, command, baseUrl);
  } catch (err) {
    console.error('[ws] Computer mode command failed: ' + err.message);
    sendTo(ws, 'voice_error', { error: err.message });
  }

  // Switch back to Moshi mode
  state.voiceMode = 'moshi';
  state.moshiTextBuffer = '';
  sendTo(ws, 'voice_mode_changed', { mode: 'moshi', reason: 'command_complete' });
}

export function initWebSocket(wss, baseUrl) {
  wss.on('connection', (ws, req) => {
    // Auth already verified at HTTP upgrade stage (server/index.js)

    // Assign a session ID for voice conversation history
    const sessionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Initialize per-client state
    const state = { voiceMode: 'computer', moshiBridge: null, moshiTextBuffer: '', geminiBridge: null, geminiTextBuffer: '', openAIBridge: null, openAITextBuffer: '', novaBridge: null, novaTextBuffer: '' };
    clientState.set(ws, state);

    clients.add(ws);
    ws.on('close', () => {
      clients.delete(ws);
      const s = clientState.get(ws);
      if (s?.moshiBridge) { s.moshiBridge.close(); }
      if (s?.geminiBridge) { s.geminiBridge.close(); }
      if (s?.openAIBridge) { s.openAIBridge.close(); }
      if (s?.novaBridge) { s.novaBridge.close(); }
      clientState.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
      const s = clientState.get(ws);
      if (s?.moshiBridge) { s.moshiBridge.close(); }
      if (s?.geminiBridge) { s.geminiBridge.close(); }
      if (s?.openAIBridge) { s.openAIBridge.close(); }
      if (s?.novaBridge) { s.novaBridge.close(); }
      clientState.delete(ws);
    });

    // Handle incoming messages (binary = audio chunk, text = JSON)
    ws.on('message', (message, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(message);
        // In Moshi mode, forward audio directly to Moshi bridge
        if (state.voiceMode === 'moshi' && state.moshiBridge && state.moshiBridge.isOpen()) {
          // Browser sends Opus frames with 0x01 prefix — strip it and forward
          if (buf.length > 1 && buf[0] === KIND_AUDIO) {
            state.moshiBridge.sendAudio(buf.slice(1));
          } else {
            // Raw audio without prefix — forward as-is
            state.moshiBridge.sendAudio(buf);
          }
          return;
        }
        // In Gemini mode, forward raw PCM to Gemini bridge
        if (state.voiceMode === 'gemini' && state.geminiBridge && state.geminiBridge.isOpen()) {
          if (buf.length > 1 && buf[0] === KIND_GEMINI) {
            state.geminiBridge.sendAudio(buf.slice(1));
          } else {
            state.geminiBridge.sendAudio(buf);
          }
          return;
        }
        // In OpenAI mode, forward raw PCM to OpenAI Realtime bridge
        if (state.voiceMode === 'openai' && state.openAIBridge && state.openAIBridge.isOpen()) {
          if (buf.length > 1 && buf[0] === KIND_OPENAI) {
            state.openAIBridge.sendAudio(buf.slice(1));
          } else {
            state.openAIBridge.sendAudio(buf);
          }
          return;
        }
        // In Nova mode, forward raw PCM to Nova Sonic bridge
        if (state.voiceMode === 'nova' && state.novaBridge && state.novaBridge.isOpen()) {
          if (buf.length > 1 && buf[0] === KIND_NOVA) {
            state.novaBridge.sendAudio(buf.slice(1));
          } else {
            state.novaBridge.sendAudio(buf);
          }
          return;
        }
        // In Computer mode, process through Whisper STT pipeline
        console.log(`[ws] Received binary message: ${buf.byteLength} bytes`);
        processChunk(ws, buf);
        return;
      }

      // Parse JSON text messages
      const raw = message.toString();
      console.log(`[ws] Received text message: ${raw.slice(0, 200)}`);
      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case 'voice_command':
            ensureVoiceChecked().then(available => {
              console.log(`[ws] voice_command: "${msg.data?.text}", voiceAvailable: ${available}`);
              if (msg.data?.text && available) {
                handleVoiceCommand(ws, sessionId, msg.data.text, baseUrl).catch(err => {
                  console.error('[ws] Voice command error:', err.message);
                  sendTo(ws, 'voice_error', { error: err.message || 'Voice processing failed' });
                });
              } else if (!available) {
                sendTo(ws, 'voice_error', { error: 'Ollama not available or required model not found. Need: ' + (process.env.VOICE_MODEL || 'llama3.1:8b') });
              }
            });
            break;
          case 'voice_mode': {
            const requestedMode = msg.data?.mode;
            if (requestedMode === 'moshi') {
              // Disconnect Gemini bridge if switching from gemini
              if (state.geminiBridge) { state.geminiBridge.close(); state.geminiBridge = null; }
              connectMoshiBridge(ws, state, baseUrl, sessionId).then(ok => {
                if (ok) {
                  state.voiceMode = 'moshi';
                  state.moshiTextBuffer = '';
                  sendTo(ws, 'voice_mode_changed', { mode: 'moshi' });
                  console.log('[ws] Switched to Moshi mode');
                }
              });
            } else if (requestedMode === 'computer') {
              state.voiceMode = 'computer';
              // Disconnect Moshi bridge if connected
              if (state.moshiBridge) { state.moshiBridge.close(); state.moshiBridge = null; }
              // Disconnect Gemini bridge if connected
              if (state.geminiBridge) { state.geminiBridge.close(); state.geminiBridge = null; }
              sendTo(ws, 'voice_mode_changed', { mode: 'computer' });
              console.log('[ws] Switched to Computer mode');
            } else if (requestedMode === 'gemini') {
              if (state.moshiBridge) { state.moshiBridge.close(); state.moshiBridge = null; }
              if (state.openAIBridge) { state.openAIBridge.close(); state.openAIBridge = null; }
              connectGeminiBridge(ws, state, baseUrl, sessionId).then(ok => {
                if (ok) {
                  state.voiceMode = 'gemini';
                  state.geminiTextBuffer = '';
                  sendTo(ws, 'voice_mode_changed', { mode: 'gemini' });
                  console.log('[ws] Switched to Gemini mode');
                }
              });
            } else if (requestedMode === 'openai') {
              if (state.moshiBridge) { state.moshiBridge.close(); state.moshiBridge = null; }
              if (state.geminiBridge) { state.geminiBridge.close(); state.geminiBridge = null; }
              if (state.novaBridge) { state.novaBridge.close(); state.novaBridge = null; }
              connectOpenAIBridge(ws, state, baseUrl, sessionId).then(ok => {
                if (ok) {
                  state.voiceMode = 'openai';
                  state.openAITextBuffer = '';
                  sendTo(ws, 'voice_mode_changed', { mode: 'openai' });
                  console.log('[ws] Switched to OpenAI Realtime mode');
                }
              });
            } else if (requestedMode === 'nova') {
              if (state.moshiBridge) { state.moshiBridge.close(); state.moshiBridge = null; }
              if (state.geminiBridge) { state.geminiBridge.close(); state.geminiBridge = null; }
              if (state.openAIBridge) { state.openAIBridge.close(); state.openAIBridge = null; }
              connectNovaBridge(ws, state, baseUrl, sessionId).then(ok => {
                if (ok) {
                  state.voiceMode = 'nova';
                  state.novaTextBuffer = '';
                  sendTo(ws, 'voice_mode_changed', { mode: 'nova' });
                  console.log('[ws] Switched to Nova Sonic mode');
                }
              });
            }
            break;
          }
          case 'voice_start':
            console.log('[ws] voice_start received');
            // Auto-connect to Moshi if available
            isMoshiRunning().then(running => {
              if (running) {
                connectMoshiBridge(ws, state, baseUrl, sessionId).then(ok => {
                  if (ok) {
                    state.voiceMode = 'moshi';
                    sendTo(ws, 'voice_mode_changed', { mode: 'moshi' });
                  }
                });
              }
            });
            sendTo(ws, 'status', { message: 'Voice assistant active' });
            break;
          case 'gemini_activity':
            // Explicit VAD signals from the client for Gemini mode
            if (state.geminiBridge && state.geminiBridge.isOpen()) {
              if (msg.data?.action === 'start') {
                state.geminiBridge.activityStart();
              } else if (msg.data?.action === 'end') {
                state.geminiBridge.activityEnd();
              }
            }
            break;
          case 'voice_cancel':
            console.log('[ws] voice_cancel received');
            // Disconnect bridges but intentionally do NOT reset state.voiceMode.
            // The client is still in its current mode — the next voice_start
            // will reconnect the bridge.
            if (state.moshiBridge) { state.moshiBridge.close(); state.moshiBridge = null; }
            if (state.geminiBridge) { state.geminiBridge.close(); state.geminiBridge = null; }
            if (state.openAIBridge) { state.openAIBridge.close(); state.openAIBridge = null; }
            if (state.novaBridge) { state.novaBridge.close(); state.novaBridge = null; }
            sendTo(ws, 'status', { message: 'Voice assistant inactive' });
            break;
          default:
            console.log(`[ws] Unknown message type: ${msg.type}`);
            break;
        }
      } catch (err) {
        console.error('[ws] Failed to parse JSON message:', err.message);
      }
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'status', data: { message: 'Computer online', connected: true } }));
  });

  // Heartbeat every 30s
  setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.ping();
      } else {
        clients.delete(ws);
      }
    }
  }, 30000);
}

export function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}
