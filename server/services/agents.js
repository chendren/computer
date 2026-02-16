/**
 * Agents service — reads agent definitions from agents/*.md files.
 */
import fs from 'fs/promises';
import path from 'path';

let agentsDir;
let configPath;
let cachedAgents = [];
let agentConfig = {};

export async function initAgents(pluginRoot) {
  agentsDir = path.join(pluginRoot, 'agents');
  configPath = path.join(pluginRoot, 'data', 'agents-config.json');

  // Load agent config overrides
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    agentConfig = JSON.parse(raw);
  } catch {
    agentConfig = {};
  }

  // Scan agent markdown files
  try {
    const files = await fs.readdir(agentsDir);
    cachedAgents = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3); // strip .md
      try {
        const content = await fs.readFile(path.join(agentsDir, file), 'utf-8');
        const frontmatter = _parseFrontmatter(content);
        // Extract title from frontmatter, heading, or filename
        let name = id.split('-').join(' ');
        if (frontmatter.name) {
          name = frontmatter.name;
        } else {
          const firstLine = content.split('\n')[0] || '';
          if (firstLine.startsWith('#')) {
            name = _stripHeadingPrefix(firstLine);
          }
        }
        const overrides = agentConfig[id] || {};
        cachedAgents.push({
          id,
          name: overrides.name || name,
          description: overrides.description || frontmatter.description || _extractDescription(content),
          model: overrides.model || frontmatter.model || 'default',
          enabled: overrides.enabled !== false,
          file,
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    cachedAgents = [];
  }
}

export function listAgents() {
  return cachedAgents;
}

export async function getAgent(id) {
  const agent = cachedAgents.find(a => a.id === id);
  if (!agent) return null;
  try {
    const content = await fs.readFile(path.join(agentsDir, agent.file), 'utf-8');
    return { ...agent, content };
  } catch {
    return agent;
  }
}

export async function configureAgent(id, updates) {
  agentConfig[id] = { ...(agentConfig[id] || {}), ...updates };
  try {
    await fs.writeFile(configPath, JSON.stringify(agentConfig, null, 2));
  } catch {}
  // Update cached agent
  const idx = cachedAgents.findIndex(a => a.id === id);
  if (idx !== -1) {
    if (updates.name) cachedAgents[idx].name = updates.name;
    if (updates.description) cachedAgents[idx].description = updates.description;
    if (updates.model) cachedAgents[idx].model = updates.model;
    if (updates.enabled !== undefined) cachedAgents[idx].enabled = updates.enabled;
  }
  return agentConfig[id];
}

function _parseFrontmatter(content) {
  // Parse simple YAML frontmatter between --- delimiters
  const result = {};
  if (!content.startsWith('---')) return result;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return result;
  const block = content.slice(3, endIdx).trim();
  const lines = block.split('\n');
  let currentKey = null;
  let currentValue = '';
  for (const line of lines) {
    // Check if this is a new key: value pair (not indented)
    if (line.length > 0 && line[0] !== ' ' && line.indexOf(':') !== -1) {
      // Save previous key
      if (currentKey) result[currentKey] = currentValue.trim();
      const colonIdx = line.indexOf(':');
      currentKey = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      // Handle YAML block scalar indicator (|)
      currentValue = val === '|' ? '' : val;
    } else if (currentKey && line.startsWith('  ')) {
      // Continuation of multi-line value
      currentValue += (currentValue ? ' ' : '') + line.trim();
    }
  }
  if (currentKey) result[currentKey] = currentValue.trim();
  return result;
}

function _stripHeadingPrefix(line) {
  // Remove leading # characters and spaces: "## Foo Bar" -> "Foo Bar"
  let i = 0;
  while (i < line.length && line[i] === '#') i++;
  return line.slice(i).trim();
}

function _extractDescription(content) {
  // Get first non-heading, non-empty line as description
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    return trimmed.slice(0, 200);
  }
  return '';
}
