# Changelog

## 0.5.0 — 2026-07-23

- Stop emitting authoritative-looking zero token usage when Hyperagent MCP does not report token counts.
- Add request IDs, bounded durable local `Idempotency-Key` replay/conflict handling, and conservative cross-process duplicate prevention.
- Propagate client disconnect cancellation through MCP polling and record that remote thread cancellation is unavailable.
- Replace eager budget consumption with durable local reservation, commit-at-dispatch, and pre-dispatch release states.
- Add secret-free structured gateway logs plus separate liveness and readiness probes.
- Add loopback-only container/self-host guidance and mocked official OpenAI JavaScript/Python client fixtures.
- Fail closed on unknown, duplicate, or ambiguous model identifiers; default omitted `stream` to SSE; and bound every create and polling request with an abortable timeout.
- Publish the executable OpenAPI 3.1 and SSE compatibility contract with black-box conformance tests.
- Verify the official OpenAI JavaScript client against the local gateway profile.

## 0.4.2 — 2026-07-22

Release-hardening update focused on enforcing the cost controls claimed by v0.4.1.

- Migrate unversioned legacy configurations to the six-request safe ceiling without rotating OAuth or local bearer secrets.
- Preserve explicitly versioned operator overrides while making above-default caps visible in `hacb doctor`.
- Add `hacb budget --safe` and explicit `hacb budget --set <count>` controls.
- Enforce the daily request ceiling across multiple bridge processes with a fail-closed filesystem lock.
- Add multi-process budget, migration, and explicit-override regression coverage.
- Add a committed lockfile and cross-platform GitHub Actions validation.

## 0.4.1 — 2026-07-20

Emergency cost-control and Codex App tool-compatibility patch.

- Strip injected developer, app, skills, environment, and AGENTS context before paid relay calls.
- Bound retained history to eight turns and 24,000 characters total by default.
- Cap individual retained turns at 6,000 characters and forwarded tools at 32.
- Default reasoning effort to low and ignore client effort escalation unless explicitly enabled.
- Add a persistent six-request daily ceiling and `hacb budget` visibility.
- Block multi-agent delegation tools by default to prevent recursive paid runs.
- Read Codex `additional_tools` and `tool_search_output` declarations.
- Flatten MCP namespace tools such as `mcp__node_repl__js` into callable functions.
- Add client-executed `tool_search_call` support for deferred tools.
- Expand the suite to 22 passing tests, including the exact unavailable-MCP-tool regression.

## 0.4.0 — 2026-07-20

- Added a global Codex skill and installable Codex plugin manifest.
- Added `hacb install-skill`; fresh setup installs the skill automatically.
- Added macOS and Windows/Ryzen setup and migration guides.
- Added proof-of-work, live Mac validation, and article-ready documentation.
- Added reversible Codex App Mode and sanitized routing receipts.
- Added cross-platform launcher generation.
- Expanded validation to 19 tests, including real Codex CLI 0.144.6 provider, local tool-loop, and main-config App Mode runs.

## 0.3.1 — 2026-07-20

- Added `hacb audit` sanitized routing receipts.
- Hardened App Mode verification.

## 0.3.0 — 2026-07-20

- Added reversible Codex App Mode with protected config backup.

## 0.2.1 — 2026-07-20

- Added the Mac quickstart and corrected relay-agent tool configuration.

## 0.2.0 — 2026-07-20

- Added local bearer authentication, OAuth issuer binding, least-privilege scopes, and real Codex tool-loop validation.

## 0.1.0 — 2026-07-20

- Initial OAuth MCP to Codex Responses bridge.
