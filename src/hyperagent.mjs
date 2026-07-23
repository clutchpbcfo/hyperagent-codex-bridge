import { McpClient, decodeToolResult } from './mcp-client.mjs';

function deepFind(value, predicate, seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, predicate, seen);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(value)) {
      const found = deepFind(item, predicate, seen);
      if (found) return found;
    }
  }
  return null;
}

function pickString(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return null;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function findArrayByKeys(value, keys, seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findArrayByKeys(child, keys, seen);
    if (found) return found;
  }
  return null;
}

export function normalizeAgents(raw) {
  const value = decodeToolResult(raw);
  const list = Array.isArray(value)
    ? value
    : findArrayByKeys(value, ['agents', 'items', 'data', 'results']) || [];
  const agents = [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = pickString(candidate, ['id', 'agentId', 'agent_id']);
    const name = pickString(candidate, ['name', 'title', 'displayName']) || id;
    if (!id || !name) continue;
    agents.push({
      id,
      name,
      description: pickString(candidate, ['description', 'summary']) || '',
      model: pickString(candidate, ['modelId', 'model', 'model_id']) || null
    });
  }
  return agents;
}

function findThreadId(value) {
  if (typeof value === 'string' && /^[a-z0-9_-]{12,}$/i.test(value)) return value;
  const found = deepFind(value, item =>
    typeof item?.threadId === 'string' ||
    typeof item?.thread_id === 'string' ||
    (typeof item?.id === 'string' && /thread/i.test(JSON.stringify(item).slice(0, 300)))
  );
  return found?.threadId || found?.thread_id || found?.id || null;
}

function statusOf(value) {
  const node = deepFind(value, item =>
    typeof item?.status === 'string' ||
    typeof item?.state === 'string' ||
    typeof item?.running === 'boolean' ||
    typeof item?.isRunning === 'boolean'
  );
  if (!node) return null;
  if (typeof node.running === 'boolean') return node.running ? 'running' : 'completed';
  if (typeof node.isRunning === 'boolean') return node.isRunning ? 'running' : 'completed';
  return String(node.status || node.state || '').toLowerCase();
}

function finalAssistantText(value) {
  const direct = deepFind(value, item =>
    typeof item?.finalText === 'string' ||
    typeof item?.final_text === 'string' ||
    typeof item?.answer === 'string'
  );
  if (direct) return direct.finalText || direct.final_text || direct.answer;

  const messages = findArrayByKeys(value, ['messages', 'turns', 'history']);
  if (!messages) return '';
  const assistant = messages
    .filter(message => String(message?.role || message?.author || '').toLowerCase().includes('assistant'))
    .map(message => ({
      text: extractText(message.content ?? message.text ?? message.message),
      time: Date.parse(message.createdAt || message.created_at || message.timestamp || '') || 0
    }))
    .filter(message => message.text);
  if (!assistant.length) return '';
  assistant.sort((a, b) => b.time - a.time);
  return assistant[0].text;
}

export class HyperagentClient {
  constructor(config) {
    this.config = config;
    this.mcp = new McpClient(config);
  }

  async listAgents() {
    return normalizeAgents(await this.mcp.callTool('list_agents', {}));
  }

  async createThread(agentId, message, { signal, timeoutMs } = {}) {
    const decoded = decodeToolResult(await this.mcp.callTool('create_thread', { agentId, message }, {
      signal,
      timeoutMs: timeoutMs || this.config.createThreadTimeoutMs
    }));
    const threadId = findThreadId(decoded);
    if (!threadId) throw new Error(`Hyperagent create_thread did not return a threadId: ${JSON.stringify(decoded).slice(0, 1000)}`);
    return threadId;
  }

  async getThread(threadId, { signal, timeoutMs } = {}) {
    return decodeToolResult(await this.mcp.callTool('get_thread', { threadId }, {
      signal,
      timeoutMs: timeoutMs || this.config.mcpRequestTimeoutMs
    }));
  }

  async waitForThread(threadId, { signal, onProgress } = {}) {
    const started = Date.now();
    let previousStatus = '';
    while (Date.now() - started < this.config.runTimeoutMs) {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Request aborted.'), { code: 'client_disconnected' });
      const remainingMs = this.config.runTimeoutMs - (Date.now() - started);
      const thread = await this.getThread(threadId, {
        signal,
        timeoutMs: Math.max(1, Math.min(this.config.mcpRequestTimeoutMs, remainingMs))
      });
      const status = statusOf(thread) || 'unknown';
      if (status !== previousStatus) onProgress?.(status, thread);
      previousStatus = status;
      if (['completed', 'complete', 'done', 'finished', 'failed', 'cancelled', 'canceled', 'idle'].includes(status)) {
        if (['failed', 'cancelled', 'canceled'].includes(status)) {
          throw new Error(`Hyperagent thread ended with status ${status}.`);
        }
        const text = finalAssistantText(thread);
        if (!text) throw new Error(`Hyperagent thread completed without assistant text: ${JSON.stringify(thread).slice(0, 1200)}`);
        return { text, thread, status };
      }
      const text = finalAssistantText(thread);
      if (status === 'unknown' && text) return { text, thread, status: 'completed' };
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason || Object.assign(new Error('Request aborted.'), { code: 'client_disconnected' }));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, this.config.pollIntervalMs);
        timer.unref?.();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    throw new Error(`Hyperagent thread ${threadId} exceeded the ${Math.round(this.config.runTimeoutMs / 60000)} minute timeout.`);
  }

  async run(agentId, message, options = {}) {
    const threadId = await this.createThread(agentId, message);
    const result = await this.waitForThread(threadId, options);
    return { ...result, threadId };
  }

  async close() {
    await this.mcp.close();
  }
}
