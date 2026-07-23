import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { loadState, saveState, VERSION } from './config.mjs';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${url}, got HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    const detail = data.error_description || data.message || data.error || text;
    throw new Error(`HTTP ${response.status} from ${url}: ${detail}`);
  }
  return data;
}

function validateOAuthUrl(value, label, issuerOrigin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label} URL in OAuth metadata.`);
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${label} must use HTTPS (loopback HTTP is allowed for tests).`);
  }
  if (issuerOrigin && url.origin !== issuerOrigin) {
    throw new Error(`${label} origin ${url.origin} does not match OAuth issuer ${issuerOrigin}.`);
  }
  return url;
}

export async function discoverOAuth(config, { signal } = {}) {
  const configuredIssuer = validateOAuthUrl(config.issuer, 'configured issuer');
  const resourceUrl = new URL('/.well-known/oauth-protected-resource', configuredIssuer).toString();
  const resource = await getJson(resourceUrl, { signal });
  if (resource.resource && new URL(resource.resource).toString() !== new URL(config.mcpUrl).toString()) {
    throw new Error(`OAuth protected resource mismatch: expected ${config.mcpUrl}, got ${resource.resource}.`);
  }
  const issuerValue = resource.authorization_servers?.[0] || config.issuer;
  const issuerUrl = validateOAuthUrl(issuerValue, 'authorization server');
  if (issuerUrl.origin !== configuredIssuer.origin) {
    throw new Error(`OAuth authorization server origin ${issuerUrl.origin} does not match configured issuer ${configuredIssuer.origin}.`);
  }
  const issuer = issuerUrl.toString().replace(/\/$/, '');
  const metadataUrl = new URL('/.well-known/oauth-authorization-server', issuer).toString();
  const metadata = await getJson(metadataUrl, { signal });
  if (metadata.issuer && new URL(metadata.issuer).toString().replace(/\/$/, '') !== issuer) {
    throw new Error(`OAuth metadata issuer mismatch: expected ${issuer}, got ${metadata.issuer}.`);
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (metadata[field]) validateOAuthUrl(metadata[field], field, issuerUrl.origin);
  }
  return { resource, metadata, issuer };
}

function callbackUrl(config) {
  return `http://${config.callbackHost}:${config.callbackPort}/callback`;
}

async function ensureClient(config, discovered, { signal } = {}) {
  const state = await loadState();
  state.oauth ||= {};
  state.oauth.clients ||= {};
  const redirectUri = callbackUrl(config);
  const existing = state.oauth.clients[discovered.issuer];
  if (existing?.client_id && existing.redirect_uris?.includes(redirectUri)) return existing;

  const registrationEndpoint = discovered.metadata.registration_endpoint;
  if (!registrationEndpoint) {
    throw new Error('Hyperagent OAuth metadata does not advertise dynamic client registration.');
  }

  const client = await getJson(registrationEndpoint, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: `Hyperagent Codex Bridge ${VERSION}`,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native'
    })
  });
  state.oauth.clients[discovered.issuer] = client;
  await saveState(state);
  return client;
}

function openBrowser(url) {
  const target = String(url);
  const options = { detached: true, stdio: 'ignore' };
  let child;
  if (process.platform === 'darwin') child = spawn('open', [target], options);
  else if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', target], options);
  else child = spawn('xdg-open', [target], options);
  child.on('error', () => {});
  child.unref();
}

