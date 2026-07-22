import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  appendAudit,
  appendGatewayLog,
  commitDailyRequestBudget,
  getDailyBudgetStatus,
  releaseDailyRequestBudget,
  reserveDailyRequestBudget,
  VERSION
} from './config.mjs';
import { HyperagentClient } from './hyperagent.mjs';
import {
  buildAgentModels,
  buildRelayPrompt,
  extractClientTools,
  modelInfo,
  nonStreamingResponse,
  parseRelayOutput,
  resolveAgent,
  responseIds,
  sseEvents
} from './protocol.mjs';

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function json(response, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  response.end(body);
}

function apiError(response, status, message, code = 'bridge_error', headers = {}) {
  json(response, status, {
    error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', code }
  }, headers);
}

function requestId() {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function errorCode(error) {
  if (typeof error?.code === 'string' && /^[a-z0-9_]{2,80}$/i.test(error.code)) return error.code;
  if (error?.name === 'AbortError') return 'client_disconnected';
  if (error?.status === 429) return 'budget_exhausted';
  if (error?.status === 413) return 'request_too_large';
  if (error?.status === 400) return 'invalid_request';
  return 'hyperagent_bridge_error';
}

function abortError() {
  return Object.assign(new Error('Client disconnected; local Hyperagent polling was cancelled.'), {
    status: 499,
    code: 'client_disconnected'
  });
}

function publicErrorMessage(error) {
  if (Number(error?.status || 500) < 500) return error.message || 'Request failed.';
  return 'Hyperagent gateway request failed. Use X-Request-Id to inspect the local structured logs.';
}

function loopbackHost(host) {
  return host === '127.0.0.1' || host === '::1';
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(body) {
  return createHash('sha256').update(canonicalJson(body)).digest('base64url');
}

function idempotencyKey(request) {
  const value = request.headers['idempotency-key'];
  if (value == null) return null;
  if (Array.isArray(value) || !/^[\x21-\x7e]{1,255}$/.test(value)) {
    throw Object.assign(new Error('Idempotency-Key must be 1-255 visible ASCII characters.'), { status: 400, code: 'invalid_idempotency_key' });
  }
  return createHash('sha256').update(value).digest('base64url');
}

function authorized(request, config) {
  const header = String(request.headers.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = String(config.localApiToken || '');
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function writeSse(response, event) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function modelsFor(agents, config) {
  const base = buildAgentModels(agents);
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const aliases = Object.entries(config.aliases || {})
    .filter(([, agentId]) => byId.has(agentId))
    .map(([slug, agentId], index) => ({
      agent: byId.get(agentId),
      slug,
      displayName: `${byId.get(agentId).name} · ${slug}`,
      priority: index + 1
    }));
  const visible = config.exposeAllAgents ? [...aliases, ...base] : aliases;
  const seen = new Set();
  return visible.filter(item => !seen.has(item.slug) && seen.add(item.slug));
}

function etagFor(value) {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 24)}"`;
}

export class BridgeServer {
  constructor(config, { clientFactory, auditWriter, logWriter, budgetGuard, budgetManager } = {}) {
    this.config = config;
    this.server = null;
    this.agentCache = { at: 0, agents: [] };
    this.idempotency = new Map();
    this.clientFactory = clientFactory || (() => new HyperagentClient(this.config));
    this.auditWriter = auditWriter || appendAudit;
    this.logWriter = logWriter || appendGatewayLog;
    this.budgetManager = budgetManager || (budgetGuard
      ? {
          reserve: async configValue => ({ id: null, ...await budgetGuard(configValue) }),
          commit: async reservation => reservation,
          release: async reservation => reservation,
          status: getDailyBudgetStatus
        }
      : {
          reserve: reserveDailyRequestBudget,
          commit: (reservation, configValue) => commitDailyRequestBudget(reservation.id, configValue),
          release: (reservation, configValue, options) => releaseDailyRequestBudget(reservation.id, configValue, options),
          status: getDailyBudgetStatus
        });
  }

  async safeAudit(event) {
    await this.auditWriter(event);
  }

  async safeLog(event) {
    await this.logWriter(event).catch(() => {});
  }

  pruneIdempotency() {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [key, item] of this.idempotency) {
      if (item.at < cutoff) this.idempotency.delete(key);
    }
  }

  async getAgents({ fresh = false } = {}) {
    if (!fresh && this.agentCache.agents.length && Date.now() - this.agentCache.at < 60_000) {
      return this.agentCache.agents;
    }
    const client = this.clientFactory();
    try {
      const agents = await client.listAgents();
      if (!agents.length) throw new Error('Hyperagent returned no reachable agents. Create or share at least one named agent first.');
      this.agentCache = { at: Date.now(), agents };
      return agents;
    } finally {
      await client.close();
    }
  }

  async handleModels(request, response) {
    const agents = await this.getAgents();
    const models = modelsFor(agents, this.config).map(modelInfo);
    const tag = etagFor(models);
    if (request.headers['if-none-match'] === tag) {
      response.writeHead(304, { etag: tag, 'cache-control': 'private, max-age=60' });
      response.end();
      return;
    }
    json(response, 200, {
      models,
      object: 'list',
      data: models.map(model => ({ id: model.slug, object: 'model', owned_by: 'hyperagent' }))
    }, { etag: tag, 'cache-control': 'private, max-age=60' });
  }

  renderCompleted(response, result, { replayed = false, createdSent = false } = {}) {
    const headers = {
      'x-hyperagent-thread-id': result.threadId,
      'x-usage-source': 'unavailable',
      ...(replayed ? { 'x-idempotency-replayed': 'true' } : {})
    };
    if (result.streaming) {
      if (!response.headersSent) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff',
          ...headers
        });
      }
      const events = sseEvents(result.output, result.ids, {
        model: result.model,
        threadId: result.threadId,
        requestId: result.requestId
      });
      for (const event of createdSent ? events.slice(1) : events) writeSse(response, event);
      response.end();
      return;
    }
    json(response, 200, nonStreamingResponse(result.output, result.ids, {
      model: result.model,
      threadId: result.threadId,
      requestId: result.requestId
    }), headers);
  }

  async handleResponses(request, response, serverRequestId) {
    const body = await readJson(request);
    if (!body.model) throw Object.assign(new Error('The model field is required.'), { status: 400, code: 'model_required' });
    this.pruneIdempotency();
    const keyHash = idempotencyKey(request);
    const fingerprint = requestFingerprint(body);
    const previous = keyHash ? this.idempotency.get(keyHash) : null;
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw Object.assign(new Error('Idempotency-Key was already used with a different request body.'), { status: 409, code: 'idempotency_conflict' });
      }
      if (previous.state === 'completed') {
        await this.safeLog({ event: 'idempotency_replayed', requestId: serverRequestId, originalRequestId: previous.requestId });
        this.renderCompleted(response, previous.result, { replayed: true });
        return;
      }
      throw Object.assign(new Error(`Idempotent request cannot be repeated while its outcome is ${previous.state}. Original request ID: ${previous.requestId}.`), {
        status: 409,
        code: previous.state === 'in_progress' ? 'idempotency_in_progress' : 'idempotency_indeterminate',
        headers: { 'retry-after': '2' }
      });
    }
    const idempotencyRecord = keyHash
      ? { fingerprint, state: 'in_progress', requestId: serverRequestId, at: Date.now() }
      : null;
    if (keyHash) this.idempotency.set(keyHash, idempotencyRecord);
    const abort = new AbortController();
    const cancel = () => {
      if (!abort.signal.aborted) abort.abort(abortError());
    };
    const onResponseClose = () => {
      if (!response.writableEnded) cancel();
    };
    request.once('aborted', cancel);
    response.once('close', onResponseClose);
    let agent;
    let reservation;
    let budget;
    let client;
    let threadId;
    let keepalive;
    let dispatched = false;
    let agents;
    try {
      agents = await this.getAgents();
    } catch (error) {
      if (keyHash) this.idempotency.delete(keyHash);
      throw error;
    }
    try {
      agent = resolveAgent(body.model, agents, this.config);
    } catch (error) {
      if (keyHash) this.idempotency.delete(keyHash);
      error.status = 400;
      error.code = 'unknown_model';
      throw error;
    }
    let tools;
    let prompt;
    try {
      tools = extractClientTools(body, this.config);
      prompt = buildRelayPrompt(body, agent, this.config, tools);
    } catch (error) {
      if (keyHash) this.idempotency.delete(keyHash);
      throw error;
    }
    if (prompt.length > Math.max(10000, Number(this.config.maxPromptChars || 70000))) {
      if (keyHash) this.idempotency.delete(keyHash);
      throw Object.assign(new Error(`Sanitized relay prompt is still too large (${prompt.length} chars). Start a new Codex chat or reduce attached context.`), { status: 413, code: 'prompt_too_large' });
    }
    const ids = responseIds();
    const streaming = body.stream === true;
    try {
      if (abort.signal.aborted) throw abort.signal.reason;
      reservation = await this.budgetManager.reserve(this.config, { requestId: serverRequestId });
      await this.safeAudit({
        event: 'request_reserved',
        requestId: serverRequestId,
        model: body.model,
        agentId: agent.id,
        streaming,
        promptChars: prompt.length,
        toolCount: tools.length,
        dailyUsed: reservation.used,
        dailyLimit: reservation.limit,
        budgetReservationId: reservation.id
      });
      if (abort.signal.aborted) throw abort.signal.reason;
      client = this.clientFactory();
      if (abort.signal.aborted) throw abort.signal.reason;
      budget = await this.budgetManager.commit(reservation, this.config);
      dispatched = true;
      threadId = await client.createThread(agent.id, prompt, { signal: abort.signal });
      await this.safeAudit({ event: 'thread_created', requestId: serverRequestId, model: body.model, agentId: agent.id, threadId });
      if (streaming) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'x-hyperagent-thread-id': threadId,
          'x-usage-source': 'unavailable',
          'x-content-type-options': 'nosniff'
        });
        response.flushHeaders?.();
        writeSse(response, {
          type: 'response.created',
          response: {
            id: ids.responseId,
            status: 'in_progress',
            model: body.model,
            output: [],
            metadata: { hyperagent_thread_id: threadId, request_id: serverRequestId, usage_source: 'unavailable' }
          }
        });
        keepalive = setInterval(() => {
          if (!response.destroyed && !response.writableEnded) response.write(': hyperagent-running\n\n');
        }, 12_000);
        keepalive.unref?.();
      }

      const result = await client.waitForThread(threadId, { signal: abort.signal });
      const output = parseRelayOutput(result.text, tools);
      const completed = { output, ids, model: body.model, threadId, requestId: serverRequestId, streaming };
      await this.safeAudit({
        event: 'completed',
        requestId: serverRequestId,
        model: body.model,
        agentId: agent.id,
        threadId,
        outputType: output.type,
        dailyCommitted: budget.committed,
        dailyLimit: budget.limit,
        usageSource: 'unavailable'
      });
      if (idempotencyRecord) {
        idempotencyRecord.state = 'completed';
        idempotencyRecord.result = completed;
        idempotencyRecord.at = Date.now();
      }
      this.renderCompleted(response, completed, { createdSent: streaming });
    } catch (error) {
      const code = errorCode(error);
      if (reservation && !dispatched) {
        await this.budgetManager.release(reservation, this.config, { reason: code }).catch(() => {});
      }
      if (idempotencyRecord) {
        if (dispatched) {
          idempotencyRecord.state = 'indeterminate';
          idempotencyRecord.threadId = threadId || null;
          idempotencyRecord.at = Date.now();
        } else {
          this.idempotency.delete(keyHash);
        }
      }
      await this.safeAudit({
        event: code === 'client_disconnected' ? 'cancelled' : 'failed',
        requestId: serverRequestId,
        model: body.model,
        agentId: agent.id,
        threadId: threadId || null,
        errorCode: code,
        dispatched,
        cancellationScope: code === 'client_disconnected' ? 'local_polling_only' : undefined
      }).catch(() => {});
      if (streaming && response.headersSent && !response.destroyed && !response.writableEnded) {
        writeSse(response, {
          type: 'response.failed',
          response: {
            id: ids.responseId,
            status: 'failed',
            model: body.model,
            output: [],
            error: { message: 'Hyperagent request failed. Use the request ID to inspect local gateway logs.', type: 'server_error', code },
            metadata: { hyperagent_thread_id: threadId || null, request_id: serverRequestId, usage_source: 'unavailable' }
          }
        });
        response.end();
      } else {
        throw error;
      }
    } finally {
      if (keepalive) clearInterval(keepalive);
      request.removeListener('aborted', cancel);
      response.removeListener('close', onResponseClose);
      if (client) await client.close().catch(() => this.safeLog({ event: 'client_close_failed', requestId: serverRequestId }));
    }
  }

  async handleReady(response) {
    try {
      const [agents, budget] = await Promise.all([
        this.getAgents(),
        this.budgetManager.status(this.config)
      ]);
      if (!agents.length || budget.remaining < 1) throw Object.assign(new Error('Gateway is not ready.'), { code: 'not_ready' });
      json(response, 200, { ready: true, service: 'hyperagent-codex-bridge', version: VERSION });
    } catch {
      json(response, 503, { ready: false, service: 'hyperagent-codex-bridge', version: VERSION });
    }
  }

  async route(request, response, serverRequestId) {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
      json(response, 200, { ok: true, service: 'hyperagent-codex-bridge', version: VERSION });
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/v1/ready')) {
      await this.handleReady(response);
      return;
    }
    if (!authorized(request, this.config)) {
      apiError(response, 401, 'Missing or invalid local bridge bearer token.', 'unauthorized', {
        'www-authenticate': 'Bearer realm="hyperagent-codex-bridge"'
      });
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/models' || url.pathname === '/v1/models')) {
      await this.handleModels(request, response);
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/responses' || url.pathname === '/v1/responses')) {
      await this.handleResponses(request, response, serverRequestId);
      return;
    }
    apiError(response, 404, `Unknown route ${request.method} ${url.pathname}`, 'not_found');
  }

  async start() {
    if (this.server) return this;
    if (!loopbackHost(this.config.bridgeHost)) {
      throw new Error(`Refusing to bind the gateway to non-loopback host '${this.config.bridgeHost}'. Use 127.0.0.1 or ::1.`);
    }
    this.server = createServer((request, response) => {
      const serverRequestId = requestId();
      const startedAt = Date.now();
      response.setHeader('x-request-id', serverRequestId);
      let logged = false;
      const logFinished = event => {
        if (logged) return;
        logged = true;
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        void this.safeLog({
          event,
          requestId: serverRequestId,
          method: request.method,
          path: url.pathname,
          status: response.statusCode,
          durationMs: Date.now() - startedAt
        });
      };
      response.once('finish', () => logFinished('http_request_completed'));
      response.once('close', () => {
        if (!response.writableEnded) logFinished('http_request_disconnected');
      });
      this.route(request, response, serverRequestId).catch(error => {
        const code = errorCode(error);
        void this.safeLog({ event: 'request_error', requestId: serverRequestId, errorCode: code });
        if (response.headersSent || response.destroyed) {
          if (!response.destroyed) response.end();
          return;
        }
        apiError(response, error.status || 500, publicErrorMessage(error), code, error.headers || {});
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.bridgePort, this.config.bridgeHost, resolve);
    });
    return this;
  }

  async close() {
    if (!this.server) return;
    await new Promise(resolve => this.server.close(resolve));
    this.server = null;
  }
}
