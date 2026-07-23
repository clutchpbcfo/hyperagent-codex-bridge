# Self-hosting and containers

The supported security boundary is a same-machine gateway bound to `127.0.0.1` (or `::1`) with local bearer authentication. The bridge refuses `0.0.0.0`, public interfaces, and container port-publication configurations that would widen that boundary.

## Native service (recommended)

Install and authorize as the unprivileged account that runs Codex:

```bash
npm install -g .
hacb setup
hacb doctor
```

For a service manager, run `hacb serve` as that same account, set `HACB_HOME` to a private persistent directory, restart on failure, and use these probes:

```text
GET http://127.0.0.1:47831/health  # process liveness only
GET http://127.0.0.1:47831/ready   # agent availability and budget capacity
```

Protect the state directory as user-only. It contains OAuth state, the local bearer token, budget state, and sanitized audit/structured logs. Do not copy it into images, source control, backups shared with other users, or CI artifacts.

## Linux container

Container NAT cannot reach a service that is deliberately bound to the container's own loopback interface. On a single-user Linux host, the provided `Dockerfile` can run with host networking so the container and Codex share the host loopback namespace:

```bash
docker build -t hacb-local .
docker volume create hacb-state
docker run --rm -it --network host -v hacb-state:/state hacb-local node src/cli.mjs login
docker run -d --name hacb --restart unless-stopped --network host -v hacb-state:/state hacb-local
```

Run `hacb profile` natively with the same selected model, or mount only the generated profile where Codex expects it. Never bake `/state`, a generated profile, or any token into the image.

Do not use `-p 47831:47831`, Kubernetes Service/Ingress objects, a public load balancer, or a reverse proxy. They either will not work with loopback binding or would require weakening the intended trust boundary. Docker Desktop networking on macOS/Windows does not provide the same supported loopback relationship; use the native service there.

## Operational limits

- `/ready` may contact Hyperagent's documented OAuth MCP endpoint to establish or refresh the recent agent cache. It does not create a thread or intentionally consume a sampling request.
- A client disconnect aborts local MCP polling. There is no documented Hyperagent remote-cancel operation, so an already-dispatched thread may continue and its local budget slot remains committed.
- The gateway cannot report token or dollar usage because the documented MCP thread result does not provide authoritative usage. Responses omit `usage` and identify the source as unavailable.
- Bounded local idempotency state is stored with machine-local permissions and a 24-hour default lifetime. It coordinates bridge processes and replays completed responses after restart. An indeterminate `create_thread` outcome remains blocked after restart because the provider does not offer authoritative upstream idempotency or outcome lookup by local key.
