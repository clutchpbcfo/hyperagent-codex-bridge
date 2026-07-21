# Hyperagent Codex Bridge

A local OAuth bridge that exposes your named Hyperagent agents as a Codex custom model provider. Codex keeps its local coding tools while the reasoning runs happen inside Hyperagent. That should consume Hyperagent credits instead of Codex subscription quota; the verification step below confirms the billing path on your account.

## Straight answer

- **Native first-party Hyperagent provider in Codex:** not currently available. Hyperagent does not publicly expose a raw `/v1/responses` inference API.
- **Working supported path:** yes. This bridge uses Hyperagent's documented OAuth MCP API, then translates between Codex Responses and Hyperagent agent threads.
- **Multiple Hyperagent models:** create one named Hyperagent agent per model you want. Each reachable agent appears as a Codex model such as `hyperagent/sol-coder` or `hyperagent/fable-coder`.

No private browser tokens or undocumented Hyperagent endpoints are used.

> [!IMPORTANT]
> Upgrade from v0.4.0 immediately. That release forwarded too much Codex App context and had no local request ceiling, which could consume credits quickly. v0.4.1 strips injected context, defaults to low effort, blocks recursive multi-agent tools, and enforces a persistent daily request cap.

## Architecture

```text
Codex CLI / App
  -> http://127.0.0.1:47831/v1/responses
  -> Hyperagent OAuth MCP (https://hyperagent.com/api/mcp)
  -> named Hyperagent agent
  -> Hyperagent model + credits
```

The bridge maps Codex function/custom-tool calls back to Codex, so shell commands, patches, file reads, and approvals remain local to Codex.

## Proof of work

Release 0.4.0 is validated by an automated suite plus real Codex 0.144.6:

- OAuth discovery, PKCE, refresh-token rotation, and MCP session handling;
- Codex Responses SSE compatibility;
- a real Codex CLI custom-provider request;
- a complete Hyperagent reasoning -> Codex local shell -> tool result -> Hyperagent final-answer round trip;
- reversible Codex App Mode from the main config without `--profile`;
- local bearer authentication, rollback, and sanitized routing audit receipts;
- secret scan and archive integrity checks.

The public proof target is `hacb audit`: each successful turn produces model and Hyperagent thread IDs without storing prompts, answers, or credentials.

## Public release

- Source: <https://github.com/clutchpbcfo/hyperagent-codex-bridge>
- v0.4.1 ZIP: <https://pub.hyperagent.com/api/published/pbf01KY113X74_6VET28JJ1EW8HQ3Y/hyperagent-codex-bridge-0.4.1.zip>
- SHA-256: <https://pub.hyperagent.com/api/published/pbf01KY113X7F_N3C8P93EZF3ZAEG7/hyperagent-codex-bridge-0.4.1.sha256>

## Requirements

- Node.js 20 or newer
- Current Codex CLI or Codex Desktop
- A Hyperagent account with credits
- At least one **named Hyperagent agent** configured with the model you want to use

For reliable Codex tool use, make each model-specific agent a dedicated relay agent. Use the included `RELAY_AGENT_PROMPT.md` as its system prompt, disable the relay agent's Hyperagent tools, and pin its model in Hyperagent. Codex owns the local shell, files, patches, and approvals; the relay agent only selects those client tools by returning JSON. Clone that agent configuration once per model family you want in Codex.

## Install and connect

Platform guides: `MACOS_QUICKSTART.md` and `WINDOWS_QUICKSTART.md`. New users should start with `docs/NEW_USER_ONBOARDING.md`. Public validation details live in `docs/PROOF_OF_WORK.md`; an article-ready narrative is in `docs/HYPERAGENT_ARTICLE_SECTION.md`.

From a clone or extracted release:

```bash
npm install -g .
hacb setup
```

That flow works on macOS, Windows, and Linux. It:

1. installs the `hacb` command and bundled Codex skill;
2. opens Hyperagent's official OAuth consent flow;
3. discovers reachable named relay agents;
4. writes a separate Codex CLI profile and model catalog;
5. starts the authenticated loopback bridge on `127.0.0.1:47831`.

The skill is installed under `${CODEX_HOME:-~/.codex}/skills/hyperagent-codex-bridge` and can be invoked as `$hyperagent-codex-bridge` or browsed with `/skills`.

Start Codex with Hyperagent credits:

```bash
codex --profile hyperagent
```

## Add a stable model alias

List reachable models and agent IDs:

```bash
hacb models
```

Add a short alias:

```bash
hacb alias sol-coder <agent-id>
hacb profile hyperagent/sol-coder
```

You can also pass an exact agent name instead of its ID if the name is unique.

## Verify

```bash
hacb doctor
hacb status
curl http://127.0.0.1:47831/health
codex --profile hyperagent
```

In Codex, send a small test such as: `Reply with exactly: hyperagent route works.` Then compare your Hyperagent credit/usage view before and after the run. The response includes an `X-Hyperagent-Thread-Id` header and response metadata so the run can be traced to its Hyperagent thread.

