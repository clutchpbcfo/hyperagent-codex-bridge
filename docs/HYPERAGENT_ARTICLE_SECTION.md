# Article section: Giving Codex a Hyperagent model layer

Codex already has an excellent local execution harness. It can inspect repositories, run commands, apply patches, execute tests, sandbox risky operations, and ask for approval before consequential actions. What it did not have was a clean way to use the model balance and provider choice already available in my Hyperagent account.

So I split the problem in two.

Codex stays responsible for the computer. Hyperagent becomes the reasoning layer.

```text
Codex CLI or Codex App
        |
        | OpenAI Responses-compatible request
        v
Local loopback bridge
        |
        | OAuth-authenticated MCP
        v
Named Hyperagent relay agent
        |
        v
Selected Hyperagent model and credit balance
```

The bridge is intentionally small. It exposes a local Responses-compatible endpoint to Codex, authenticates that endpoint with a machine-specific bearer token, then creates a thread on the selected named Hyperagent agent through Hyperagent's documented OAuth MCP server. The relay agent either returns a final answer or selects one exact Codex client tool in JSON.

That last detail is the important one. Hyperagent does not pretend it edited my Mac. It asks Codex to run the tool locally. Codex executes the shell command or patch under its own sandbox and approval policy, returns the result, and Hyperagent finishes the reasoning turn.

The proof was a complete live loop:

```text
Codex request
-> Hyperagent reasoning
-> local shell tool selection
-> Codex runs pwd on the Mac
-> result returns to Hyperagent
-> final answer returns to Codex
```

The Hyperagent credit meter moved. The Codex subscription meter did not.

The first live build also exposed a serious cost flaw: Codex App was forwarding large developer, skills, environment, and AGENTS payloads into every paid relay call, and each local tool loop required multiple Hyperagent sampling requests. That consumed credits far too quickly. v0.4.1 became the real production boundary: injected-context stripping, eight-turn history, a 24K retained-input ceiling, low-effort defaults, a six-request daily cap, multi-agent blocking, and a required per-run agent budget. The correction matters as much as the successful demo. It turned the bridge from a clever route into an operable system.

I then added App Mode for the desktop client. Codex App does not yet expose CLI profiles cleanly in its provider picker, so App Mode makes a reversible, backed-up change to the main Codex config. New chats show the model as `Custom` and the provider label as `Hyperagent Credits`. One command restores normal Codex subscription defaults:

```bash
hacb app-off
```

The project also emits sanitized routing receipts. `hacb audit` shows the model slug, Hyperagent thread ID, and completion type without storing prompts, answers, or credentials. That turns the integration from a screenshot claim into something auditable.

The public release includes:

- macOS, Windows, and Linux setup;
- a bundled Codex skill and plugin manifest;
- OAuth and local-auth hardening;
- CLI and App Mode switching;
- cross-machine migration without copying secrets;
- automated tests plus real Codex 0.144.6 provider and tool-loop tests;
- rollback commands and explicit limitations.

This is not an official Hyperagent inference API. It is a bridge built entirely on Hyperagent's supported OAuth MCP surface. If Hyperagent ships a first-party Responses gateway, this adapter should become unnecessary. Until then, it proves a useful product idea: coding clients and model platforms do not need to replace one another. The best architecture lets each own the layer it is already good at.
