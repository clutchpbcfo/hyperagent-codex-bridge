# ADR 0001: Public Responses adapter contract

- Status: Proposed
- Date: 2026-07-22
- Gateway baseline: merged PR #4 at `ad1580a5379eed69cc919271932ee082b8c3df88`
- Release tag: `v0.4.2` at `4e1372e3ad514aa4e438628a9e6af0588f6025a6`
- Decision owners: Hyperagent Codex Bridge maintainers

## Context

Codex supports custom model providers that use the Responses wire API. HyperAgent does not document a raw Responses inference endpoint. Its documented integration surface is the OAuth-authenticated HTTP MCP server at `https://hyperagent.com/api/mcp`. The MCP server lets a client list reachable agents, create a background thread, and poll the thread for results.

This repository therefore implements a loopback adapter. The adapter accepts a deliberately small Responses-shaped contract, selects a named HyperAgent agent, creates one HyperAgent thread, polls it to completion, and maps the final relay action into a Codex-compatible response.

The contract is a compatibility profile, not a representation of the complete OpenAI Responses API and not a HyperAgent product API.

## Decision

The normative public contract is:

- the OpenAPI 3.1 document at [`spec/openapi.json`](../../spec/openapi.json);
- the streaming state machine at [`docs/contracts/responses-sse.md`](../contracts/responses-sse.md); and
- the executable black-box tests under [`test/conformance/`](../../test/conformance/).

Normative terms such as MUST, MUST NOT, SHOULD, and MAY are used as described by RFC 2119.

Only `POST /v1/responses` is claimed as the Responses proof surface. The implementation also has health, model-catalog, and historical unversioned aliases; those aliases are not evidence of wider OpenAI API compatibility.

## Ownership boundary

| Capability | External loopback adapter | HyperAgent native service |
| --- | --- | --- |
| Accept `POST /v1/responses` | Owns | Does not expose this route in the cited public docs |
| Validate the local bearer token | Owns | Does not receive the local token |
| Resolve `model` to a reachable agent | Owns the alias/slug mapping | Owns agent identity, configuration, and access |
| Route to an underlying model | Does not own or observe native routing | Owns the configured agent model and execution |
| Format SSE events and keepalive comments | Owns | Returns background thread state through MCP |
| Token-by-token streaming | Does not provide it | Not documented by the cited MCP contract |
| Create and execute a thread | Requests it through documented MCP tools | Owns execution |
| Billing, credits, prices, and token accounting | Does not own and MUST NOT infer them | Owns native accounting; no billing API is used here |
| Client disconnect handling | Stops local polling | No native thread cancellation is claimed |
| Server-side response cancellation | Unsupported | No cancellation tool is documented in the cited MCP contract |
| Idempotent replay | Owns bounded, durable local coordination and completed-response replay | No upstream idempotency behavior is claimed |

The adapter MUST NOT claim that zero-valued usage fields prove zero tokens or zero cost. It MUST NOT claim that closing the HTTP connection cancels a HyperAgent thread or prevents charges.

## Request contract

### Authentication

`POST /v1/responses` requires exactly one local `Authorization: Bearer <token>` credential. The credential is a random loopback-adapter secret, not an OpenAI key and not a HyperAgent OAuth token.

- Missing, empty, malformed, or unequal credentials return HTTP 401.
- The comparison is constant-time after a length check.
- The error has code `unauthorized` and the response includes `WWW-Authenticate: Bearer realm="hyperagent-codex-bridge"`.
- The local token MUST NOT be forwarded upstream, logged, or placed in response metadata.

HyperAgent OAuth is a separate adapter-to-upstream concern. The only supported upstream is the documented MCP endpoint. This contract does not expose OAuth credentials to Responses clients.

### Media type and size

The body MUST be valid JSON and is limited to 8 MiB of received bytes. An empty body parses as an empty object and then fails the required-model check. The current adapter does not reject a missing or non-JSON `Content-Type`; JSON parsing, rather than content-type negotiation, is authoritative.

### Model and agent selection

