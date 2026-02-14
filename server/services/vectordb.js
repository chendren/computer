import { connect } from '@lancedb/lancedb';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { embed, embedBatch } from './embeddings.js';
import { chunk } from './chunking.js';

let db;
let chunksTable;
let entriesTable;

const VECTOR_DIM = 768;

/**
 * Initialize the vector database.
 */
export async function initVectorDB(pluginRoot) {
  const dbPath = path.join(pluginRoot, 'data', 'vectordb');
  await fs.mkdir(dbPath, { recursive: true });
  db = await connect(dbPath);

  const tableNames = await db.tableNames();

  if (tableNames.includes('knowledge_chunks')) {
    chunksTable = await db.openTable('knowledge_chunks');
  }
  if (tableNames.includes('knowledge_entries')) {
    entriesTable = await db.openTable('knowledge_entries');
  }

  // Migrate any existing JSON knowledge entries
  const knowledgeDir = path.join(pluginRoot, 'data', 'knowledge');
  await migrateFromJSON(knowledgeDir);

  console.log('  Vector DB initialized');
}

/**
 * Ensure the chunks table exists (created on first insert).
 */
async function ensureChunksTable(firstRow) {
  if (!chunksTable) {
    chunksTable = await db.createTable('knowledge_chunks', [firstRow]);
    return true; // Row was already inserted
  }
  return false;
}

/**
 * Ensure the entries table exists (created on first insert).
 */
async function ensureEntriesTable(firstRow) {
  if (!entriesTable) {
    entriesTable = await db.createTable('knowledge_entries', [firstRow]);
    return true;
  }
  return false;
}

/**
 * Ingest a document: chunk it, embed chunks, store in both tables.
 * @returns {object} Entry metadata with chunk_count
 */
export async function ingestEntry({
  text,
  title,
  source = 'user',
  confidence = 'medium',
  tags = [],
  content_type = 'document',
  chunk_strategy = 'paragraph',
  chunk_options = {},
  created_at,
}) {
  const parentId = uuidv4();
  const now = created_at || new Date().toISOString();

  // Chunk the text
  const chunks = await chunk(text, chunk_strategy, chunk_options);
  if (chunks.length === 0) {
    throw new Error('No chunks produced from input text');
  }

  // Embed all chunks
  const chunkTexts = chunks.map(c => c.text);
  const embeddings = await embedBatch(chunkTexts);

  // Build chunk rows (use plain arrays for vectors)
  const chunkRows = chunks.map((c, i) => ({
    id: uuidv4(),
    parent_id: parentId,
    text: c.text,
    vector: Array.from(embeddings[i]),
    chunk_index: i,
    chunk_count: chunks.length,
    chunk_strategy,
    chunk_level: c.metadata.level || '',
    title: title || text.slice(0, 80),
    source,
    confidence,
    tags: JSON.stringify(tags),
    content_type,
    created_at: now,
    updated_at: now,
  }));

  // Build entry row
  const entryRow = {
    id: parentId,
    title: title || text.slice(0, 80),
    original_text: text,
    source,
    confidence,
    tags: JSON.stringify(tags),
    content_type,
    chunk_strategy,
    chunk_count: chunks.length,
    created_at: now,
    updated_at: now,
  };

  // Insert into tables (create on first use)
  const chunksCreated = await ensureChunksTable(chunkRows[0]);
  if (!chunksCreated && chunkRows.length > 0) {
    await chunksTable.add(chunkRows);
  } else if (chunksCreated && chunkRows.length > 1) {
    await chunksTable.add(chunkRows.slice(1));
  }

  const entriesCreated = await ensureEntriesTable(entryRow);
  if (!entriesCreated) {
    await entriesTable.add([entryRow]);
  }

  return {
    id: parentId,
    title: entryRow.title,
    chunk_count: chunks.length,
    chunk_strategy,
    source,
    confidence,
    tags,
    created_at: now,
  };
}

/**
 * Delete an entry and all its chunks.
 */
export async function deleteEntry(parentId) {
  if (chunksTable) {
    await chunksTable.delete(`parent_id = '${parentId}'`);
  }
  if (entriesTable) {
    await entriesTable.delete(`id = '${parentId}'`);
  }
}

