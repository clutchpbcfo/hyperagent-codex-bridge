# Hyperagent Codex Bridge v0.4.0

The first public proof-of-work release.

## Highlights

- Route Codex CLI and Codex App reasoning through named Hyperagent agents and Hyperagent credits.
- Keep Codex's local shell, files, patches, tests, sandboxing, and approvals.
- OAuth authorization code + PKCE against Hyperagent's documented MCP server.
- Reversible `hacb app-on` / `hacb app-off` workflow for Codex App.
- Global `$hyperagent-codex-bridge` skill and Codex plugin manifest.
- macOS and Windows/Ryzen setup guides.
- Sanitized `hacb audit` receipts with Hyperagent thread IDs.
- 19 passing tests, including real Codex CLI 0.144.6 provider, local tool-loop, and main-config App Mode runs.

## Live validation

The release was verified on an Apple Silicon MacBook Air:

- App Mode: ON
- Model: `hyperagent/codex-relay-sol`
- Provider: `hyperagent_credits`
- Codex App displayed `Custom` and `Hyperagent Credits`
- Hyperagent returned a real Codex `function_call`
- Codex ran the tool locally and returned its result
- Hyperagent produced the final answer
- Hyperagent credits changed while Codex subscription quota did not

See `docs/LIVE_MAC_PROOF_2026-07-20.md` and `docs/PROOF_OF_WORK.md`.

## Install

```bash
git clone https://github.com/clutchpbcfo/hyperagent-codex-bridge.git
cd hyperagent-codex-bridge
npm install -g .
hacb setup
```

## Security

No credentials are included in the repository or release assets. Every machine receives its own OAuth grant and local bearer token. Review `SECURITY.md` before deployment.

## Downloads

- ZIP: https://pub.hyperagent.com/api/published/pbf01KY0PQYDC_R4GR7YQZWJEVJ4CZ/hyperagent-codex-bridge-0.4.0.zip
- SHA-256: https://pub.hyperagent.com/api/published/pbf01KY0PQYDQ_9S962DWX4ZA0TPRV/hyperagent-codex-bridge-0.4.0.sha256
