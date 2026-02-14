---
description: Send a message through a messaging channel
allowed-tools: [Bash]
---

# Send Message

Send a message through a connected messaging channel via the OpenClaw gateway.

## Usage

`/send <channel> <target> <message>`

Example: `/send discord #general Hello from Computer!`

## Steps

1. Parse the channel name, target (channel/user), and message text from the arguments
2. Send via: `curl -s -X POST http://localhost:3141/api/gateway/send -H 'Content-Type: application/json' -d '{"channel":"<channel>","target":"<target>","text":"<message>"}'`
3. Report success or failure

## Security

- NEVER send messages containing API keys, tokens, passwords, or other credentials
- Scan the message text for secrets before sending
- If secrets are detected, refuse to send and warn the user