`model` is required and is interpreted as an adapter routing identifier. It is not a request for HyperAgent to dynamically choose or override an agent's configured native model.

Resolution is exact and fail closed in this order:

1. exact configured alias key to its agent ID;
2. exact generated `hyperagent/<slug>` identifier from the current reachable-agent list;
3. exact reachable agent ID; and
4. exact case-sensitive agent name.

Unknown identifiers never fall back to `defaultAgentId`. An unavailable alias, duplicate identifier, duplicate case-folded name, colliding generated slug, case-folded alias conflict, or alias collision with another agent's natural identifier fails with HTTP 400 before budget reservation or thread creation.

The agent's configured model, effort, tools, budget, native router, and billing remain HyperAgent-owned. The adapter forwards only the selected agent ID to `create_thread`.

### Input and tools

The adapter accepts the text-first subset described in the OpenAPI document. It sanitizes and bounds retained turns before building one self-contained relay prompt. It maps supported function, custom, and client tool-search actions back to Codex. Unsupported fields are not evidence of OpenAI feature support merely because JSON parsing ignores them.

Each accepted sampling request reserves the persistent daily-request budget before dispatch. A proven pre-dispatch failure releases that reservation. Immediately before `create_thread`, the reservation becomes `dispatching`; success commits it, and an indeterminate outcome remains conservatively committed. On restart, abandoned `reserved` work is released and abandoned `dispatching` work is committed. A reached budget returns HTTP 429. Failure to acquire the local budget lock returns HTTP 503.

## Response and identifier semantics

Each newly claimed Responses operation gets an adapter-generated `resp_...` identifier. Output item and call identifiers are generated from the same random UUID material. These identifiers:

- are unique adapter correlation values for that HTTP exchange;
- are not HyperAgent thread IDs;
- are not durable resources and cannot be retrieved or cancelled later; and
- are reused only when a completed local idempotency record is replayed.

Each HTTP attempt also receives a fresh adapter-generated `X-Request-Id`; a client-supplied value is ignored. `metadata.request_id` identifies the originating dispatch and therefore remains stable in a replayed response body even though the replay attempt has a new header request ID.

After upstream thread creation, the HyperAgent thread ID is returned in `X-Hyperagent-Thread-Id` and in `metadata.hyperagent_thread_id`. The metadata value is a private local trace reference, not a Responses resource ID; logs use only its hashed reference.

`stream` defaults to true. Only the literal JSON value `false` selects a non-streaming JSON response.

## Errors

Before SSE headers are sent, failures use the JSON envelope:

```json
{
  "error": {
    "message": "human-readable message",
    "type": "invalid_request_error",
    "code": "hyperagent_bridge_error"
  }
}
```

`type` is `server_error` for HTTP 5xx and `invalid_request_error` otherwise. Messages and codes come from a finite adapter-owned mapping. Upstream response bodies, exception messages, agent IDs, thread IDs, reservation IDs, credentials, prompts, and outputs MUST NOT be reflected in an error. Unclassified failures use code `hyperagent_bridge_error` and a generic message keyed by `X-Request-Id`.

| Condition | HTTP status | Transport |
| --- | ---: | --- |
| Missing/invalid local bearer | 401 | JSON error |
| Malformed JSON, missing model, unknown/duplicate/ambiguous model selection | 400 | Sanitized JSON error |
| Idempotency conflict, in-progress operation, or indeterminate outcome | 409 | Sanitized JSON error |
| Body or sanitized prompt too large | 413 | JSON error |
| Daily request cap reached | 429 | JSON error |
| Budget lock unavailable | 503 | JSON error |
| Unknown route | 404 | JSON error |
| Upstream failure before streaming headers | 500 unless the error carries another status | JSON error |
| Upstream failure after `response.created` | HTTP 200 already committed | terminal `response.failed` SSE event |

An SSE stream MUST have exactly one terminal event: `response.completed` or `response.failed`. See the state-machine contract for exact ordering.

## Idempotency

