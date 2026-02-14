---
description: Compare two files, texts, or concepts side by side
argument-hint: "<file1-or-text> vs <file2-or-text>"
allowed-tools: [Read, Bash, Write, Task]
---

# Computer Compare

Perform a detailed comparison of two items and push results to the UI.

## Process

1. **Parse Input**: Examine $ARGUMENTS to identify the two subjects to compare
   - Two file paths separated by "vs", "and", or a space
   - Two quoted strings
   - If only one item provided, ask for the second

2. **Read Content**: If file paths, read both files. If text, use directly.

3. **Compare**: Analyze both subjects for:
   - **Structural differences**: Organization, length, complexity
   - **Content differences**: What's unique to each, what's shared
   - **Similarity score**: 0.0 (completely different) to 1.0 (identical)
   - **Key differences**: Most significant differences with impact (high/medium/low) and winner assessment
   - **Key similarities**: Shared characteristics
   - **Recommendation**: Which is preferable and why, or contextual guidance

4. **Generate Chart**: Create a radar chart comparing dimensional scores using LCARS colors

5. **Push to UI**: Write the comparison JSON to `/tmp/computer-comparison-result.json` using the Write tool, then POST it:
   ```bash
   curl -s -X POST http://localhost:3141/api/comparisons -H 'Content-Type: application/json' -d @/tmp/computer-comparison-result.json
   ```
   The JSON MUST include all comparison fields plus a `chartSpec` with a valid Chart.js v4 radar config.

6. **Display**: Show the comparison results formatted in the terminal.

Arguments: $ARGUMENTS
