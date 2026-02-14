import fs from 'fs/promises';
import path from 'path';
import { generateId, timestamp } from '../utils/helpers.js';

let dataDir;

export async function initStorage(pluginRoot) {
  dataDir = path.join(pluginRoot, 'data');
  const dirs = ['transcripts', 'analyses', 'sessions'];
  for (const dir of dirs) {
    await fs.mkdir(path.join(dataDir, dir), { recursive: true });
  }
}

async function listItems(subdir) {
  const dir = path.join(dataDir, subdir);
  try {
    const files = await fs.readdir(dir);
    const items = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const content = await fs.readFile(path.join(dir, file), 'utf-8');
      items.push(JSON.parse(content));
    }
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return items;
  } catch {
    return [];
  }
}

async function getItem(subdir, id) {
  const filePath = path.join(dataDir, subdir, `${id}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function saveItem(subdir, data) {
  const item = {
    id: data.id || generateId(),
    timestamp: data.timestamp || timestamp(),
    ...data,
  };
  const filePath = path.join(dataDir, subdir, `${item.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(item, null, 2));
  return item;
}

export const transcripts = {
  list: () => listItems('transcripts'),
  get: (id) => getItem('transcripts', id),
  save: (data) => saveItem('transcripts', { type: 'transcript', ...data }),
};

export const analyses = {
  list: () => listItems('analyses'),
  get: (id) => getItem('analyses', id),
  save: (data) => saveItem('analyses', { type: 'analysis', ...data }),
};

export const sessions = {
  list: () => listItems('sessions'),
  get: (id) => getItem('sessions', id),
  save: (data) => saveItem('sessions', { type: 'session', ...data }),
};
