import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BridgeServer } from '../src/bridge.mjs';

const execFileAsync = promisify(execFile);
const agent = { id: 'agent-sol-123456', name: 'Sol Coder', description: 'Mock agent', model: 'openai/gpt-5.6-sol' };
const token = 'openai-client-fixture-token-123456789012345';

async function withMockBridge(callback) {
  const bridge = new BridgeServer({
    bridgeHost: '127.0.0.1',
    bridgePort: 0,
    aliases: {},
    exposeAllAgents: true,
    defaultAgentId: null,
    localApiToken: token,
    runTimeoutMs: 5000,
    pollIntervalMs: 5
  }, {
    clientFactory: () => ({
      async listAgents() { return [agent]; },
      async createThread() { return 'thread_openai_client_fixture'; },
      async waitForThread() { return { text: '{"type":"final","text":"mock client works"}', status: 'completed', thread: {} }; },
      async close() {}
    }),
    auditWriter: async () => {},
    logWriter: async () => {},
    budgetGuard: async () => ({ used: 1, committed: 1, reserved: 0, limit: 6, remaining: 5 })
  });
  await bridge.start();
  try {
    await callback(`http://127.0.0.1:${bridge.server.address().port}/v1`);
  } finally {
    await bridge.close();
  }
}

test('official OpenAI JavaScript client accepts the mocked Responses gateway', async () => {
  await withMockBridge(async baseURL => {
    const fixture = fileURLToPath(new URL('../fixtures/openai-js-client.mjs', import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [fixture, baseURL, token]);
    const result = JSON.parse(stdout);
    assert.equal(result.text, 'mock client works');
    assert.match(result.requestId, /^req_/);
    assert.equal(result.usage, null);
  });
});

test('official OpenAI Python client accepts the mocked Responses gateway when installed', async context => {
  const python = process.env.OPENAI_PYTHON_BIN || 'python3';
  try {
    await execFileAsync(python, ['-c', 'import openai']);
  } catch {
    context.skip('Python openai package is not installed; set OPENAI_PYTHON_BIN to a prepared environment.');
    return;
  }
  await withMockBridge(async baseURL => {
    const fixture = fileURLToPath(new URL('../fixtures/openai_python_client.py', import.meta.url));
    const { stdout } = await execFileAsync(python, [fixture, baseURL, token]);
    const result = JSON.parse(stdout);
    assert.equal(result.text, 'mock client works');
    assert.match(result.request_id, /^req_/);
    assert.equal(result.usage, null);
  });
});
