---
description: Generate a report from stored analyses, logs, and comparisons
argument-hint: "[format] [timeframe]"
allowed-tools: [Read, Bash, Write]
---

# Computer Export

Generate a formatted report from stored Computer data.

## Process

1. **Parse Input**: Examine $ARGUMENTS for:
   - **Format**: `markdown` (default), `html`, or `json`
   - **Timeframe**: `today`, `yesterday`, `week`, `all` (default: all)
   - **Filter**: Optional type filter — `analyses`, `logs`, `comparisons`, `transcripts`, `all`

2. **Gather Data**: Fetch relevant stored data:
   ```bash
   curl -s http://localhost:3141/api/analyses
   curl -s http://localhost:3141/api/logs
   curl -s http://localhost:3141/api/comparisons
   curl -s http://localhost:3141/api/transcripts
   curl -s http://localhost:3141/api/knowledge
   curl -s http://localhost:3141/api/monitors
   ```

3. **Filter by Timeframe**: Only include items within the requested period

4. **Generate Report**:

   **Markdown format** — Write to `~/Desktop/computer-report-{date}.md`:
   ```markdown
   # Computer Report — Stardate {stardate}

   ## Summary
   {Executive summary of all activity}

   ## Analyses
   {Each analysis with key findings}

   ## Captain's Log
   {Log entries in chronological order}

   ## Comparisons
   {Comparison results}

   ## Knowledge Base
   {Key facts accumulated}

   ## Action Items
   {Aggregated from all analyses}
   ```

   **HTML format** — Write to `~/Desktop/computer-report-{date}.html`:
   - LCARS-themed HTML with inline CSS
   - Same content structure as markdown
   - Viewable in any browser

5. **Display**: Show the report location and a brief summary in the terminal.
   ```bash
   open ~/Desktop/computer-report-{date}.{format}
   ```

Arguments: $ARGUMENTS
