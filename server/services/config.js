/**
 * Local configuration service — replaces OpenClaw config-bridge.
 * Stores config in data/config.json.
 */
import fs from 'fs/promises';
import path from 'path';

let configPath;
let config = {};

export async function initConfig(pluginRoot) {
  configPath = path.join(pluginRoot, 'data', 'config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    config = {};
    await _persist();
  }
}

export function getConfig(key) {
  if (!key) return config;
  const parts = key.split('.');
  let current = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

export function setConfig(key, value) {
  if (!key) return;
  const parts = key.split('.');
  let current = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  _persist().catch(() => {});
  return config;
}

export function getConfigSummary() {
  const channels = config.channels ? Object.keys(config.channels).length : 0;
  return {
    mode: 'local',
    channels,
    agents: 0,
    logging: config.logging || 'info',
  };
}

async function _persist() {
  if (!configPath) return;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}
