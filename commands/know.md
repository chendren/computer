---
description: "Knowledge base — store, retrieve, or search accumulated knowledge (vector search)"
argument-hint: "<query-or-fact>"
allowed-tools: [Read, Bash, Write]
---

# Computer Knowledge Base

Store, retrieve, and search the Computer's persistent vector knowledge base. Uses LanceDB with Ollama nomic-embed-text embeddings for semantic search.

## Process

1. **Parse Input**: Examine $ARGUMENTS to determine the operation:
   - **"remember ..."** or **"store ..."**: Store a new fact/document
   - **"what do we know about ..."** or **"recall ..."**: Semantic search
   - **"update ..."**: Delete + re-ingest
   - **"forget ..."**: Delete a knowledge entry
   - **"list"** or empty: Show recent knowledge entries
   - **"stats"**: Show knowledge base statistics
   - Any other query: Semantic search

2. **Store** (if "remember" or "store"):
   - Extract the key fact from the input
   - Auto-detect tags from content
   - Choose chunking strategy based on content length:
     - Short facts (< 500 chars): `sentence`
     - Medium text (500-5000 chars): `paragraph`
     - Long documents (> 5000 chars): `recursive`
   - Write entry JSON to `/tmp/computer-knowledge-entry.json`:
     ```json
     {
       "text": "The content to store",
       "title": "Brief title",
       "source": "user",
       "confidence": "high",
       "tags": ["auto-detected", "tags"],
       "chunk_strategy": "paragraph"
     }
     ```
   - POST to server: `curl -s -X POST http://localhost:3141/api/knowledge -H 'Content-Type: application/json' -d @/tmp/computer-knowledge-entry.json`

3. **Search** (if "what do we know" or any query):
   - Use hybrid vector search:
     ```bash
     curl -s -X POST http://localhost:3141/api/knowledge/search \
       -H 'Content-Type: application/json' \
       -d '{"query":"the search query","method":"hybrid","limit":10}'
     ```
   - Available methods: `vector`, `keyword`, `hybrid`, `mmr`, `multi_query`
   - Synthesize a comprehensive answer from top results
   - Show relevance scores for each result

4. **Delete** (if "forget"):
   - First search for matching entries
   - Confirm the entry to delete
   - `curl -s -X DELETE http://localhost:3141/api/knowledge/{id}`

5. **Stats** (if "stats"):
   - `curl -s http://localhost:3141/api/knowledge/stats`
   - Display formatted statistics: entry counts, chunk counts, strategies, sources

6. **List** (if "list" or empty):
   - Fetch entries: `curl -s http://localhost:3141/api/knowledge`
   - Display formatted list with titles, tags, confidence, and chunk counts

7. **Display**: Show results in the terminal formatted clearly.

## Chunking Strategies

| Strategy | Best For |
|----------|----------|
| `sentence` | Short facts, individual statements |
| `paragraph` | Medium documents with clear paragraphs |
| `recursive` | Long documents with headers/sections |
| `fixed` | Uniform chunk sizes needed |
| `sliding` | Overlapping context windows |
| `semantic` | Content where topic shifts matter |

## Search Methods

| Method | Description |
|--------|-------------|
| `hybrid` | Combined vector + keyword (default, best general-purpose) |
| `vector` | Pure semantic similarity |
| `keyword` | BM25 text matching |
| `mmr` | Diverse results (avoids redundancy) |
| `multi_query` | Multiple query variations merged via RRF |

Arguments: $ARGUMENTS
