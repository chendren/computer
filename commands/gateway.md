---
description: Show OpenClaw gateway status, nodes, sessions, and models
allowed-tools: [Bash, Read]
---

# Gateway Status

Display comprehensive gateway status including process health, connected nodes, active sessions, and available models.

## Steps

1. **Gateway status**: `curl -s http://localhost:3141/api/gateway/status`
2. **Connected nodes**: `curl -s http://localhost:3141/api/gateway/nodes`
3. **Active sessions**: `curl -s http://localhost:3141/api/gateway/sessions`
4. **Available models**: `curl -s http://localhost:3141/api/gateway/models`
5. **Health**: `curl -s http://localhost:3141/api/health`

## Output Format

Present as a Star Trek engineering readout:

```
╔══════════════════════════════════════╗
║   GATEWAY CONTROL                   ║
╠══════════════════════════════════════╣
║ Process:      [RUNNING/STOPPED]     ║
║ Connection:   [CONNECTED/DISCONN]   ║
║ PID:          [pid]                 ║
║ Port:         [port]                ║
║ Uptime:       [duration]            ║
╠══════════════════════════════════════╣
║ NODES         [count] connected     ║
║ SESSIONS      [count] active        ║
║ MODELS        [count] available     ║
║ CHANNELS      [count] configured    ║
╚══════════════════════════════════════╝
```
