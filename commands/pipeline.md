---
description: Chain multiple Computer operations into an automated workflow
argument-hint: "<goal-description>"
allowed-tools: [Read, Write, Bash, Task, WebSearch]
---

# Computer Pipeline

Execute a multi-step workflow by chaining Computer operations together.

## Process

1. **Parse Goal**: Understand what the user wants to accomplish from $ARGUMENTS
   - Examples: "transcribe meeting.mp3 then summarize and extract action items"
   - "analyze these two files and compare them"
   - "search for X, analyze the findings, and generate a report"

2. **Plan Steps**: Break the goal into ordered operations:
   - Identify which Computer capabilities are needed
   - Determine the data flow between steps
   - Estimate total steps

3. **Push Pipeline Start**: Notify the UI:
   ```bash
   curl -s -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d @/tmp/computer-pipeline-start.json
   ```

4. **Execute Each Step**:
   - Perform the operation using your own capabilities (analyze text, summarize, etc.)
   - Write intermediate results to temp files
   - Push each step's output to the appropriate API endpoint
   - Push a status/TTS update: "Step N complete. Proceeding to [next step]."

5. **Aggregate Results**: Combine all outputs into a final pipeline summary
   - Write to `/tmp/computer-pipeline-result.json`
   - POST to `/api/analysis`

6. **Display**: Show the pipeline summary with all steps and final output in the terminal.

## Common Pipelines

- **Meeting Pipeline**: transcribe → summarize → extract action items → log
- **Research Pipeline**: search → analyze findings → generate chart → summarize
- **Review Pipeline**: read file → analyze → compare with standard → explain gaps
- **Daily Pipeline**: brief → check monitors → summarize new data → log

Arguments: $ARGUMENTS
