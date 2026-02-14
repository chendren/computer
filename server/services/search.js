import { embed, embedBatch, cosineSimilarity } from './embeddings.js';
import { getChunksTable } from './vectordb.js';

/**
 * Build a LanceDB WHERE clause from metadata filters.
 */
function buildWhereClause(filters) {
  const clauses = [];
  if (filters.source) clauses.push(`source = '${filters.source}'`);
  if (filters.confidence) clauses.push(`confidence = '${filters.confidence}'`);
  if (filters.content_type) clauses.push(`content_type = '${filters.content_type}'`);
  if (filters.date_range?.from) clauses.push(`created_at >= '${filters.date_range.from}'`);
  if (filters.date_range?.to) clauses.push(`created_at <= '${filters.date_range.to}'`);
  // Tags are JSON-encoded strings — use LIKE for basic matching
  if (filters.tags?.length) {
    const tagClauses = filters.tags.map(t => `tags LIKE '%"${t}"%'`);
    clauses.push(`(${tagClauses.join(' OR ')})`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

/**
 * Normalize scores to [0, 1] range.
 */
function normalizeScores(items, scoreKey) {
  if (items.length === 0) return;
  const max = Math.max(...items.map(i => i[scoreKey]));
  const min = Math.min(...items.map(i => i[scoreKey]));
  const range = max - min || 1;
  for (const item of items) {
    item[scoreKey] = (item[scoreKey] - min) / range;
  }
}

/**
 * Format a raw LanceDB result into a clean response object.
 */
function formatResult(row, score) {
  return {
    chunk_id: row.id,
    parent_id: row.parent_id,
    text: row.text,
    score: +score.toFixed(4),
    title: row.title,
    source: row.source,
    tags: JSON.parse(row.tags || '[]'),
    confidence: row.confidence,
    content_type: row.content_type,
    chunk_index: row.chunk_index,
    chunk_strategy: row.chunk_strategy,
    chunk_level: row.chunk_level,
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────
// 1. Vector Similarity Search
// ─────────────────────────────────────────────

export async function searchVector(queryVector, { limit = 10, metadataFilter } = {}) {
  const table = getChunksTable();
  if (!table) return [];

  let query = table.search(queryVector).limit(limit);
  const where = metadataFilter ? buildWhereClause(metadataFilter) : null;
  if (where) query = query.where(where);

  const results = await query.toArray();
  // LanceDB returns _distance (lower = more similar for L2)
  // Convert to similarity score (1 / (1 + distance))
  return results.map(r => formatResult(r, 1 / (1 + (r._distance || 0))));
}

// ─────────────────────────────────────────────
// 2. Keyword Search (BM25-style TF-IDF)
// ─────────────────────────────────────────────

export async function searchKeyword(queryText, { limit = 10, metadataFilter, maxScan = 10000 } = {}) {
  const table = getChunksTable();
  if (!table) return [];

  // Fetch rows to score in memory
  let q = table.query().limit(maxScan);
  const where = metadataFilter ? buildWhereClause(metadataFilter) : null;
  if (where) q = q.where(where);

  const rows = await q.toArray();
  if (rows.length === 0) return [];

  // Tokenize query
  const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (queryTerms.length === 0) return [];

  const N = rows.length;

  // Compute document frequency for each query term
  const df = {};
  for (const term of queryTerms) df[term] = 0;

  for (const row of rows) {
    const text = row.text.toLowerCase();
    for (const term of queryTerms) {
      if (text.includes(term)) df[term]++;
    }
  }

  // Score each document with BM25 (simplified: k1=1.5, b=0.75)
  const k1 = 1.5, b = 0.75;
  const avgDl = rows.reduce((sum, r) => sum + r.text.length, 0) / N;

  const scored = rows.map(row => {
    const text = row.text.toLowerCase();
    const dl = text.length;
    let score = 0;

    for (const term of queryTerms) {
      // Term frequency (count occurrences)
      let tf = 0;
      let idx = 0;
      while ((idx = text.indexOf(term, idx)) !== -1) { tf++; idx += term.length; }

      if (tf === 0) continue;

      // IDF
      const idf = Math.log((N - df[term] + 0.5) / (df[term] + 0.5) + 1);
      // BM25 score
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
    }

    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).filter(s => s.score > 0);

  // Normalize scores to [0, 1]
  if (top.length > 0) {
    const maxScore = top[0].score;
    return top.map(s => formatResult(s.row, maxScore > 0 ? s.score / maxScore : 0));
  }
  return [];
}

// ─────────────────────────────────────────────
// 3. Hybrid Search (Vector + Keyword)
// ─────────────────────────────────────────────

export async function searchHybrid(queryText, queryVector, {
  limit = 10, vectorWeight = 0.7, keywordWeight = 0.3, metadataFilter,
} = {}) {
  // Get more candidates than needed from each method
  const candidateLimit = limit * 3;

  const [vectorResults, keywordResults] = await Promise.all([
    searchVector(queryVector, { limit: candidateLimit, metadataFilter }),
    searchKeyword(queryText, { limit: candidateLimit, metadataFilter }),
  ]);

  // Merge results by chunk_id
  const merged = new Map();

  for (const r of vectorResults) {
    merged.set(r.chunk_id, { ...r, vectorScore: r.score, keywordScore: 0 });
  }

  for (const r of keywordResults) {
    if (merged.has(r.chunk_id)) {
      merged.get(r.chunk_id).keywordScore = r.score;
    } else {
      merged.set(r.chunk_id, { ...r, vectorScore: 0, keywordScore: r.score });
    }
  }

  // Compute hybrid score
  const results = Array.from(merged.values()).map(r => ({
    ...r,
    score: +(vectorWeight * r.vectorScore + keywordWeight * r.keywordScore).toFixed(4),
  }));

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ─────────────────────────────────────────────
// 4. Metadata Filter (standalone post-filter)
// ─────────────────────────────────────────────

export function applyMetadataFilter(results, filters) {
  return results.filter(r => {
    if (filters.source && r.source !== filters.source) return false;
    if (filters.confidence && r.confidence !== filters.confidence) return false;
    if (filters.content_type && r.content_type !== filters.content_type) return false;
    if (filters.date_range?.from && r.created_at < filters.date_range.from) return false;
    if (filters.date_range?.to && r.created_at > filters.date_range.to) return false;
    if (filters.tags?.length) {
      const rTags = Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]');
      if (!filters.tags.some(t => rTags.includes(t))) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────
// 5. MMR (Maximal Marginal Relevance)
// ─────────────────────────────────────────────

export async function searchMMR(queryVector, {
  limit = 10, lambda = 0.5, candidates = 30, metadataFilter,
} = {}) {
  const table = getChunksTable();
  if (!table) return [];

  // Get candidate pool via vector search
  let query = table.search(queryVector).limit(candidates);
  const where = metadataFilter ? buildWhereClause(metadataFilter) : null;
  if (where) query = query.where(where);

  const pool = await query.toArray();
  if (pool.length === 0) return [];

  // Convert distances to similarity scores
  const poolWithSim = pool.map(r => ({
    ...r,
    relevance: 1 / (1 + (r._distance || 0)),
    vec: r.vector,
  }));

  // Iterative MMR selection
  const selected = [];
  const remaining = [...poolWithSim];

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];

      // Max similarity to already-selected documents
      let maxSimToSelected = 0;
      for (const s of selected) {
        const sim = cosineSimilarity(r.vec, s.vec);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }

      // MMR score
      const mmrScore = lambda * r.relevance - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    const pick = remaining.splice(bestIdx, 1)[0];
    selected.push(pick);
  }

  return selected.map((r, i) => formatResult(r, r.relevance));
}

// ─────────────────────────────────────────────
// 6. Multi-Query Expansion + RRF
// ─────────────────────────────────────────────

function generateQueryVariations(queryText) {
  const variations = [queryText];

  // Variation 2: remove stop words, keep content words
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'as', 'until', 'while',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
    'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their']);

  const contentWords = queryText.toLowerCase().split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
  if (contentWords.length > 0 && contentWords.join(' ') !== queryText.toLowerCase().trim()) {
    variations.push(contentWords.join(' '));
  }

  // Variation 3: "what is" prefix
  if (!queryText.toLowerCase().startsWith('what')) {
    variations.push(`what is ${queryText}`);
  }

  return variations.slice(0, 4); // Max 4 variations
}

export async function searchMultiQuery(queryText, {
  limit = 10, method = 'vector', metadataFilter,
} = {}) {
  const variations = generateQueryVariations(queryText);

  // Embed all variations
  const embeddings = await embedBatch(variations);

  // Search with each variation
  const allResults = [];
  for (let i = 0; i < variations.length; i++) {
    let results;
    if (method === 'hybrid') {
      results = await searchHybrid(variations[i], embeddings[i], { limit: limit * 2, metadataFilter });
    } else {
      results = await searchVector(embeddings[i], { limit: limit * 2, metadataFilter });
    }
    allResults.push(results);
  }

  // Reciprocal Rank Fusion (k=60)
  const k = 60;
  const rrfScores = new Map();

  for (const resultSet of allResults) {
    for (let rank = 0; rank < resultSet.length; rank++) {
      const r = resultSet[rank];
      const existing = rrfScores.get(r.chunk_id);
      const score = 1 / (k + rank + 1);
      if (existing) {
        existing.score += score;
      } else {
        rrfScores.set(r.chunk_id, { ...r, score });
      }
    }
  }

  const merged = Array.from(rrfScores.values());
  merged.sort((a, b) => b.score - a.score);

  // Normalize to [0, 1]
  const maxScore = merged[0]?.score || 1;
  return merged.slice(0, limit).map(r => ({ ...r, score: +(r.score / maxScore).toFixed(4) }));
}

// ─────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────

export async function search({ query, method = 'hybrid', limit = 10, metadata_filter, options = {} }) {
  const queryVector = await embed(query);

  switch (method) {
    case 'vector':
      return searchVector(queryVector, { limit, metadataFilter: metadata_filter });
    case 'keyword':
      return searchKeyword(query, { limit, metadataFilter: metadata_filter });
    case 'hybrid':
      return searchHybrid(query, queryVector, {
        limit,
        vectorWeight: options.vector_weight ?? 0.7,
        keywordWeight: options.keyword_weight ?? 0.3,
        metadataFilter: metadata_filter,
      });
    case 'mmr':
      return searchMMR(queryVector, {
        limit,
        lambda: options.lambda ?? 0.5,
        candidates: options.candidates ?? 30,
        metadataFilter: metadata_filter,
      });
    case 'multi_query':
      return searchMultiQuery(query, {
        limit,
        method: options.sub_method ?? 'vector',
        metadataFilter: metadata_filter,
      });
    default:
      return searchHybrid(query, queryVector, { limit, metadataFilter: metadata_filter });
  }
}