function startCallbackServer(config, expectedState, timeoutMs = 10 * 60 * 1000) {
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close(() => {});
      if (error) reject(error);
      else resolve(value);
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', callbackUrl(config));
      if (url.pathname === '/favicon.ico') {
        response.writeHead(404).end();
        return;
      }
      if (url.pathname !== '/callback') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (!state || !safeEqual(state, expectedState)) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Authorization failed: state mismatch.');
        finish(new Error('OAuth callback state mismatch.'));
        return;
      }
      if (error || !code) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Authorization failed. Return to the terminal for details.');
        finish(new Error(`OAuth authorization failed: ${error || 'missing authorization code'}`));
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
      });
      response.end('<!doctype html><meta charset="utf-8"><title>Connected</title><style>body{font:16px system-ui;max-width:42rem;margin:12vh auto;padding:2rem}h1{font-size:2rem}</style><h1>Hyperagent connected</h1><p>You can close this window and return to the terminal.</p>');
      finish(null, { code, callbackParams: url.searchParams });
    });

    server.once('error', error => {
      readyReject(error);
      finish(error);
    });
    server.listen(config.callbackPort, config.callbackHost, () => {
      readyResolve();
      timer = setTimeout(() => finish(new Error('OAuth login timed out.')), timeoutMs);
      timer.unref?.();
    });
  });
  return { ready, result };
}

async function tokenRequest(metadata, params, { signal } = {}) {
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    signal,
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });
  const text = await response.text();
  let token;
  try {
    token = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok || token.error) {
    throw new Error(`Token exchange failed: ${token.error_description || token.error || response.status}`);
  }
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('Token endpoint response did not contain an access_token.');
  }
  return {
    ...token,
    obtained_at: Date.now(),
    expires_at: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : null
  };
}

export async function login(config, { launchBrowser = true } = {}) {
  const discovered = await discoverOAuth(config);
  const client = await ensureClient(config, discovered);
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(sha256(verifier));
  const csrfState = base64url(randomBytes(32));
  const redirectUri = callbackUrl(config);
  const authorizationUrl = new URL(discovered.metadata.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', client.client_id);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', config.scopes.join(' '));
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', csrfState);
  authorizationUrl.searchParams.set('resource', config.mcpUrl);

  const callback = startCallbackServer(config, csrfState);
  await callback.ready;
  process.stdout.write(`\nOpen this URL to authorize Hyperagent:\n\n${authorizationUrl}\n\n`);
  if (launchBrowser) openBrowser(authorizationUrl);
  const { code } = await callback.result;
  const tokens = await tokenRequest(discovered.metadata, {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: config.mcpUrl
  });

  const state = await loadState();
  state.oauth ||= {};
  state.oauth.tokens ||= {};
  state.oauth.tokens[discovered.issuer] = tokens;
  await saveState(state);
  return { issuer: discovered.issuer, scopes: tokens.scope || config.scopes.join(' ') };
}

async function refresh(config, discovered, client, current, { signal } = {}) {
  if (!current?.refresh_token) throw new Error('Hyperagent login expired and no refresh token is available. Run hacb login.');
  const updated = await tokenRequest(discovered.metadata, {
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: current.refresh_token,
    scope: config.scopes.join(' '),
    resource: config.mcpUrl
  }, { signal });
  if (!updated.refresh_token) updated.refresh_token = current.refresh_token;
  const state = await loadState();
  state.oauth ||= {};
  state.oauth.tokens ||= {};
  state.oauth.tokens[discovered.issuer] = updated;
  await saveState(state);
  return updated;
}

export async function getAccessToken(config, { require = true, signal } = {}) {
  const discovered = await discoverOAuth(config, { signal });
  const client = await ensureClient(config, discovered, { signal });
  const state = await loadState();
  const current = state.oauth?.tokens?.[discovered.issuer];
  if (!current?.access_token) {
    if (!require) return null;
    throw new Error('Hyperagent is not connected. Run hacb login.');
  }
  if (current.expires_at && current.expires_at <= Date.now() + 60_000) {
    return (await refresh(config, discovered, client, current, { signal })).access_token;
  }
  return current.access_token;
}

export async function invalidateTokens(config) {
  const discovered = await discoverOAuth(config);
  const state = await loadState();
  if (state.oauth?.tokens) delete state.oauth.tokens[discovered.issuer];
  await saveState(state);
}
