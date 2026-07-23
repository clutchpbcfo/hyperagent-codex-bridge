import assert from 'node:assert/strict';
import { AUTH_HEADERS } from './fake-hyperagent.mjs';

export function parseSse(text) {
  const records = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    if (lines.every(line => !line || line.startsWith(':'))) {
      records.push({ kind: 'comment', text: lines.filter(line => line.startsWith(':')).join('\n') });
      continue;
    }
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    assert.ok(event, `SSE block has no event field: ${block}`);
    assert.ok(data, `SSE block has no data field: ${block}`);
    const value = JSON.parse(data);
    assert.equal(value.type, event, 'SSE event field must equal JSON type');
    records.push({ kind: 'event', event, value });
  }
  return records;
}

export async function postResponse(baseUrl, body, { headers = {}, signal } = {}) {
  return fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal
  });
}

export async function streamResponse(baseUrl, body, options) {
  const response = await postResponse(baseUrl, body, options);
  const text = await response.text();
  return {
    response,
    text,
    records: parseSse(text),
    events: parseSse(text).filter(record => record.kind === 'event')
  };
}

export function assertUsageOmitted(response) {
  assert.equal('usage' in response, false);
}
