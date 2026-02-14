---
description: Set up a watch on a URL, file, endpoint, or process
argument-hint: "<target> [interval]"
allowed-tools: [Read, Bash, Write]
---

# Computer Monitor

Set up a monitoring watch on a target and push status to the UI.

## Process

1. **Parse Input**: Examine $ARGUMENTS to identify:
   - **Target**: URL, file path, process name, or endpoint
   - **Interval**: Optional check frequency (default: 1m). Accepts: 30s, 1m, 5m, 15m, 1h
   - **Condition**: What to watch for (auto-detected based on target type)

2. **Establish Baseline**: Check the target's current state
   - URL: HTTP status code, response time, content hash
   - File: Checksum, size, modification time
   - Process: Running status, PID, CPU/memory
   - Endpoint: Response status, body validation

3. **Create Monitor Script**: Generate a shell script at `/tmp/computer-monitor-{name}.sh` that:
   - Performs the check
   - Compares against baseline
   - Writes result to `/tmp/computer-monitor-result.json`
   - POSTs to `http://localhost:3141/api/monitors`
   - Outputs status to stdout

4. **Register Monitor**: Push the initial monitor state to the UI:
   ```bash
   curl -s -X POST http://localhost:3141/api/monitors -H 'Content-Type: application/json' -d @/tmp/computer-monitor-result.json
   ```

5. **Start Watching**: Launch the script with a loop:
   ```bash
   nohup bash -c 'while true; do bash /tmp/computer-monitor-{name}.sh; sleep {interval}; done' > /tmp/computer-monitor-{name}.log 2>&1 &
   echo $! > /tmp/computer-monitor-{name}.pid
   ```

6. **Display**: Show monitor configuration and initial status in the terminal.

## Special Arguments

- `list` — Show all active monitors
- `stop <name>` — Stop a specific monitor by killing its PID

Arguments: $ARGUMENTS
