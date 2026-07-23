# Security policy

## Supported version

Security fixes target the latest release of Hyperagent Codex Bridge.

## Report a vulnerability

Do not open a public issue containing credentials, tokens, private prompts, or exploit details. Email `clutchpbcfo@gmail.com` with:

- affected version;
- operating system and Codex version;
- reproduction steps with all secrets redacted;
- impact and suggested mitigation, if known.

## Security boundaries

The project is designed around these constraints:

- only Hyperagent's documented OAuth MCP endpoint is used;
- OAuth uses authorization code + PKCE and issuer/origin binding;
- the Responses endpoint binds to loopback only;
- each machine receives a random local bearer token;
- OAuth and local bearer tokens stay outside the repository;
- App Mode backs up Codex configuration before changing defaults;
- routing audits never record prompt or answer content.

Never commit or share:

- `~/.hyperagent-codex-bridge/state.json`;
- `~/.hyperagent-codex-bridge/config.json`;
- `~/.hyperagent-codex-bridge/usage.json`;
- `~/.hyperagent-codex-bridge/idempotency.json`;
- `~/.hyperagent-codex-bridge/audit.jsonl` and `gateway.jsonl`;
- `~/.codex/auth.json`;
- generated `hyperagent.config.toml` or App Mode backups.

Revoke a compromised machine at `https://hyperagent.com/settings/mcp-access` and run `hacb logout` locally.