/**
 * Get a single entry with its chunks (no vectors in response).
 */
export async function getEntry(parentId) {
  if (!entriesTable) return null;

  const entries = await entriesTable.query()
    .where(`id = '${parentId}'`)
    .limit(1)
    .toArray();

  if (entries.length === 0) return null;

  const entry = entries[0];
  entry.tags = JSON.parse(entry.tags || '[]');

  let chunks = [];
  if (chunksTable) {
    chunks = await chunksTable.query()
      .where(`parent_id = '${parentId}'`)
      .limit(1000)
      .toArray();
    // Strip vectors from response
    chunks = chunks.map(({ vector, ...rest }) => ({
      ...rest,
      tags: JSON.parse(rest.tags || '[]'),
    }));
    chunks.sort((a, b) => a.chunk_index - b.chunk_index);
  }

  return { ...entry, chunks };
}

/**
 * List entries (paginated).
 */
export async function listEntries({ offset = 0, limit = 50 } = {}) {
  if (!entriesTable) return { entries: [], total: 0 };

  const total = await entriesTable.countRows();
  const entries = await entriesTable.query()
    .limit(limit + offset)
    .toArray();

  // Sort by created_at desc, apply offset
  entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const paged = entries.slice(offset, offset + limit).map(e => ({
    ...e,
    tags: JSON.parse(e.tags || '[]'),
  }));

  return { entries: paged, total };
}

/**
 * Get the chunks table for search operations.
 */
export function getChunksTable() {
  return chunksTable;
}

/**
 * Get statistics about the knowledge base.
 */
export async function getStats() {
  const totalEntries = entriesTable ? await entriesTable.countRows() : 0;
  const totalChunks = chunksTable ? await chunksTable.countRows() : 0;

  let byStrategy = {};
  let bySource = {};
  let byConfidence = {};

  if (entriesTable && totalEntries > 0) {
    const allEntries = await entriesTable.query().limit(100000).toArray();
    for (const e of allEntries) {
      byStrategy[e.chunk_strategy] = (byStrategy[e.chunk_strategy] || 0) + 1;
      bySource[e.source] = (bySource[e.source] || 0) + 1;
      byConfidence[e.confidence] = (byConfidence[e.confidence] || 0) + 1;
    }
  }

  // Estimate DB size
  let dbSizeBytes = 0;
  try {
    const dbPath = path.dirname((await db.getStorageOptions?.()) || '');
    // Approximate from table count
    dbSizeBytes = totalChunks * 3200; // ~3KB per chunk row estimate
  } catch {}

  return {
    total_entries: totalEntries,
    total_chunks: totalChunks,
    avg_chunks_per_entry: totalEntries > 0 ? +(totalChunks / totalEntries).toFixed(1) : 0,
    by_strategy: byStrategy,
    by_source: bySource,
    by_confidence: byConfidence,
    embedding_model: 'nomic-embed-text',
    vector_dimensions: VECTOR_DIM,
  };
}

/**
 * Migrate existing JSON knowledge files to vector DB.
 */
async function migrateFromJSON(knowledgeDir) {
  let files;
  try {
    files = await fs.readdir(knowledgeDir);
  } catch {
    return;
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  let migrated = 0;
  for (const file of jsonFiles) {
    try {
      const content = JSON.parse(await fs.readFile(path.join(knowledgeDir, file), 'utf-8'));
      const text = content.fact || content.text || JSON.stringify(content);

      await ingestEntry({
        text,
        title: (content.fact || content.text || '').slice(0, 80) || 'Migrated entry',
        source: content.source || 'user',
        confidence: content.confidence || 'medium',
        tags: content.tags || [],
        content_type: 'fact',
        chunk_strategy: 'sentence',
        created_at: content.timestamp,
      });

      await fs.rename(
        path.join(knowledgeDir, file),
        path.join(knowledgeDir, file + '.migrated')
      );
      migrated++;
    } catch (err) {
      console.error(`  Failed to migrate ${file}:`, err.message);
    }
  }

  if (migrated > 0) {
    console.log(`  Migrated ${migrated} knowledge entries to vector DB`);
  }
}
