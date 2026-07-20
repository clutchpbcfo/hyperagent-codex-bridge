# Live Mac proof — July 20, 2026

## Environment

- Machine: Apple Silicon MacBook Air
- Node.js: 22.22.3
- Codex CLI: 0.144.6
- Hyperagent Codex Bridge: 0.4.0
- Codex App Mode: ON
- Model: `hyperagent/codex-relay-sol`
- Provider: `hyperagent_credits`
- Bridge: `http://127.0.0.1:47831/v1`
- Global Codex skill: `$hyperagent-codex-bridge`

## Skill-run result

The installed Codex skill audited the machine without changing configuration and reported:

```text
App Mode: ON
Config: /Users/clutch/.codex/config.toml
Model: hyperagent/codex-relay-sol
Provider: hyperagent_credits
Bridge provider configured: yes
Bridge: RUNNING at http://127.0.0.1:47831/v1
Versions: HACB 0.4.0, Node.js v22.22.3, Codex CLI 0.144.6
```

## Sanitized routing receipt

```text
2026-07-20T21:50:20.769Z  request  hyperagent/proof-of-work-scout-v2
2026-07-20T21:50:20.769Z  request  hyperagent/codex-relay-sol
2026-07-20T21:50:22.916Z  thread_created  hyperagent/proof-of-work-scout-v2  cmrtrdb4508am07adp41o2vv8
2026-07-20T21:50:24.786Z  thread_created  hyperagent/codex-relay-sol  cmrtrdbzi001k06ady1jwb27d
2026-07-20T21:50:57.085Z  completed  hyperagent/codex-relay-sol  cmrtrdbzi001k06ady1jwb27d  function_call
2026-07-20T21:51:01.409Z  request  hyperagent/codex-relay-sol
2026-07-20T21:51:03.263Z  thread_created  hyperagent/codex-relay-sol  cmrtre65r000a07ad2ldoomvo
2026-07-20T21:51:19.794Z  completed  hyperagent/proof-of-work-scout-v2  cmrtrdb4508am07adp41o2vv8  final
2026-07-20T21:51:36.001Z  completed  hyperagent/codex-relay-sol  cmrtre65r000a07ad2ldoomvo  final
```

## What this proves

- Codex App loaded the custom Hyperagent provider.
- The global Codex skill was discovered and executed.
- The bridge routed app requests to named Hyperagent agents.
- Hyperagent returned a Codex client-tool request (`function_call`).
- Codex executed the local tool and returned its result for a final Hyperagent answer.
- Hyperagent thread IDs provide an independent audit trail.
- The user observed Hyperagent credits being consumed while Codex subscription quota was not.

## Privacy

The receipt is safe to publish. It contains timestamps, model slugs, event types, and Hyperagent thread IDs only. It does not contain prompts, outputs, OAuth tokens, refresh tokens, local bridge secrets, or Codex authentication files.
