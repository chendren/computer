---
description: Morning briefing — summarize all recent Computer activity
argument-hint: "[timeframe]"
allowed-tools: [Read, Bash, Write]
---

# Computer Briefing

Generate a comprehensive status briefing of all recent Computer activity.

## Process

1. **Determine Timeframe**: Examine $ARGUMENTS
   - Default: Last 24 hours
   - Accepts: "today", "yesterday", "week", "all", or a specific date

2. **Gather Data**: Fetch all recent activity from the server:
   ```bash
   curl -s http://localhost:3141/api/transcripts
   curl -s http://localhost:3141/api/analyses
   curl -s http://localhost:3141/api/logs
   curl -s http://localhost:3141/api/monitors
   curl -s http://localhost:3141/api/health
   ```

3. **Compile Briefing**:
   - **System Status**: Server uptime, health, active monitors
   - **Activity Summary**: Count of transcripts, analyses, logs, searches in timeframe
   - **Recent Analyses**: Key findings from recent analyses (sentiment trends, recurring topics)
   - **Captain's Log**: Recent log entries
   - **Monitor Alerts**: Any triggered monitors or status changes
   - **Action Items**: Aggregated action items from all analyses, prioritized

4. **Generate Briefing JSON**:
   ```json
   {
     "type": "briefing",
     "timeframe": "last 24 hours",
     "systemStatus": { "uptime": "...", "health": "online" },
     "activityCounts": { "transcripts": 3, "analyses": 5, "logs": 2, "monitors": 1 },
     "highlights": ["Key finding 1", "Key finding 2"],
     "recentLogs": [...],
     "activeMonitors": [...],
     "pendingActions": [...],
     "summary": "Narrative briefing summary"
   }
   ```

5. **Push to UI**: Write to `/tmp/computer-briefing-result.json` and POST:
   ```bash
   curl -s -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d @/tmp/computer-briefing-result.json
   ```

6. **Display**: Present the briefing in the terminal in Star Trek format:
   ```
   ═══════════════════════════════════════
   COMPUTER BRIEFING — Stardate 2026.045
   ═══════════════════════════════════════

   SYSTEM STATUS: All systems operational
   ...
   ```

Arguments: $ARGUMENTS
