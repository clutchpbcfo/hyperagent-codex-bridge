import { BridgeServer } from '../../../src/bridge.mjs';
import { createMemoryIdempotencyManager } from '../../support/memory-state.mjs';

export const LOCAL_TOKEN = 'contract-local-token-12345678901234567890';
export const AUTH_HEADERS = { authorization: `Bearer ${LOCAL_TOKEN}` };

export const FAKE_AGENTS = [
  {
    id: 'agent-sol-123456',
    name: 'Sol Coder',
    description: 'Fake Sol relay agent',
    model: 'openai/gpt-5.6-sol'
  },
  {
    id: 'agent-fable-654321',
    name: 'Fable Coder',
    description: 'Fake Fable relay agent',
    model: 'claude-fable-5'
  }
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class FakeHyperagentUpstream {
  constructor({ agents = FAKE_AGENTS, scenarios = [] } = {}) {
    this.agents = structuredClone(agents);
    this.scenarios = [...scenarios];
    this.created = [];
    this.waits = [];
    this.closedClients = 0;
    this.nextThread = 1;
    this.threadCreated = deferred();
    this.waitStarted = deferred();
    this.waitAborted = deferred();
  }

  nextScenario() {
    return this.scenarios.shift() || { kind: 'reply', text: '{"type":"final","text":"ok"}' };
  }

  clientFactory = () => ({
    listAgents: async () => structuredClone(this.agents),
    createThread: async (agentId, prompt) => {
      const threadId = `thread_fake_${this.nextThread++}`;
      this.created.push({ agentId, prompt, threadId });
      this.threadCreated.resolve(this.created.at(-1));
      return threadId;
    },
    waitForThread: async (threadId, { signal } = {}) => {
      const scenario = this.nextScenario();
      this.waits.push({ threadId, scenario, signal });
      this.waitStarted.resolve(this.waits.at(-1));
      if (scenario.kind === 'error') throw new Error(scenario.message || 'fake upstream failed');
      if (scenario.kind === 'pending') {
        return new Promise((resolve, reject) => {
          const abort = () => {
            this.waitAborted.resolve({ threadId });
            reject(new Error('Request aborted.'));
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return {
        text: scenario.text,
        status: 'completed',
        thread: { id: threadId, status: 'completed' }
      };
    },
    close: async () => {
      this.closedClients += 1;
    }
  });
}

export async function startContractTarget({
  upstream = new FakeHyperagentUpstream(),
  config: overrides = {},
  budgetGuard = async () => ({ used: 1, limit: 6, remaining: 5 })
} = {}) {
  const audits = [];
  const logs = [];
  const idempotencyManager = createMemoryIdempotencyManager();
  const config = {
    bridgeHost: '127.0.0.1',
    bridgePort: 0,
    aliases: { 'hyperagent/sol': FAKE_AGENTS[0].id },
    exposeAllAgents: true,
    defaultAgentId: null,
    runTimeoutMs: 300_000,
    pollIntervalMs: 5,
    localApiToken: LOCAL_TOKEN,
    defaultReasoningEffort: 'low',
    allowClientReasoningEffort: false,
    blockMultiAgentTools: true,
    maxForwardedTools: 32,
    maxPromptChars: 70_000,
    ...overrides
  };
  const bridge = new BridgeServer(config, {
    clientFactory: upstream.clientFactory,
    auditWriter: async event => audits.push(event),
    logWriter: async event => logs.push(event),
    budgetGuard,
    idempotencyManager
  });
  await bridge.start();
  const address = bridge.server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    bridge,
    upstream,
    audits,
    logs,
    idempotencyManager,
    async close() {
      await bridge.close();
    }
  };
}
