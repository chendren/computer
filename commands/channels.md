---
description: List all messaging channels and their connection status
allowed-tools: [Bash, Read]
---

# Channels

Display all messaging channels connected through the OpenClaw gateway.

## Steps

1. **Get channel list**: `curl -s http://localhost:3141/api/gateway/channels`
2. **Get gateway status**: `curl -s http://localhost:3141/api/gateway/status`

## Output Format

Present as a Star Trek communications array readout:

```
╔══════════════════════════════════════╗
║   COMMUNICATIONS ARRAY STATUS       ║
╠══════════════════════════════════════╣
║ Gateway:      [ONLINE/OFFLINE]      ║
║ Total:        [count] channels      ║
╠══════════════════════════════════════╣
║ CHANNEL          STATUS             ║
║ discord          [ONLINE/OFFLINE]   ║
║ slack            [ONLINE/OFFLINE]   ║
║ telegram         [ONLINE/OFFLINE]   ║
║ ...                                 ║
╚══════════════════════════════════════╝
```
