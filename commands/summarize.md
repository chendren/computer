---
description: Summarize a document, file, URL, or text at multiple detail levels
argument-hint: "<file-path-or-text>"
allowed-tools: [Read, Bash, Write, Task, WebSearch]
---

# Computer Summarize

Produce a multi-level summary of the provided content and push results to the UI.

## Process

1. **Determine Input**: Examine $ARGUMENTS
   - If it looks like a file path, read the file
   - If it looks like a URL, fetch the content
   - If it's text, use directly
   - If empty, inform the user they need to provide input

2. **Analyze Structure**: Identify sections, themes, chronology, and content type

3. **Generate Summaries**:
   - **Executive summary**: 2-3 sentences for rapid comprehension
   - **Key points**: 5-10 bullet points of essential information
   - **Detailed summary**: Multi-paragraph comprehensive summary
   - **Section breakdown**: Per-section summaries with importance ratings
   - **Action items**: Decisions, tasks, follow-ups found in the content
   - **Metadata**: Word count, content type, estimated read time

4. **Generate Chart**: Create a horizontal bar chart showing content distribution by section using LCARS colors

5. **Push to UI**: Write the summary JSON to `/tmp/computer-summary-result.json` using the Write tool, then POST it:
   ```bash
   curl -s -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d @/tmp/computer-summary-result.json
   ```

6. **Display**: Show the executive summary and key points in the terminal.

Arguments: $ARGUMENTS
