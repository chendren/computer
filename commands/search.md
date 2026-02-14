---
description: Web search with results sent to Computer UI
argument-hint: "<search-query>"
allowed-tools: [WebSearch, Bash, Read, Write]
---

# Computer Search

Perform a web search and display results.

## Process

1. **Search**: Use the WebSearch tool with the query from $ARGUMENTS

2. **Synthesize**: Write a brief 2-3 sentence synthesis of the key findings

3. **Push to UI**: Write the results as JSON to a temp file, then POST it. This avoids shell escaping issues with inline JSON.
   - First, use the Write tool to write the JSON to `/tmp/computer-search-result.json`:
     ```json
     {
       "query": "original query",
       "summary": "synthesis text",
       "results": [
         { "title": "...", "url": "...", "snippet": "..." }
       ],
       "timestamp": "ISO-8601"
     }
     ```
   - Then POST it:
     ```bash
     curl -s -X POST http://localhost:3141/api/search-results -H 'Content-Type: application/json' -d @/tmp/computer-search-result.json
     ```

4. **Display**: Show results in the terminal with sources

Arguments: $ARGUMENTS