## Codex App Mode

The Codex desktop app does not currently expose CLI profiles as first-class provider choices. v0.4.1 includes a reversible App Mode that makes the Hyperagent bridge the default in the main Codex config so **new app chats** use Hyperagent credits:

```bash
hacb app-on hyperagent/codex-relay-sol
```

Fully quit and reopen the Codex app, then start a new chat. App Mode creates a protected backup before changing defaults.

Return new chats to normal OpenAI/Codex subscription defaults while preserving the bridge provider for old chat resume:

```bash
hacb app-off
```

Check the current state and recent sanitized routing receipts:

```bash
hacb app-status
hacb audit 12
```

The audit log records timestamps, model IDs, Hyperagent thread IDs, and completion type, but never prompts, outputs, or tokens. It is the proof that a Codex App turn traversed the bridge.

Do not remove the `hyperagent_credits` provider block while desktop chats created under it still exist; Codex persists the provider id with each chat.

## Direct MCP access, without provider emulation

Codex can also call Hyperagent agents as tools without this bridge. Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.hyperagent]
url = "https://hyperagent.com/api/mcp"
auth = "oauth"
```

Then run:

```bash
codex mcp login hyperagent
```

That route is officially supported, but Hyperagent agents appear as MCP tools, not as entries in Codex's model provider.

## Operations

```bash
hacb start
hacb stop
hacb status
hacb models
hacb profile
hacb logout
```

`hacb serve` runs in the foreground and is best for debugging. Background startup errors are written to `~/.hyperagent-codex-bridge/bridge.log`.

## Rollback

```bash
hacb stop
hacb uninstall-profile
hacb logout
```

Then revoke the OAuth connection at:

<https://hyperagent.com/settings/mcp-access>

CLI mode leaves `~/.codex/config.toml` defaults untouched and uses `~/.codex/hyperagent.config.toml`. App Mode intentionally updates the main config after creating `config.toml.hacb-app-backup`; `hacb app-off` restores the original defaults while retaining the bridge provider for chat resume.

## Cost controls

v0.4.1 fails closed by default:

- low reasoning effort;
- six Hyperagent sampling requests per UTC day;
- 24,000 retained conversation characters;
- 6,000 characters per retained turn;
- eight retained turns;
- 32 forwarded client tools;
- 70,000-character final prompt ceiling;
- multi-agent delegation tools blocked;
- client-requested effort escalation ignored unless explicitly enabled.

Check the local ceiling before work:

```bash
hacb budget
hacb audit 12
```

A Codex tool loop consumes at least two Hyperagent requests. Raising `maxRequestsPerDay`, input limits, or reasoning effort is an explicit operator decision, not an automatic behavior.

These controls do not replace the Hyperagent agent-level budget. Configure each relay agent with low effort and a hard per-run USD cap before production use.

## Security

- The HTTP bridge binds only to `127.0.0.1` and requires a random local bearer token on every model and Responses request.
- The generated Codex profile stores that local-only bearer token with file mode `0600`; it is not a Hyperagent credential.
- OAuth uses PKCE, state validation, issuer/origin binding, dynamic client registration, refresh tokens, and only `threads:read`, `threads:write`, and `offline_access` scopes.
- Hyperagent OAuth tokens are stored in `~/.hyperagent-codex-bridge/state.json` with mode `0600`; the directory uses mode `0700` where the OS supports POSIX permissions.
- Never publish or sync the state directory or generated Codex profile.
- Revoke access from Hyperagent settings if the machine is lost.

## Current limitations

1. **Named agents are the model boundary.** A Hyperagent agent's model is fixed in its agent configuration. Create one agent per desired model.
2. **One Hyperagent thread per Codex sampling request.** This is more latent than a raw inference API, but it preserves supported OAuth and credit accounting.
3. **No true token streaming from Hyperagent MCP.** The bridge sends SSE keepalives, then returns the completed Hyperagent response.
4. **Text-first input.** Image URLs are described to the Hyperagent agent, not uploaded automatically.
5. **Codex Desktop model picker bug.** Current Codex Desktop builds may label custom provider models as `Custom` or hide them. The CLI/profile still sends the configured model ID correctly. Use `hacb profile <model-id>` or `codex --profile hyperagent -m <model-id>` when the picker is unreliable.
6. **Tool-call quality depends on the selected agent.** Its prompt should emphasize exact JSON tool selection and local Codex tool use. The bridge falls back to plain final text if the agent does not follow the relay schema.
7. **This is an adapter, not a Hyperagent product feature.** A future official Hyperagent Responses gateway would be faster and should replace this bridge.

## Sources

- Hyperagent MCP: <https://hyperagent.com/docs/reference/mcp-server>
- Codex custom providers: <https://developers.openai.com/codex/config-advanced>
- Codex MCP OAuth: <https://developers.openai.com/codex/mcp>
- Codex model picker limitation: <https://github.com/openai/codex/issues/19694>
