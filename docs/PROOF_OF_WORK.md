# Proof of work

## Claim

Hyperagent Codex Bridge lets Codex CLI and Codex App use named Hyperagent agents as model backends. Hyperagent handles reasoning and credit accounting. Codex retains the local filesystem, shell, patches, tests, sandbox, and approval system.

## What was verified

On July 20, 2026, the bridge was exercised end to end on macOS with Codex CLI 0.144.6:

1. Hyperagent OAuth completed through the documented MCP authorization flow.
2. Codex loaded `hyperagent/codex-relay-sol` through the custom Responses provider.
3. A plain reasoning request returned through Hyperagent.
4. Hyperagent selected Codex's local shell tool.
5. Codex executed `pwd` locally.
6. The shell result returned to Hyperagent.
7. Hyperagent produced the final answer.
8. Hyperagent credits visibly changed while Codex subscription quota did not.
9. Codex App Mode displayed `Custom` and `Hyperagent Credits` for a new desktop chat.

## Automated coverage

The repository test suite covers:

- strong local bearer-token generation and protected state files;
- OAuth protected-resource and authorization-server discovery;
- issuer/origin binding;
- PKCE and refresh-token rotation;
- MCP initialization, sessions, JSON responses, and SSE tool results;
- agent discovery and stable model slug generation;
- Codex model catalog generation;
- Responses streaming and non-streaming output;
- the versioned OpenAPI 3.1 document and exact SSE event order;
- local auth, model/agent selection, JSON/SSE errors, identifier, idempotency, cancellation, and usage semantics through black-box fake-upstream conformance tests;
- function/custom-tool mapping;
- a real Codex CLI provider run;
- a real Codex local shell-tool round trip;
- reversible App Mode activation and rollback;
- main-config Codex execution without a profile flag;
- sanitized audit receipts.

Run:

```bash
npm test
```

For the real Codex binary tests:

```bash
CODEX_BIN="$(command -v codex)" npm test
```

## Runtime proof

After a controlled turn:

```bash
hacb audit 12
```

A successful request produces a sequence like:

```text
2026-07-22T00:00:00.000Z  request_reserved  req_example  hyperagent/codex-relay-sol  agent_<hash>  reservation_<hash>  promptChars=1234  daily=1/6
2026-07-22T00:00:00.100Z  thread_created  req_example  hyperagent/codex-relay-sol  agent_<hash>  thread_<hash>
2026-07-22T00:00:01.000Z  completed  req_example  hyperagent/codex-relay-sol  agent_<hash>  thread_<hash>  final
```

This is a shape example, not a live receipt. Current audit output uses adapter-generated request IDs and hashed agent, thread, and reservation references. The audit file never stores prompts, outputs, OAuth tokens, refresh tokens, the local bridge bearer token, or raw private operational IDs.

## Contract refresh receipt

The public contract and conformance suite are refreshed against merged gateway baseline `ad1580a5379eed69cc919271932ee082b8c3df88`. The refresh uses fake/local upstreams only. It verifies durable completed-response replay across a gateway restart, fail-closed ambiguous dispatches, local-only disconnect cancellation, and omission of unreported usage. It does not constitute a HyperAgent billing, native cancellation, or provider-idempotency receipt.

## Security design

- Documented Hyperagent OAuth MCP API only.
- OAuth authorization code flow with PKCE and CSRF state.
- Authorization-server issuer/origin validation.
- Least-privilege thread scopes.
- Loopback-only Responses endpoint.
- Independent random bearer token for local bridge requests.
- OAuth and local secrets stored outside the repository.
- POSIX permission hardening where available.
- Main Codex config backed up before App Mode changes.
- Reversible `app-on` / `app-off` workflow.
- Secret-free public source and checksum-published archives.

## Cost incident and remediation

The live v0.4.0 trial revealed unacceptable credit consumption. Root cause analysis found that each Codex App turn could forward tens of thousands of characters of injected app, skills, environment, and AGENTS context into a high-effort Hyperagent run. Codex tool loops create multiple sampling requests per user turn, multiplying the cost. v0.4.0 also lacked a local daily ceiling.

v0.4.1 remediates this with context stripping, bounded recent history, low-effort defaults, a six-request persistent daily cap, prompt/tool ceilings, multi-agent blocking, and budget visibility. Production use also requires a hard per-run budget on the relay agent itself.

## Honest limitations

- Hyperagent does not yet publish a raw first-party Responses inference endpoint; this adapter uses supported agent threads over MCP.
- Each model requires a dedicated named Hyperagent relay agent.
- Each Codex sampling request creates a Hyperagent thread, adding latency.
- Hyperagent MCP does not stream model tokens; the bridge sends keepalives and returns completed output.
- Image input is text-first in the current release.
- Codex Desktop may label the model `Custom` because its provider-aware picker is incomplete.
- An official Hyperagent Responses gateway should replace this adapter when available.
