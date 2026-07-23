import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveState } from '../src/config.mjs';
import { McpClient, decodeToolResult } from '../src/mcp-client.mjs';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('MCP client initializes a session and handles JSON plus SSE tool results', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-mcp-'));
  const oldHome = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  const seen = [];
  const server = await listen(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.url === '/.well-known/oauth-protected-resource') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ resource: `${origin}/api/mcp`, authorization_servers: [origin] }));
      return;
    }
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`
      }));
      return;
    }
    if (request.method === 'DELETE' && request.url === '/api/mcp') {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/mcp') {
      response.writeHead(404).end();
      return;
    }
    assert.equal(request.headers.authorization, 'Bearer test-token');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen.push(body.method);
    if (body.method === 'initialize') {
      response.setHeader('content-type', 'application/json');
      response.setHeader('mcp-session-id', 'session-1');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'mock', version: '1' } } }));
      return;
    }
    if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    if (body.method === 'tools/list') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'list_agents', inputSchema: { type: 'object' } }] } }));
      return;
    }
    if (body.method === 'tools/call') {
      response.setHeader('content-type', 'text/event-stream');
      response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{"agents":[{"id":"a1","name":"Agent"}]}' }] } })}\n\n`);
      return;
    }
    response.writeHead(400).end();
  });

  try {
    const issuer = `http://127.0.0.1:${server.address().port}`;
    const config = {
      issuer,
      mcpUrl: `${issuer}/api/mcp`,
      callbackHost: '127.0.0.1',
      callbackPort: 47832,
      scopes: ['threads:read']
    };
    await saveState({
      oauth: {
        clients: { [issuer]: { client_id: 'client', redirect_uris: ['http://127.0.0.1:47832/callback'] } },
        tokens: { [issuer]: { access_token: 'test-token', token_type: 'Bearer', expires_at: Date.now() + 3600000 } }
      },
      mcp: {}
    });

    const client = new McpClient(config);
    const tools = await client.listTools();
    assert.equal(tools.tools[0].name, 'list_agents');
    const result = decodeToolResult(await client.callTool('list_agents', {}));
    assert.equal(result.agents[0].name, 'Agent');
    assert.deepEqual(seen, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    await client.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = oldHome;
  }
});

test('create_thread and polling requests have hard abortable timeouts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-mcp-timeout-'));
  const oldHome = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  const server = await listen(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.url === '/.well-known/oauth-protected-resource') {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ resource: origin, authorization_servers: [origin] }));
    }
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`
      }));
    }
    if (request.method === 'DELETE') return response.writeHead(200).end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body.method === 'initialize') {
      response.setHeader('content-type', 'application/json');
      response.setHeader('mcp-session-id', 'timeout-session');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }));
      return;
    }
    if (body.method === 'notifications/initialized') return response.writeHead(202).end();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    // Leave the response body open until the client timeout aborts it.
  });
  try {
    const issuer = `http://127.0.0.1:${server.address().port}`;
    await saveState({
      oauth: {
        clients: { [issuer]: { client_id: 'client', redirect_uris: ['http://127.0.0.1:47832/callback'] } },
        tokens: { [issuer]: { access_token: 'test-token', token_type: 'Bearer', expires_at: Date.now() + 3600000 } }
      },
      mcp: {}
    });
    const client = new McpClient({
      issuer, mcpUrl: issuer, mcpRequestTimeoutMs: 100,
      callbackHost: '127.0.0.1', callbackPort: 47832, scopes: ['threads:read']
    });
    await assert.rejects(
      () => client.callTool('create_thread', { agentId: 'agent', message: 'test' }, { timeoutMs: 200 }),
      error => error.code === 'upstream_timeout' && error.dispatchState === 'dispatched'
    );
    await assert.rejects(
      () => client.callTool('get_thread', { threadId: 'thread' }, { timeoutMs: 50 }),
      error => error.code === 'upstream_timeout'
    );
    await client.close();
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = oldHome;
  }
});
