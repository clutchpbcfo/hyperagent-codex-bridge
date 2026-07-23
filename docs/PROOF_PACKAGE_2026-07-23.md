# v0.5.0 proof package

## Public claim

Hyperagent Codex Bridge lets Codex use named Hyperagent agents as a reasoning layer while Codex retains local tools, filesystem access, patches, tests, sandboxing, and approvals.

The implementation uses only Hyperagent's documented OAuth MCP surface. It is not a first-party Hyperagent inference API.

## Source evidence

- Public repository: <https://github.com/clutchpbcfo/hyperagent-codex-bridge>
- License: MIT
- Normative API profile: [`spec/openapi.json`](../spec/openapi.json)
- SSE state machine: [`docs/contracts/responses-sse.md`](contracts/responses-sse.md)
- Ownership and limitation ADR: [`docs/adr/0001-public-responses-contract.md`](adr/0001-public-responses-contract.md)
- Live Mac proof: [`docs/LIVE_MAC_PROOF_2026-07-20.md`](LIVE_MAC_PROOF_2026-07-20.md)
- Security policy: [`SECURITY.md`](../SECURITY.md)
- Rollback and operations: [`README.md`](../README.md) and [`docs/SELF_HOSTING.md`](SELF_HOSTING.md)

## Reproducible verification

From a clean checkout:

```bash
npm ci
npm test
```

The release workflow runs on Linux, macOS, and Windows under Node.js 20 and 22. It also validates the committed lockfile, plugin-version agreement, OpenAPI document, conformance profile, and secret-free source boundary.

The v0.5.0 local release-candidate run on July 23, 2026 completed with:

- 75 passed;
- 0 failed;
- 3 intentionally skipped environment-dependent tests.

The skipped tests require a real Codex binary/App Mode environment or an independently prepared Python OpenAI client environment. The official OpenAI JavaScript client fixture passed.

## End-to-end proof already captured

The July 20 Mac receipt proves:

1. OAuth completed through Hyperagent's documented MCP authorization flow.
2. Codex selected a named Hyperagent relay agent.
3. Hyperagent chose a local Codex shell tool.
4. Codex ran the tool locally.
5. The result returned to Hyperagent.
6. The final answer returned to Codex.
7. Hyperagent credits changed while Codex subscription quota did not.
8. Codex App Mode displayed `Custom` and `Hyperagent Credits`.

## Spend and failure controls

- Six-request safe daily default.
- Cross-process atomic budget admission.
- Durable reservation before provider dispatch.
- Conservative commitment of ambiguous dispatches.
- Bounded local idempotency and completed-response replay.
- Input, history, tool, and output ceilings.
- Multi-agent blocking inside the relay path.
- Loopback-only bind with a machine-specific local bearer token.
- Sanitized logs and receipts that omit prompts, answers, OAuth tokens, bearer tokens, and raw private operational identifiers.

## Claims deliberately not made

- No native Hyperagent token streaming.
- No authoritative token, price, credit, or dollar usage per response.
- No provider-backed idempotency.
- No native Hyperagent thread cancellation.
- No complete OpenAI Responses API compatibility.
- No recommendation to expose the adapter publicly.

## Release integrity

The GitHub release must attach:

- a source archive;
- a SHA-256 checksum file;
- these release notes;
- the immutable release commit;
- the successful CI run.

The checksum is calculated over the exact attached archive, not a moving branch.
