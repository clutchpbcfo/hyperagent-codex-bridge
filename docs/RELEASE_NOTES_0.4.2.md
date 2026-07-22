# Hyperagent Codex Bridge 0.4.2

Version 0.4.2 makes the v0.4.1 cost-control promise true for upgrades as well as clean installations.

## Why this release exists

An existing machine could retain a larger request ceiling written by an earlier build. The source default was six, but the persisted machine configuration still won. A second bridge process could also race the usage counter. Both behaviors weakened the local spend rail.

## What changed

- Unversioned legacy configurations migrate to the six-request safe ceiling.
- OAuth tokens and the machine-local bearer secret are preserved during migration.
- Explicitly versioned operator overrides remain supported and are identified by `hacb doctor` when they exceed the safe default.
- `hacb budget --safe` restores the safe ceiling.
- `hacb budget --set <count>` makes any increase explicit.
- A cross-process lock makes the daily ceiling atomic and fail-closed.
- GitHub Actions now validates Node.js 20 and 22 on Linux, macOS, and Windows.
- The committed lockfile makes installs and audits reproducible.

## Upgrade

```bash
git pull
npm install -g .
hacb budget
hacb doctor
```

The first v0.4.2 command load migrates an unversioned unsafe legacy ceiling to six. No OAuth grant is replaced.

## Safety boundary

The bridge still uses only Hyperagent's documented OAuth MCP endpoint, binds locally to `127.0.0.1`, and stores no prompts or answers in its audit log. Raising the local ceiling does not replace the separate hard per-run budget configured on each Hyperagent relay agent.
