/**
 * Config Bridge
 *
 * Reads and writes OpenClaw's configuration from the Computer plugin.
 * Uses clawdbot's compiled dist to access config functions.
 */

import path from 'path';
import { readFileSync, existsSync, watchFile, unwatchFile } from 'fs';

const CLAWDBOT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..', '..', '..', '..', 'clawdbot'
);

let openclawConfig = null;
let configPath = null;
let configWatcher = null;
let changeCallbacks = new Set();

/**
 * Initialize the config bridge by loading OpenClaw's config.
 * Falls back gracefully if clawdbot isn't available.
 */
export async function initConfigBridge() {
  try {
    const { loadConfig, readConfigFileSnapshot } = await import(
      path.join(CLAWDBOT_ROOT, 'dist', 'index.js')
    );

    openclawConfig = loadConfig();

    // Try to find the config file path
    const snapshot = await readConfigFileSnapshot?.().catch(() => null);
    configPath = snapshot?.path || findConfigPath();

    console.log('[config-bridge] OpenClaw config loaded');
    return openclawConfig;
  } catch (err) {
    console.warn('[config-bridge] Failed to load OpenClaw config:', err.message);
    openclawConfig = null;
    return null;
  }
}

/**
 * Get the current OpenClaw configuration.
 */
export function getOpenClawConfig() {
  return openclawConfig;
}

/**
 * Get the config file path.
 */
export function getConfigPath() {
  return configPath;
}

/**
 * Update OpenClaw configuration by patching values.
 */
export async function updateConfig(patch) {
  try {
    const { writeConfigFile } = await import(
      path.join(CLAWDBOT_ROOT, 'dist', 'index.js')
    );
    await writeConfigFile(patch);

    // Reload after write
    await initConfigBridge();
    return { ok: true };
  } catch (err) {
    console.error('[config-bridge] Config update failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Watch the config file for external changes.
 */
export function watchConfigChanges(callback) {
  changeCallbacks.add(callback);

  if (!configWatcher && configPath && existsSync(configPath)) {
    watchFile(configPath, { interval: 2000 }, () => {
      console.log('[config-bridge] Config file changed externally, reloading...');
      initConfigBridge().then(() => {
        for (const cb of changeCallbacks) {
          try { cb(openclawConfig); } catch { /* ignore */ }
        }
      });
    });
    configWatcher = true;
  }

  return () => {
    changeCallbacks.delete(callback);
    if (changeCallbacks.size === 0 && configWatcher && configPath) {
      unwatchFile(configPath);
      configWatcher = false;
    }
  };
}

/**
 * Get a summary of the config for the LCARS dashboard.
 */
export function getConfigSummary() {
  if (!openclawConfig) {
    return { available: false };
  }

  const cfg = openclawConfig;
  return {
    available: true,
    configPath,
    gateway: {
      port: cfg.gateway?.port,
      bind: cfg.gateway?.bind,
      auth: cfg.gateway?.auth ? 'configured' : 'none',
    },
    channels: Object.keys(cfg.channels || {}).length,
    agents: cfg.agents?.list?.length || 0,
    logging: {
      level: cfg.logging?.level || 'info',
      redactSensitive: cfg.logging?.redactSensitive || 'tools',
      redactOutbound: cfg.logging?.redactOutbound || 'messages',
    },
  };
}

function findConfigPath() {
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH,
    path.join(process.env.HOME || '', '.config', 'openclaw', 'config.yaml'),
    path.join(process.env.HOME || '', '.config', 'openclaw', 'config.json'),
    path.join(process.env.HOME || '', '.config', 'openclaw', 'config.json5'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
