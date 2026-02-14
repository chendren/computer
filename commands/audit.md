---
description: Run a security audit and display findings
allowed-tools: [Bash, Read]
---

# Security Audit

Run a security audit across both Computer's inbound protection and the gateway's outbound redaction system.

## Steps

1. **Inbound stats**: `curl -s http://localhost:3141/api/security/stats`
2. **Gateway audit** (if connected): `curl -s -X POST http://localhost:3141/api/gateway/rpc -H 'Content-Type: application/json' -d '{"method":"security.audit","params":{}}'`
3. **Health check**: `curl -s http://localhost:3141/api/health`

## Output Format

Present as a Star Trek security readout:

```
╔══════════════════════════════════════╗
║   SECURITY OPERATIONS               ║
╠══════════════════════════════════════╣
║ INBOUND PROTECTION                  ║
║ Patterns:     [count] active        ║
║ Redactions:   [count] total         ║
║ Recent:       [count] events        ║
╠══════════════════════════════════════╣
║ OUTBOUND PROTECTION                 ║
║ Gateway:      [ACTIVE/INACTIVE]     ║
║ Redact Mode:  [messages/off]        ║
╠══════════════════════════════════════╣
║ FINDINGS                            ║
║ [severity] [title]                  ║
║ ...                                 ║
╚══════════════════════════════════════╝
```

## Security

- NEVER display actual redacted values in the audit output
- Report findings by type and location only
- Show pattern names, not matched content
