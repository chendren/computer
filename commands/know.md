---
description: "Knowledge base — store, retrieve, or search accumulated knowledge"
argument-hint: "<query-or-fact>"
allowed-tools: [Read, Bash, Write]
---

# Computer Knowledge Base

Store, retrieve, and search the Computer's persistent knowledge base.

## Process

1. **Parse Input**: Examine $ARGUMENTS to determine the operation:
   - **"remember ..."** or **"store ..."**: Store a new fact
   - **"what do we know about ..."** or **"recall ..."**: Retrieve knowledge
   - **"update ..."**: Update existing knowledge
   - **"forget ..."**: Remove a knowledge entry
   - **"list"** or empty: Show recent knowledge entries
   - Any other query: Search for relevant knowledge

2. **Store** (if "remember" or "store"):
   - Extract the key fact from the input
   - Auto-detect tags from content
   - Write entry JSON to `/tmp/computer-knowledge-entry.json`:
     ```json
     {
       "fact": "The key fact",
       "source": "user",
       "confidence": "high",
       "tags": ["auto-detected", "tags"]
     }
     ```
   - POST to server: `curl -s -X POST http://localhost:3141/api/knowledge -H 'Content-Type: application/json' -d @/tmp/computer-knowledge-entry.json`

3. **Retrieve** (if "what do we know" or search query):
   - Fetch all knowledge: `curl -s http://localhost:3141/api/knowledge`
   - Also search analyses: `curl -s http://localhost:3141/api/analyses`
   - Also search logs: `curl -s http://localhost:3141/api/logs`
   - Filter for relevant entries matching the query
   - Synthesize a comprehensive answer from all matching data
   - Display in terminal

4. **List** (if "list" or empty):
   - Fetch all knowledge entries
   - Display formatted list with tags and confidence levels

5. **Display**: Show results in the terminal formatted clearly.

Arguments: $ARGUMENTS
