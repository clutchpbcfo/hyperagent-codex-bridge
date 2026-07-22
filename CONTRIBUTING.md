# Contributing

Contributions are welcome when they preserve the security boundary and supported API surface.

## Development

```bash
npm test
```

Run the real Codex integration tests when Codex is installed:

```bash
CODEX_BIN="$(command -v codex)" npm test
```

The official OpenAI JavaScript client fixture runs in the default suite against a fully mocked bridge. To include the Python client fixture without making Python a Node package prerequisite:

```bash
python3 -m venv .venv
.venv/bin/pip install -r fixtures/requirements.txt
OPENAI_PYTHON_BIN="$PWD/.venv/bin/python" npm test
```

Both fixtures use local mock Hyperagent clients. They require no OAuth credentials, real provider calls, or credits.

## Pull request requirements

- Keep Node.js support at version 20 or newer.
- Add or update tests for behavior changes.
- Do not add dependencies unless the maintenance and security cost is justified.
- Do not add undocumented Hyperagent endpoints, browser-token extraction, or session scraping.
- Never log prompt content, model output, OAuth tokens, refresh tokens, or local bearer tokens.
- Preserve `hacb app-off` rollback and existing-chat provider compatibility.
- Update the plugin manifest, skill docs, platform guides, and changelog when commands change.
- Run a secret scan before submitting.

## Commit style

Use concise conventional-style subjects, for example:

```text
feat: add Windows skill installer
fix: preserve provider block during app rollback
test: cover Codex App Mode main-config routing
```
