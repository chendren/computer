---
description: Run AI analysis on text, files, or context
argument-hint: "<text-or-file-path>"
allowed-tools: [Read, Bash, Write, Task, WebSearch]
---

# Computer Analyze

Run comprehensive AI analysis on the provided input.

## Process

1. **Determine Input**: Examine $ARGUMENTS
   - If it looks like a file path (starts with / or ~, or has a file extension), read the file
   - If it's text, use directly
   - If empty, inform the user they need to provide text or a file path

2. **Perform Analysis**: Analyze the content and produce:
   - **Sentiment**: Overall tone (positive/negative/neutral/mixed) with confidence and breakdown percentages
   - **Topics**: 3-7 key themes with relevance scores (0-1)
   - **Action Items**: Actionable items with priority (high/medium/low)
   - **Summary**: Concise 2-3 sentence summary
   - **Entities**: People, organizations, locations, dates, technical terms

3. **Generate Chart Spec**: Create a Chart.js config for visualizing topic distribution using LCARS colors:
   - Colors: #FF9900, #CC99CC, #9999FF, #FF9966, #CC6699, #99CCFF, #FFCC00
   - Background: #000000, Text: #FF9900, Grid: #333333

4. **Push to UI**: Write the full analysis JSON to `/tmp/computer-analysis-result.json` using the Write tool, then POST it:
   ```bash
   curl -s -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d @/tmp/computer-analysis-result.json
   ```
   The JSON MUST include an `"input"` field containing the original raw text that was analyzed, plus all analysis fields and a `chartSpec` with a valid Chart.js v4 config. Example structure:
   ```json
   {
     "input": "the original raw text that was analyzed...",
     "summary": "...",
     "sentiment": {...},
     "topics": [...],
     "actionItems": [...],
     "entities": {...},
     "chartSpec": {...}
   }
   ```

5. **Display**: Show analysis results in the terminal as well, formatted clearly.
