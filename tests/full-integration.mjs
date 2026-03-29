#!/usr/bin/env node
/**
 * LCARS Full Integration Test — "Be Chad" Mode
 *
 * Simulates a real user exercising every major subsystem:
 *   1. System health & infrastructure
 *   2. Kokoro TTS — generate speech, verify WAV
 *   3. Voxtral STT — transcribe audio, verify text
 *   4. TTS→STT round-trip — speak then listen, compare
 *   5. Knowledge base — store, search, retrieve, delete
 *   6. Voice pipeline — status, config, providers
 *   7. Gateway — status, sessions, nodes, models, cron, plugins
 *   8. Data APIs — logs, analyses, monitors, comparisons
 *   9. Security — stats, scan verification
 *  10. Browser UI (Playwright) — LCARS loads, panels render, WebSocket connects
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const BASE = 'http://localhost:3141';
const TOKEN = fs.readFileSync(path.join(PLUGIN_ROOT, 'data', '.auth-token'), 'utf-8').trim();
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// ── Test harness ──────────────────────────────────────────

const results = [];
let sectionName = '';

function section(name) {
  sectionName = name;
  results.push({ type: 'section', name });
}

function pass(test, detail = '') {
  results.push({ type: 'pass', section: sectionName, test, detail });
}

function fail(test, detail = '') {
  results.push({ type: 'fail', section: sectionName, test, detail });
}

function skip(test, detail = '') {
  results.push({ type: 'skip', section: sectionName, test, detail });
}

async function api(method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: { ...AUTH, 'Content-Type': 'application/json', ...extraHeaders },
    signal: AbortSignal.timeout(15000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ok: res.ok };
}

async function apiRaw(method, path, buffer, contentType, extraHeaders = {}) {
  const opts = {
    method,
    headers: { ...AUTH, 'Content-Type': contentType, ...extraHeaders },
    body: buffer,
    signal: AbortSignal.timeout(30000),
  };
  const res = await fetch(BASE + path, opts);
  return { status: res.status, ok: res.ok, res };
}

// ── 1. System Health ──────────────────────────────────────

async function testHealth() {
  section('System Health');
  try {
    const { data } = await api('GET', '/api/health');
    data.status === 'online' ? pass('Server status', 'online') : fail('Server status', data.status);
    data.vectordb === 'online' ? pass('VectorDB (LanceDB)', 'online') : fail('VectorDB', data.vectordb);
    pass('Uptime', `${Math.floor(data.uptime)}s`);
    data.voxtralStt ? pass('Voxtral STT registered', `port ${data.voxtralStt.port}, ready=${data.voxtralStt.ready}`) : fail('Voxtral STT', 'missing from health');
    data.moshi ? pass('Moshi S2S registered', `running=${data.moshi.running}`) : skip('Moshi', 'not in health');
    data.gateway?.connected ? pass('Gateway', `mode=${data.gateway.mode}`) : fail('Gateway', 'not connected');
    data.authToken ? pass('Auth token present', data.authToken.slice(0, 8) + '...') : fail('Auth token', 'missing');
  } catch (e) {
    fail('Health endpoint', e.message);
  }
}

// ── 2. Kokoro TTS ─────────────────────────────────────────

let ttsWavPath = null;

async function testTTS() {
  section('Kokoro TTS');
  try {
    // Providers
    const prov = await api('GET', '/api/tts/providers');
    const kokoro = prov.data?.providers?.find(p => p.id === 'kokoro');
    kokoro ? pass('Provider: Kokoro', `available=${kokoro.available}`) : fail('Provider', 'Kokoro not listed');

    // Voices
    const voices = await api('GET', '/api/tts/voices');
    const count = voices.data?.voices?.length || 0;
    count > 0 ? pass('Voices listed', `${count} voices`) : fail('Voices', 'none listed');

    // Speak
    const text = 'All hands, this is the bridge. Warp engines are online.';
    const start = Date.now();
    const speak = await api('POST', '/api/tts/speak', { text, voice: 'af_heart' });
    const elapsed = Date.now() - start;

    if (speak.ok && speak.data?.audioUrl) {
      pass('Speech synthesis', `${elapsed}ms, url=${speak.data.audioUrl}`);
      pass('Provider confirmed', speak.data.provider);

      // Download the WAV to verify and use for STT
      const wavRes = await fetch(BASE + speak.data.audioUrl, { headers: AUTH });
      if (wavRes.ok) {
        const wavBuf = Buffer.from(await wavRes.arrayBuffer());
        ttsWavPath = '/tmp/lcars-tts-test.wav';
        fs.writeFileSync(ttsWavPath, wavBuf);
        pass('WAV download', `${wavBuf.length} bytes, saved for STT round-trip`);
      } else {
        fail('WAV download', `status ${wavRes.status}`);
      }
    } else {
      fail('Speech synthesis', speak.data?.error || `status ${speak.status}`);
    }

    // Edge: too-long text
    const longText = 'A'.repeat(501);
    const longRes = await api('POST', '/api/tts/speak', { text: longText });
    longRes.status === 400 ? pass('Max length guard', 'rejects >500 chars') : fail('Max length guard', `status ${longRes.status}`);

  } catch (e) {
    fail('TTS test', e.message);
  }
}

// ── 3. Voxtral STT ───────────────────────────────────────

async function testSTT() {
  section('Voxtral STT');
  try {
    // Providers
    const prov = await api('GET', '/api/transcribe/providers');
    const voxtral = prov.data?.providers?.find(p => p.id === 'voxtral');
    voxtral ? pass('Provider: Voxtral', `source=${voxtral.source}`) : fail('Provider', 'Voxtral not listed');

    // Sidecar health (direct)
    try {
      const health = await fetch('http://127.0.0.1:8997/health', { signal: AbortSignal.timeout(3000) });
      const hdata = await health.json();
      hdata.status === 'ready'
        ? pass('Sidecar health', `model loaded in ${hdata.model_load_time}s, ${hdata.peak_memory_gb}GB`)
        : fail('Sidecar health', hdata.status);
    } catch (e) {
      fail('Sidecar health', e.message);
    }
  } catch (e) {
    fail('STT test', e.message);
  }
}

// ── 4. TTS → STT Round-Trip ──────────────────────────────

async function testRoundTrip() {
  section('TTS → STT Round-Trip');
  if (!ttsWavPath || !fs.existsSync(ttsWavPath)) {
    skip('Round-trip', 'No TTS WAV available');
    return;
  }

  try {
    const wavBuf = fs.readFileSync(ttsWavPath);

    // Send directly to the Voxtral sidecar (bypass multer for raw buffer)
    const start = Date.now();
    const res = await fetch('http://127.0.0.1:8997/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Language': 'en', 'X-Max-Tokens': '128' },
      body: wavBuf,
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = Date.now() - start;
    const data = await res.json();

    if (data.text) {
      const original = 'All hands, this is the bridge. Warp engines are online.';
      const transcript = data.text.trim();
      // Check if key words survived the round-trip
      const keyWords = ['hands', 'bridge', 'warp', 'engines', 'online'];
      const matched = keyWords.filter(w => transcript.toLowerCase().includes(w));
      const accuracy = Math.round((matched.length / keyWords.length) * 100);

      pass('Transcription returned', `"${transcript}"`);
      pass('Round-trip latency', `${elapsed}ms (${data.generation_tokens} tokens, ${data.generation_tps?.toFixed(1)} tok/s)`);
      accuracy >= 60
        ? pass('Keyword accuracy', `${accuracy}% (${matched.length}/${keyWords.length}: ${matched.join(', ')})`)
        : fail('Keyword accuracy', `${accuracy}% — only matched: ${matched.join(', ')}`);
    } else {
      fail('Transcription', data.error || 'empty text');
    }
  } catch (e) {
    fail('Round-trip', e.message);
  }
}

// ── 5. Knowledge Base ─────────────────────────────────────

async function testKnowledge() {
  section('Knowledge Base');
  try {
    // Store
    const storeRes = await api('POST', '/api/knowledge', {
      text: 'The USS Enterprise NCC-1701-D has a maximum warp speed of warp 9.6 and is a Galaxy-class starship.',
      title: 'Enterprise Specs (test)',
      tags: ['test', 'enterprise'],
    });
    const entryId = storeRes.data?.id;
    storeRes.ok ? pass('Store entry', `id=${entryId}`) : fail('Store entry', storeRes.data?.error);

    // Stats
    const stats = await api('GET', '/api/knowledge/stats');
    stats.ok ? pass('DB stats', `${stats.data?.totalEntries || '?'} entries`) : fail('DB stats', 'failed');

    // Search
    const search = await api('POST', '/api/knowledge/search', { query: 'Enterprise warp speed', limit: 3 });
    if (search.ok && search.data?.results?.length > 0) {
      const top = search.data.results[0];
      pass('Vector search', `${search.data.results.length} results, top score=${top.score?.toFixed(3) || '?'}`);
    } else {
      fail('Vector search', 'no results');
    }

    // Cleanup
    if (entryId) {
      const del = await api('DELETE', `/api/knowledge/${entryId}`);
      del.ok ? pass('Delete entry', 'cleaned up test data') : fail('Delete entry', del.data?.error);
    }
  } catch (e) {
    fail('Knowledge base', e.message);
  }
}

// ── 6. Voice Pipeline ─────────────────────────────────────

async function testVoicePipeline() {
  section('Voice Pipeline');
  try {
    const status = await api('GET', '/api/voice/status');
    if (status.ok) {
      pass('Voice status', `available=${status.data.available}, provider=${status.data.provider}`);
      status.data.stt ? pass('STT info', `provider=${status.data.stt.provider}, ready=${status.data.stt.ready}`) : fail('STT info', 'missing');
      status.data.tts ? pass('TTS info', `provider=${status.data.tts.provider}`) : fail('TTS info', 'missing');
      pass('Features', status.data.features?.join(', '));
    } else {
      fail('Voice status', `status ${status.status}`);
    }

    const config = await api('GET', '/api/voice/config');
    if (config.ok) {
      pass('Voice config', `wakeWord="${config.data.wakeWord}", modes: ${Object.keys(config.data.modes || {}).join(', ')}`);
    } else {
      fail('Voice config', `status ${config.status}`);
    }
  } catch (e) {
    fail('Voice pipeline', e.message);
  }
}

// ── 7. Gateway & Infrastructure ──────────────────────────

async function testGateway() {
  section('Gateway & Infrastructure');
  const endpoints = [
    ['GET', '/api/gateway/status', 'Gateway status'],
    ['GET', '/api/gateway/sessions', 'Sessions'],
    ['GET', '/api/gateway/nodes', 'Nodes'],
    ['GET', '/api/gateway/models', 'Models'],
    ['GET', '/api/gateway/cron', 'Cron jobs'],
    ['GET', '/api/gateway/plugins', 'Plugins'],
    ['GET', '/api/gateway/channels', 'Channels'],
  ];

  for (const [method, path, label] of endpoints) {
    try {
      const res = await api(method, path);
      if (res.ok) {
        const detail = JSON.stringify(res.data).slice(0, 120);
        pass(label, detail);
      } else {
        fail(label, `status ${res.status}`);
      }
    } catch (e) {
      fail(label, e.message);
    }
  }
}

// ── 8. Data APIs ──────────────────────────────────────────

async function testDataAPIs() {
  section('Data APIs');

  // Captain's Log — write then read
  try {
    const logRes = await api('POST', '/api/logs', { text: 'Integration test log entry — stardate automated.', source: 'test' });
    logRes.ok ? pass("Captain's Log (write)", `id=${logRes.data?.id}`) : fail("Captain's Log", logRes.data?.error);
    const logs = await api('GET', '/api/logs');
    logs.ok ? pass("Captain's Log (read)", `${logs.data?.length || 0} entries`) : fail("Captain's Log (read)", 'failed');
  } catch (e) {
    fail("Captain's Log", e.message);
  }

  // Analyses
  try {
    const analyses = await api('GET', '/api/analyses');
    analyses.ok ? pass('Analyses list', `${analyses.data?.length || 0} entries`) : fail('Analyses', `status ${analyses.status}`);
  } catch (e) {
    fail('Analyses', e.message);
  }

  // Monitors
  try {
    const monitors = await api('GET', '/api/monitors');
    monitors.ok ? pass('Monitors list', `${monitors.data?.length || 0} monitors`) : fail('Monitors', `status ${monitors.status}`);
  } catch (e) {
    fail('Monitors', e.message);
  }

  // Comparisons
  try {
    const comps = await api('GET', '/api/comparisons');
    comps.ok ? pass('Comparisons list', `${comps.data?.length || 0} entries`) : fail('Comparisons', `status ${comps.status}`);
  } catch (e) {
    fail('Comparisons', e.message);
  }

  // Transcripts
  try {
    const trans = await api('GET', '/api/transcripts');
    trans.ok ? pass('Transcripts list', `${trans.data?.length || 0} entries`) : fail('Transcripts', `status ${trans.status}`);
  } catch (e) {
    fail('Transcripts', e.message);
  }

  // Sessions
  try {
    const sess = await api('GET', '/api/sessions');
    sess.ok ? pass('Sessions list', `${sess.data?.length || 0} sessions`) : fail('Sessions', `status ${sess.status}`);
  } catch (e) {
    fail('Sessions', e.message);
  }
}

// ── 9. Security ───────────────────────────────────────────

async function testSecurity() {
  section('Security');
  try {
    const stats = await api('GET', '/api/security/stats');
    if (stats.ok) {
      pass('Security stats', JSON.stringify(stats.data).slice(0, 200));
    } else {
      fail('Security stats', `status ${stats.status}`);
    }

    // Verify auth is enforced — request without token should fail
    try {
      const noAuth = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
      // The health endpoint is special — may allow unauthenticated
      // Test a protected endpoint instead
      const noAuthApi = await fetch(BASE + '/api/logs', { signal: AbortSignal.timeout(3000) });
      noAuthApi.status === 401 ? pass('Auth enforcement', 'Unauthenticated request rejected (401)') : fail('Auth enforcement', `got status ${noAuthApi.status}`);
    } catch (e) {
      fail('Auth enforcement', e.message);
    }
  } catch (e) {
    fail('Security', e.message);
  }
}

// ── 10. Gateway Extras ────────────────────────────────────

async function testGatewayExtras() {
  section('Gateway Extras');
  const extras = [
    ['GET', '/api/gateway/agents', 'Agents'],
    ['GET', '/api/gateway/tools', 'Tools'],
    ['GET', '/api/gateway/hooks', 'Hooks'],
    ['GET', '/api/gateway/tts-providers', 'TTS Providers (gateway)'],
    ['GET', '/api/gateway/stt-providers', 'STT Providers (gateway)'],
    ['GET', '/api/gateway/tts-voices', 'TTS Voices (gateway)'],
    ['GET', '/api/gateway/oauth/status', 'OAuth status'],
  ];

  for (const [method, epath, label] of extras) {
    try {
      const res = await api(method, epath);
      res.ok ? pass(label, JSON.stringify(res.data).slice(0, 100)) : fail(label, `status ${res.status}`);
    } catch (e) {
      fail(label, e.message);
    }
  }
}

// ── 11. Browser UI (Playwright) ───────────────────────────

async function testBrowserUI() {
  section('Browser UI (Playwright)');
  let browser, page;
  try {
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();

    // Navigate
    const start = Date.now();
    const response = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const loadTime = Date.now() - start;
    response.ok() ? pass('Page load', `${loadTime}ms, status ${response.status()}`) : fail('Page load', `status ${response.status()}`);

    // Check title
    const title = await page.title();
    pass('Page title', `"${title}"`);

    // Check LCARS panels exist
    const panels = await page.evaluate(() => {
      const panelIds = ['analysis-panel', 'transcript-panel', 'chart-panel', 'search-panel',
                        'knowledge-panel', 'log-panel', 'monitor-panel', 'compare-panel',
                        'voice-panel', 'channels-panel'];
      const found = [];
      for (const id of panelIds) {
        if (document.getElementById(id)) found.push(id);
      }
      return found;
    });
    panels.length > 0 ? pass('LCARS panels', `${panels.length} found: ${panels.join(', ')}`) : fail('LCARS panels', 'none found');

    // Check WebSocket connection
    const wsConnected = await page.evaluate(async () => {
      // Wait a moment for WS to connect
      await new Promise(r => setTimeout(r, 2000));
      // Check if the app has a WebSocket reference
      const wsIndicators = document.querySelectorAll('[class*="connected"], [class*="online"], [data-ws]');
      return wsIndicators.length > 0 || document.body.innerHTML.includes('ONLINE');
    });
    wsConnected ? pass('WebSocket / UI status', 'connected indicators found') : skip('WebSocket', 'no visible indicators (may use different pattern)');

    // Take screenshot
    const ssPath = '/tmp/lcars-test-screenshot.png';
    await page.screenshot({ path: ssPath, fullPage: true });
    pass('Screenshot captured', ssPath);

    // Check CSS loads (LCARS styling)
    const hasStyles = await page.evaluate(() => {
      const sheets = document.styleSheets;
      return sheets.length > 0;
    });
    hasStyles ? pass('CSS loaded', 'stylesheets present') : fail('CSS', 'no stylesheets');

    // Check JS loaded
    const jsWorking = await page.evaluate(() => {
      return typeof fetch === 'function' && typeof WebSocket === 'function';
    });
    jsWorking ? pass('JS runtime', 'fetch + WebSocket available') : fail('JS runtime', 'missing APIs');

  } catch (e) {
    if (e.message.includes('Cannot find module') || e.message.includes('playwright')) {
      skip('Browser UI', 'Playwright not installed — run: npx playwright install chromium');
    } else {
      fail('Browser UI', e.message);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Report ────────────────────────────────────────────────

function printReport() {
  const line = '═'.repeat(70);
  const thin = '─'.repeat(70);
  console.log();
  console.log(line);
  console.log('  LCARS COMPUTER — FULL INTEGRATION TEST READOUT');
  console.log('  Simulated User: Chad Hendren (AWS Principal SA)');
  console.log('  Date: ' + new Date().toISOString());
  console.log(line);

  let passes = 0, fails = 0, skips = 0;
  let currentSection = '';

  for (const r of results) {
    if (r.type === 'section') {
      console.log();
      console.log(`  ┌${'─'.repeat(68)}┐`);
      console.log(`  │  ${r.name.padEnd(65)}│`);
      console.log(`  └${'─'.repeat(68)}┘`);
      currentSection = r.name;
      continue;
    }

    const icon = r.type === 'pass' ? '  ✓' : r.type === 'fail' ? '  ✗' : '  ○';
    const color = r.type === 'pass' ? '\x1b[32m' : r.type === 'fail' ? '\x1b[31m' : '\x1b[33m';
    const reset = '\x1b[0m';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`${color}${icon} ${r.test}${reset}${detail}`);

    if (r.type === 'pass') passes++;
    else if (r.type === 'fail') fails++;
    else skips++;
  }

  console.log();
  console.log(line);
  const total = passes + fails + skips;
  const pct = total > 0 ? Math.round((passes / total) * 100) : 0;
  console.log(`  RESULTS: ${passes} passed, ${fails} failed, ${skips} skipped (${total} total, ${pct}%)`);

  if (fails === 0) {
    console.log('  STATUS: \x1b[32m■ ALL SYSTEMS NOMINAL\x1b[0m');
  } else if (fails <= 3) {
    console.log('  STATUS: \x1b[33m■ MINOR ISSUES DETECTED\x1b[0m');
  } else {
    console.log('  STATUS: \x1b[31m■ ATTENTION REQUIRED\x1b[0m');
  }
  console.log(line);
  console.log();
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  console.log('\n  LCARS Integration Test — initiating full diagnostic sweep...\n');

  await testHealth();
  await testTTS();
  await testSTT();
  await testRoundTrip();
  await testKnowledge();
  await testVoicePipeline();
  await testGateway();
  await testDataAPIs();
  await testSecurity();
  await testGatewayExtras();
  await testBrowserUI();

  printReport();
  process.exit(results.some(r => r.type === 'fail') ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