`Idempotency-Key` values are validated, hashed, and coordinated through a permission-restricted local journal shared across processes. The default retention is 24 hours with at most 256 entries. The same key and canonical request body replay a completed local response without another budget reservation or thread. A changed body returns `idempotency_conflict`; concurrent work returns `idempotency_in_progress`; and a dispatch whose result cannot be proven returns `idempotency_indeterminate` across restart.

This guarantee is local and bounded. It does not create a provider-side idempotency key, Responses retrieval resource, or authoritative reconciliation API. Deleting the local state, exceeding retention, moving to another machine, or retrying without the same key removes local protection. An indeterminate provider outcome is deliberately not redispatched.

## Cancellation and timeout

The adapter exposes no response-retrieval or response-cancellation route. OpenAI background cancellation semantics are out of scope.

If the client disconnects or aborts while waiting:

1. the adapter aborts its local polling wait;
2. the SSE/HTTP response ends without a guaranteed terminal event because the peer is gone;
3. the adapter records a sanitized `cancelled` audit event with `cancellationScope = local_polling_only`; and
4. the already-created HyperAgent thread is not cancelled through MCP.

OAuth/MCP setup, `create_thread`, each polling request, response-body reads, and the overall wait use abort signals and hard local time bounds. A timeout stops local work and reports a sanitized failure, but this contract cannot promise that native work stopped. The documented HyperAgent MCP tool list cited below has no cancellation operation.

## Usage and billing

Successful JSON responses and `response.completed` events omit `usage`. Omission means unknown/not reported by this adapter; zero is never fabricated. The adapter does not obtain native token usage, prices, credit deltas, router decisions, or billing receipts from the documented MCP flow. Billing evidence must come from a HyperAgent-owned interface, outside this contract and without exposing credentials.

## SSE compatibility decision

The adapter emits a small ordered subset of Responses-style events sufficient for its Codex provider integration. It does not claim full conformance with every event and field in the OpenAI Responses API. Notably, current events omit `sequence_number`, and text output does not emit the full content-part lifecycle shown by the OpenAI reference.

This limitation is intentional in this ADR: the executable suite freezes the behavior that exists at the v0.4.2 baseline. Expanding the event grammar requires a separately reviewed gateway change and updated contract tests.

`response.incomplete` and `status = incomplete` are unsupported and are never emitted by this profile. A future implementation must define incomplete details, terminal ordering, and retry semantics before adding them.

## Security and privacy

- The service is intended for `127.0.0.1` and MUST NOT be deployed publicly under this contract.
- Prompts, outputs, local bearer secrets, OAuth credentials, and raw agent/thread/reservation IDs MUST NOT appear in logs or audit receipts. Private operational IDs are removed or represented by stable truncated hashes.
- Fake upstreams are mandatory in conformance tests; no real model, credit, OAuth grant, or private endpoint is used.
- Native HyperAgent model/router/billing behavior is not simulated as fact. Fakes test only adapter obligations.

## Consequences

The contract is honest and executable, but narrower than the full OpenAI Responses API. Clients get stable request/response framing, bounded local replay protection, and Codex tool-loop compatibility. They do not get native token streaming, provider-side idempotency, durable Responses resources, server-side cancellation, incomplete responses, or authoritative usage/billing data.

## Official public sources

Accessed 2026-07-22:

- HyperAgent, [MCP server](https://www.hyperagent.com/docs/reference/mcp-server/): hosted endpoint, OAuth consent, reachable-agent access, `list_agents`, `create_thread`, and polling `get_thread`.
- HyperAgent, [Agent configuration](https://www.hyperagent.com/docs/reference/agent-configuration): agent-owned model, effort, thinking, and budget configuration.
- OpenAI, [Codex advanced configuration](https://developers.openai.com/codex/config-advanced): custom providers and `wire_api = "responses"`.
- OpenAI, [Streaming Responses](https://platform.openai.com/docs/guides/streaming-responses): Responses SSE transport and principal event types.
- OpenAI, [Responses streaming events reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/created): reference event schemas and ordering fields.

No undocumented HyperAgent route, credential, live model, or live credit was used to produce this decision.
