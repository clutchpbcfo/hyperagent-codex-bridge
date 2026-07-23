# Hyperagent Codex Bridge 0.5.0

Version 0.5.0 turns the bridge's Responses-shaped behavior into a narrow, executable public contract.

## What ships

- An OpenAPI 3.1 document for `POST /v1/responses`.
- A normative SSE event-order state machine.
- Black-box conformance coverage for authentication, model selection, failures, identifiers, local idempotency, cancellation boundaries, and usage semantics.
- Durable local completed-response replay across gateway restarts.
- Conservative handling of indeterminate upstream dispatches.
- Crash-safe request-budget reservations and cross-process coordination.
- Hard timeouts around OAuth/MCP setup, thread creation, polling, and response reads.
- Content-free structured gateway logs and separate liveness/readiness probes.
- Official OpenAI JavaScript client compatibility against the local adapter profile.
- Native-service and loopback-only Linux container guidance.

## Verified boundary

This release is a compatibility profile, not the complete OpenAI Responses API and not a native Hyperagent inference endpoint.

- SSE is framed after a Hyperagent thread completes; it is not native token streaming.
- Usage is omitted because the documented MCP thread result does not provide authoritative token or cost data.
- Idempotency is bounded and local; it is not provider-backed.
- A client disconnect stops local polling but cannot prove that native Hyperagent work stopped.
- The service refuses non-loopback binds and must not be exposed through a public listener or reverse proxy.

## The platform ask

The clean product path remains a first-party Hyperagent gateway with:

- `POST /v1/responses`;
- OAuth bearer authentication;
- native SSE token streaming;
- explicit model and agent selection;
- authoritative usage and cost metadata;
- platform-enforced budgets;
- provider-backed idempotency and cancellation.

That endpoint should replace this adapter.

## Upgrade

```bash
git pull
npm ci
npm install -g .
hacb doctor
hacb budget
```

Run `hacb app-off` before stopping an older bridge while Codex App Mode is active.
