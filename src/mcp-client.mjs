import { getAccessToken } from './oauth.mjs';
import { VERSION } from './config.mjs';

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

  async request(method, params, { notification = false } = {}) {
    const id = notification ? undefined : this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      method,
      ...(params === undefined ? {} : { params })
    };
    const token = await getAccessToken(this.config);
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': this.protocolVersion,
      'user-agent': `hyperagent-codex-bridge/${VERSION}`
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const response = await fetch(this.config.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const newSessionId = response.headers.get('mcp-session-id');
    if (newSessionId) this.sessionId = newSessionId;
    if (notification && response.status === 202) return null;
    const text = await response.text();
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

  async connect() {
    if (this.initialized) return this;
    const result = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: 'hyperagent-codex-bridge', version: VERSION }
    });
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    await this.request('notifications/initialized', undefined, { notification: true });
    this.initialized = true;
    return this;
  }

  async listTools() {
    await this.connect();
    return this.request('tools/list', {});
  }

  async callTool(name, args = {}) {
    await this.connect();
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) {
      throw new Error(`Hyperagent tool ${name} failed: ${contentText(result) || 'unknown error'}`);
    }
    return result;
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
