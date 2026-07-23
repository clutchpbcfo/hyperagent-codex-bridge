import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const specUrl = new URL('../../spec/openapi.json', import.meta.url);

test('OpenAPI document is valid JSON and declares the narrow 3.1 proof surface', async () => {
  const document = JSON.parse(await readFile(specUrl, 'utf8'));
  assert.match(document.openapi, /^3\.1\./);
  assert.deepEqual(Object.keys(document.paths), ['/v1/responses']);
  const operation = document.paths['/v1/responses'].post;
  assert.deepEqual(operation.security, [{ LocalBearer: [] }]);
  assert.equal(operation.parameters[0]['x-idempotency-semantics'], 'bounded-durable-local');
  assert.equal(document['x-compatibility']['full-openai-responses-api'], false);
  assert.equal(document['x-compatibility']['response-cancellation'], false);
  assert.equal(document['x-compatibility']['idempotency'], 'bounded-durable-local-only');
  assert.equal(document['x-compatibility']['ambiguous-dispatch-reconciliation'], 'local-fail-closed-no-upstream-lookup');
  assert.equal(document['x-compatibility']['disconnect-after-dispatch'], 'local-polling-aborted-native-work-unknown');
  assert.equal(document['x-compatibility']['usage-values'], 'omitted-not-reported');
  assert.equal(document['x-compatibility']['response-incomplete'], false);
  assert.equal(operation['x-hyperagent-upstream'].endpoint, 'https://hyperagent.com/api/mcp');
  assert.deepEqual(operation['x-hyperagent-upstream'].tools, ['list_agents', 'create_thread', 'get_thread']);
  assert.equal(operation['x-hyperagent-upstream']['provider-idempotency-claimed'], false);
});

test('OpenAPI response and error schemas retain required contract fields', async () => {
  const document = JSON.parse(await readFile(specUrl, 'utf8'));
  const completed = document.components.schemas.CompletedResponse;
  assert.deepEqual(completed.required, ['id', 'object', 'status', 'model', 'output', 'metadata']);
  assert.equal('usage' in completed.properties, false);
  assert.equal('UsageUnknownSentinel' in document.components.schemas, false);
  assert.deepEqual(document.components.schemas.ResponseMetadata.required, ['hyperagent_thread_id', 'request_id', 'usage_source']);
  assert.deepEqual(document.components.schemas.ErrorBody.properties.error.required, ['message', 'type', 'code']);
  assert.ok(document.components.schemas.ErrorBody.properties.error.properties.code.enum.includes('idempotency_indeterminate'));
  const success = document.paths['/v1/responses'].post.responses['200'];
  assert.ok(success.content['text/event-stream']);
  assert.deepEqual(success.headers['X-Usage-Source'], {
    $ref: '#/components/headers/UsageSource'
  });
  assert.equal(document.components.headers.UsageSource.required, true);
  assert.equal(document.components.headers.UsageSource.schema.const, 'unavailable');
  assert.ok(document.paths['/v1/responses'].post.responses['409']);
  assert.equal('maxProperties' in document.components.schemas.CreateResponseRequest, false);
  assert.deepEqual(document.components.schemas.CreateResponseRequest.properties.tools.items.oneOf, [
    { $ref: '#/components/schemas/FunctionTool' },
    { $ref: '#/components/schemas/CustomTool' },
    { $ref: '#/components/schemas/ToolSearchTool' },
    { $ref: '#/components/schemas/ToolNamespace' }
  ]);
  assert.deepEqual(document.components.schemas.ToolNamespace.properties.tools.items, {
    $ref: '#/components/schemas/FunctionTool'
  });
});
