import { Router } from 'express';
import { ingestEntry, deleteEntry, getEntry, listEntries, getStats } from '../services/vectordb.js';
import { search } from '../services/search.js';
import { isOllamaAvailable, VECTOR_DIM, MODEL } from '../services/embeddings.js';
import { broadcast } from '../services/websocket.js';
import { notifyComplete } from '../services/notifications.js';

const router = Router();

// POST / — Ingest a document
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    // Backward compat: support { fact } field
    const text = body.text || body.fact;
    if (!text) return res.status(400).json({ error: 'text or fact field is required' });

    const result = await ingestEntry({
      text,
      title: body.title,
      source: body.source || 'user',
      confidence: body.confidence || 'medium',
      tags: body.tags || [],
      content_type: body.content_type || (text.length < 500 ? 'fact' : 'document'),
      chunk_strategy: body.chunk_strategy || 'paragraph',
      chunk_options: body.chunk_options || {},
    });

    broadcast('knowledge', result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats — Collection statistics (BEFORE :id)
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    stats.ollama_status = await isOllamaAvailable() ? 'online' : 'offline';
    stats.embedding_model = MODEL;
    stats.vector_dimensions = VECTOR_DIM;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /search — Search knowledge base (BEFORE :id)
router.post('/search', async (req, res) => {
  try {
    const { query, method = 'hybrid', limit = 10, metadata_filter, options } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const results = await search({ query, method, limit, metadata_filter, options });
    res.json({
      results,
      method,
      query,
      total_results: results.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /bulk — Bulk ingest documents
router.post('/bulk', async (req, res) => {
  try {
    const { documents, chunk_strategy = 'paragraph', chunk_options = {} } = req.body;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: 'documents array is required' });
    }

    const results = [];
    for (const doc of documents) {
      const text = doc.text || doc.fact;
      if (!text) continue;

      const result = await ingestEntry({
        text,
        title: doc.title,
        source: doc.source || 'import',
        confidence: doc.confidence || 'medium',
        tags: doc.tags || [],
        content_type: doc.content_type || 'document',
        chunk_strategy: doc.chunk_strategy || chunk_strategy,
        chunk_options: doc.chunk_options || chunk_options,
      });
      results.push(result);
    }

    notifyComplete('Computer', `Bulk ingested ${results.length} documents`);
    res.json({ ingested: results.length, entries: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — List entries (paginated)
router.get('/', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 50;
    const { entries, total } = await listEntries({ offset, limit });

    // Backward compat: if no query params, return flat array
    if (!req.query.offset && !req.query.limit) {
      return res.json(entries);
    }
    res.json({ entries, total, offset, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — Get single entry with chunks
router.get('/:id', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Knowledge entry not found' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — Remove entry and chunks
router.delete('/:id', async (req, res) => {
  try {
    await deleteEntry(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
