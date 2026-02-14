---
description: "Captain's Log — record timestamped personal notes"
argument-hint: "<log-entry-text>"
allowed-tools: [Read, Bash, Write]
---

# Captain's Log

Record a timestamped personal log entry, or review past entries.

## Process

1. **Parse Input**: Examine $ARGUMENTS
   - If text is provided: Create a new log entry
   - If `list` or empty: Show recent log entries
   - If `search <query>`: Search through log entries
   - If `stardate`: Include the current stardate (date formatted as YYYY.DDD)

2. **Create Entry** (if text provided):
   - Generate stardate: Format current date as `YYYY.DDD` (day of year)
   - Create log JSON:
     ```json
     {
       "text": "The log entry text",
       "stardate": "2026.045",
       "category": "personal|mission|technical|observation",
       "tags": ["auto-detected", "relevant", "tags"]
     }
     ```
   - Write to `/tmp/computer-log-entry.json`
   - POST to server:
     ```bash
     curl -s -X POST http://localhost:3141/api/logs -H 'Content-Type: application/json' -d @/tmp/computer-log-entry.json
     ```

3. **List Entries** (if `list` or empty):
   - Fetch entries: `curl -s http://localhost:3141/api/logs`
   - Display in terminal formatted as Captain's Log entries with stardates

4. **Search Entries** (if `search <query>`):
   - Fetch all entries
   - Filter by text match or tag match
   - Display matching entries

5. **Display**: Show the entry confirmation or listing in Star Trek log format:
   ```
   Captain's Log, Stardate 2026.045
   <entry text>
   ```

Arguments: $ARGUMENTS
