import { getAccessToken } from './oauth.mjs';
import { VERSION } from './config.mjs';

function timeoutError() {
  return Object.assign(new Error('The upstream request timed out.'), { status: 504, code: 'upstream_timeout' });
}

function boundedSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError()), Math.max(1, Number(timeoutMs) || 30_000));
  timer.unref?.();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

function parseSse(text, expectedId) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim());
    if (!dataLines.length) continue;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') continue;
    try {
      messages.push(JSON.parse(payload));
    } catch {
      // Ignore SSE comments and non-JSON keepalives.
    }
  }
  return messages.find(message => message?.id === expectedId) || messages.at(-1) || null;
}

function contentText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  const content = result.content || result.result?.content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part?.type === 'text') return part.text || '';
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function decodeToolResult(result) {
  const text = contentText(result);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (result?.structuredContent != null) return result.structuredContent;
  if (result?.result?.structuredContent != null) return result.result.structuredContent;
  return result;
}

export class McpClient {
  constructor(config) {
    this.config = config;
    this.nextId = 1;
    this.sessionId = null;
    this.protocolVersion = '2025-06-18';
    this.initialized = false;
  }

  async request(method, params, { notification = false, signal, timeoutMs } = {}) {
    const id = notification ? undefined : this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      method,
      ...(params === undefined ? {} : { params })
    };
    const bounded = boundedSignal(signal, timeoutMs || this.config.mcpRequestTimeoutMs);
    let token;
    try {
      token = await getAccessToken(this.config, { signal: bounded.signal });
    } catch (error) {
      bounded.cleanup();
      if (!error.dispatchState) error.dispatchState = 'not_dispatched';
      throw error;
    }
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': this.protocolVersion,
      'user-agent': `hyperagent-codex-bridge/${VERSION}`
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    let response;
    try {
      if (bounded.signal.aborted) {
        const error = bounded.signal.reason || timeoutError();
        error.dispatchState = 'not_dispatched';
        throw error;
      }
      response = await fetch(this.config.mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: bounded.signal
      });
    } catch (error) {
      bounded.cleanup();
      if (!error.dispatchState) error.dispatchState = 'indeterminate';
      throw error;
    }
    const newSessionId = response.headers.get('mcp-session-id');
    if (newSessionId) this.sessionId = newSessionId;
    if (notification && response.status === 202) {
      bounded.cleanup();
      return null;
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (!error.dispatchState) error.dispatchState = 'dispatched';
      throw error;
    } finally {
      bounded.cleanup();
    }
    if (response.status === 401) {
      throw new Error('Hyperagent authorization was rejected. Run hacb login again.');
    }
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!text) return null;

    const contentType = response.headers.get('content-type') || '';
    const envelope = contentType.includes('text/event-stream')
      ? parseSse(text, id)
      : JSON.parse(text);
    if (!envelope) throw new Error(`MCP response did not contain JSON-RPC data for ${method}.`);
    if (envelope.error) {
      throw new Error(`MCP ${method} failed: ${envelope.error.message || JSON.stringify(envelope.error)}`);
    }
    return envelope.result;
  }

  async connect({ signal } = {}) {
    if (this.initialized) return this;
    const result = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: 'hyperagent-codex-bridge', version: VERSION }
    }, { signal });
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    await this.request('notifications/initialized', undefined, { notification: true, signal });
    this.initialized = true;
    return this;
  }

  async listTools() {
    await this.connect();
    return this.request('tools/list', {});
  }

  async callTool(name, args = {}, { signal, timeoutMs } = {}) {
    const bounded = boundedSignal(signal, timeoutMs || this.config.mcpRequestTimeoutMs);
    try {
      try {
        await this.connect({ signal: bounded.signal });
      } catch (error) {
        if (name === 'create_thread') error.dispatchState = 'not_dispatched';
        throw error;
      }
      const result = await this.request('tools/call', { name, arguments: args }, {
        signal: bounded.signal,
        timeoutMs: timeoutMs || this.config.mcpRequestTimeoutMs
      });
      if (result?.isError) {
        const error = new Error(`Hyperagent tool ${name} failed.`);
        error.dispatchState = 'dispatched';
        throw error;
      }
      return result;
    } finally {
      bounded.cleanup();
    }
  }

  async close() {
    if (!this.sessionId) return;
    const token = await getAccessToken(this.config, { require: false }).catch(() => null);
    if (!token) return;
    await fetch(this.config.mcpUrl, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        'mcp-session-id': this.sessionId,
        'mcp-protocol-version': this.protocolVersion
      }
    }).catch(() => {});
    this.sessionId = null;
    this.initialized = false;
  }
}
