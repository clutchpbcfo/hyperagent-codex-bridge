# Hyperagent Codex Bridge v0.4.1

Emergency cost-control and Codex App tool-compatibility release.

## Why this release exists

v0.4.0 forwarded large Codex App developer, skills, environment, and AGENTS payloads into paid Hyperagent relay runs and did not enforce a local request ceiling. Tool loops multiplied those paid sampling requests. Do not use v0.4.0.

## Fixes

- Strip injected developer, app, plugin, skills, environment, and AGENTS context before relay calls.
- Retain at most eight recent turns and 24,000 conversation characters.
- Cap each retained turn at 6,000 characters and the final relay prompt at 70,000 characters.
- Limit forwarded tools to 32.
- Default to low reasoning effort and ignore client effort escalation unless explicitly enabled.
- Add a persistent 20-request UTC daily ceiling and `hacb budget` command.
- Block multi-agent delegation tools by default.
- Read Codex `additional_tools` and `tool_search_output` tool declarations.
- Flatten MCP namespaces such as `mcp__node_repl__js` into callable function names.
- Add client-executed `tool_search_call` support for deferred tools.
- Expand the suite to 22 passing tests, including the exact unavailable-MCP-tool regression and budget fail-closed behavior.

## Required operator action

1. Run `hacb app-off` and `hacb stop` before upgrading.
2. Upgrade to v0.4.1.
3. Configure the Hyperagent relay agent to low effort with a hard per-run USD budget cap.
4. Run `hacb budget` and a single controlled test.
5. Review `hacb audit` and Hyperagent credit usage before enabling App Mode again.

## Security

No prompts, answers, OAuth tokens, refresh tokens, or local bearer tokens are stored in audit receipts or included in the repository.
