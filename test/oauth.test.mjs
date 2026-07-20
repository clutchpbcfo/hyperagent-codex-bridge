import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState } from '../src/config.mjs';
import { discoverOAuth, getAccessToken, invalidateTokens } from '../src/oauth.mjs';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('OAuth discovery and refresh use advertised endpoints and rotate tokens', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-oauth-'));
  const previousHome = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  let received;
  const server = await listen(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.url === '/.well-known/oauth-protected-resource') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: ['threads:read', 'offline_access'] }));
      return;
    }
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      }));
      return;
    }
    if (request.url === '/token') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      received = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 }));
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const issuer = `http://127.0.0.1:${server.address().port}`;
    const config = {
      issuer,
      mcpUrl: `${issuer}/api/mcp`,
      callbackHost: '127.0.0.1',
      callbackPort: 47832,
      scopes: ['threads:read', 'offline_access']
    };
    const discovery = await discoverOAuth(config);
    assert.equal(discovery.metadata.token_endpoint, `${issuer}/token`);

    await saveState({
      oauth: {
        clients: {
          [issuer]: {
            client_id: 'client-test',
            redirect_uris: ['http://127.0.0.1:47832/callback']
          }
        },
        tokens: {
          [issuer]: {
            access_token: 'expired-access',
            refresh_token: 'old-refresh',
            expires_at: Date.now() - 1000
          }
        }
      },
      mcp: {}
    });

    assert.equal(await getAccessToken(config), 'new-access');
    assert.equal(received.get('grant_type'), 'refresh_token');
    assert.equal(received.get('refresh_token'), 'old-refresh');
    assert.equal(received.get('client_id'), 'client-test');
    const saved = await loadState();
    assert.equal(saved.oauth.tokens[issuer].refresh_token, 'new-refresh');

    await invalidateTokens(config);
    assert.equal((await loadState()).oauth.tokens[issuer], undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previousHome;
  }
});
