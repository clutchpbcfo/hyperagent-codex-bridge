import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_HEADERS,
  FAKE_AGENTS,
  FakeHyperagentUpstream,
  startContractTarget
} from './support/fake-hyperagent.mjs';
import {
  assertUsageOmitted,
  postResponse,
  streamResponse
} from './support/http-contract.mjs';

async function withTarget(options, run) {
  const target = await startContractTarget(options);
  try {
    await run(target);
  } finally {
    await target.close();
  }
}

test('local bearer auth fails closed without forwarding a request upstream', async () => {
  await withTarget({}, async ({ baseUrl, upstream }) => {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'hyperagent/sol-coder', input: 'hello' })
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="hyperagent-codex-bridge"');
    assert.deepEqual(await response.json(), {
      error: {
        message: 'Missing or invalid local bridge bearer token.',
        type: 'invalid_request_error',
        code: 'unauthorized'
      }
    });
    assert.equal(upstream.created.length, 0);
  });
});

test('malformed JSON, missing model, and unknown model are JSON 400 errors', async () => {
  await withTarget({}, async ({ baseUrl, upstream }) => {
    const malformed = await postResponse(baseUrl, '{');
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.message, 'The request is invalid.');

    const missing = await postResponse(baseUrl, { input: 'hello' });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.message, 'The model field is required.');

    const unknown = await postResponse(baseUrl, { model: 'hyperagent/missing', input: 'hello' });
    assert.equal(unknown.status, 400);
    const error = await unknown.json();
    assert.equal(error.error.type, 'invalid_request_error');
    assert.equal(error.error.message, 'Unknown model identifier. Choose an exact identifier returned by the models endpoint.');
    assert.equal(upstream.created.length, 0);
  });
});

test('model resolves deterministically through alias, slug, agent ID, and agent name', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: Array.from({ length: 4 }, () => ({ kind: 'reply', text: '{"type":"final","text":"ok"}' }))
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    for (const model of [
      'hyperagent/sol',
      'hyperagent/sol-coder',
      FAKE_AGENTS[1].id,
      'Fable Coder'
    ]) {
      const response = await postResponse(baseUrl, { model, input: 'hello', stream: false });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(upstream.created.map(call => call.agentId), [
      FAKE_AGENTS[0].id,
      FAKE_AGENTS[0].id,
      FAKE_AGENTS[1].id,
      FAKE_AGENTS[1].id
    ]);
  });
});

test('configured default agent never overrides fail-closed model selection', async () => {
  await withTarget({ config: { defaultAgentId: FAKE_AGENTS[1].id } }, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, { model: 'unknown-but-nonempty', input: 'hello', stream: false });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'unknown_model');
    assert.equal(upstream.created.length, 0);
  });
});

test('duplicate agent names and ambiguous aliases fail closed before dispatch', async () => {
  const duplicate = new FakeHyperagentUpstream({
    agents: [FAKE_AGENTS[0], { ...FAKE_AGENTS[1], name: 'sol coder' }]
  });
  await withTarget({ upstream: duplicate }, async ({ baseUrl }) => {
    const response = await postResponse(baseUrl, { model: 'hyperagent/sol-coder', input: 'hello', stream: false });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'duplicate_agent_name');
    assert.equal(duplicate.created.length, 0);
  });
  await withTarget({ config: { aliases: { 'hyperagent/sol-coder': FAKE_AGENTS[1].id } } }, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, { model: 'hyperagent/sol-coder', input: 'hello', stream: false });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'ambiguous_model_alias');
    assert.equal(upstream.created.length, 0);
  });
});

test('non-empty text SSE follows the exact profile order and correlation invariants', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [{ kind: 'reply', text: '{"type":"final","text":"route works"}' }]
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const result = await streamResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello',
      stream: true
    });
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type'), /^text\/event-stream/);
    assert.deepEqual(result.events.map(item => item.event), [
      'response.created',
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_item.done',
      'response.completed'
    ]);
    const [created, added, delta, done, completed] = result.events.map(item => item.value);
    assert.match(created.response.id, /^resp_[a-f0-9]{32}$/);
    assert.equal(created.response.status, 'in_progress');
    assert.equal(added.item.id, delta.item_id);
    assert.equal(delta.delta, 'route works');
    assert.equal(done.item.id, delta.item_id);
    assert.equal(done.item.content[0].text, delta.delta);
    assert.equal(completed.response.id, created.response.id);
    assert.equal(completed.response.status, 'completed');
    assertUsageOmitted(completed.response);
    const threadId = result.response.headers.get('x-hyperagent-thread-id');
    assert.equal(created.response.metadata.hyperagent_thread_id, threadId);
    assert.equal(completed.response.metadata.hyperagent_thread_id, threadId);
    for (const item of result.events) {
      assert.equal('sequence_number' in item.value, false);
    }
  });
});

test('empty final text omits the delta but still completes in order', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [{ kind: 'reply', text: '{"type":"final","text":""}' }]
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const result = await streamResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello'
    });
    assert.deepEqual(result.events.map(item => item.event), [
      'response.created',
      'response.output_item.added',
      'response.output_item.done',
      'response.completed'
    ]);
    assert.equal(result.events[2].value.item.content[0].text, '');
  });
});

test('function, custom, and client tool-search actions use the short success sequence', async () => {
  const scenarios = [
    { kind: 'reply', text: '{"type":"function_call","name":"shell","arguments":{"command":"pwd"}}' },
    { kind: 'reply', text: '{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch"}' },
    { kind: 'reply', text: '{"type":"tool_search_call","arguments":{"query":"browser"}}' }
  ];
  const upstream = new FakeHyperagentUpstream({ scenarios });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const cases = [
      {
        tools: [{ type: 'function', name: 'shell', parameters: { type: 'object' } }],
        type: 'function_call'
      },
      {
        tools: [{ type: 'custom', name: 'apply_patch' }],
        type: 'custom_tool_call'
      },
      {
        tools: [{ type: 'tool_search', execution: 'client' }],
        type: 'tool_search_call'
      }
    ];
    for (const item of cases) {
      const result = await streamResponse(baseUrl, {
        model: 'hyperagent/sol-coder',
        input: 'use a tool',
        tools: item.tools,
        stream: true
      });
      assert.deepEqual(result.events.map(event => event.event), [
        'response.created',
        'response.output_item.done',
        'response.completed'
      ]);
      assert.equal(result.events[1].value.item.type, item.type);
      assert.match(result.events[1].value.item.call_id, /^call_[a-f0-9]{32}$/);
      assert.equal(result.events.at(-1).event, 'response.completed');
      if (item.type === 'function_call') {
        assert.equal(result.events[1].value.item.name, 'shell');
        assert.equal(result.events[1].value.item.arguments, '{"command":"pwd"}');
      } else if (item.type === 'custom_tool_call') {
        assert.equal(result.events[1].value.item.name, 'apply_patch');
        assert.equal(result.events[1].value.item.input, '*** Begin Patch');
      } else {
        assert.equal(result.events[1].value.item.execution, 'client');
        assert.deepEqual(result.events[1].value.item.arguments, { query: 'browser' });
      }
    }
  });
});

test('non-streaming success returns one response object with usage omitted', async () => {
  await withTarget({}, async ({ baseUrl }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello',
      stream: false
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const body = await response.json();
    assert.match(body.id, /^resp_[a-f0-9]{32}$/);
    assert.equal(body.object, 'response');
    assert.equal(body.status, 'completed');
    assert.equal(body.output.length, 1);
    assertUsageOmitted(body);
    assert.equal(body.metadata.hyperagent_thread_id, response.headers.get('x-hyperagent-thread-id'));
  });
});

test('streaming upstream failure is a terminal response.failed event on HTTP 200', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [{ kind: 'error', message: 'fake poll failure' }]
  });
  await withTarget({ upstream }, async ({ baseUrl, audits }) => {
    const result = await streamResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello',
      stream: true
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.events.map(item => item.event), ['response.created', 'response.failed']);
    const failed = result.events[1].value.response;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.type, 'server_error');
    assert.equal(failed.error.code, 'hyperagent_bridge_error');
    assert.equal(result.events.some(item => item.event === 'response.completed'), false);
    assert.deepEqual(audits.map(item => item.event), ['request_reserved', 'thread_created', 'failed']);
  });
});

test('non-streaming upstream failure remains a JSON server error', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [{ kind: 'error', message: 'fake upstream failed' }]
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello',
      stream: false
    });
    assert.equal(response.status, 500);
    const failure = await response.json();
    assert.deepEqual(failure, {
      error: {
        message: 'Hyperagent gateway request failed. Use X-Request-Id to inspect the local structured logs.',
        type: 'server_error',
        code: 'hyperagent_bridge_error'
      }
    });
    assert.doesNotMatch(JSON.stringify(failure), /fake upstream failed/);
  });
});

test('daily-budget rejection is a pre-thread JSON 429', async () => {
  const budgetGuard = async () => {
    throw Object.assign(new Error('Daily Hyperagent request cap reached (6/6).'), { status: 429 });
  };
  await withTarget({ budgetGuard }, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello'
    });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.type, 'invalid_request_error');
    assert.equal(upstream.created.length, 0);
  });
});

test('budget-lock failure is a pre-thread JSON 503', async () => {
  const budgetGuard = async () => {
    throw Object.assign(new Error('Could not acquire the daily budget lock; denying the Hyperagent request.'), { status: 503 });
  };
  await withTarget({ budgetGuard }, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'hello'
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.type, 'server_error');
    assert.equal(upstream.created.length, 0);
  });
});

test('sanitized prompt ceiling fails with JSON 413 before thread creation', async () => {
  await withTarget({ config: { maxPromptChars: 10_000 } }, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'x'.repeat(12_000)
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.message, 'The sanitized relay prompt is too large.');
    assert.equal(upstream.created.length, 0);
  });
});

test('Idempotency-Key durably replays the completed local response without a second thread', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [
      { kind: 'reply', text: '{"type":"final","text":"first"}' },
      { kind: 'reply', text: '{"type":"final","text":"second"}' }
    ]
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const request = {
      model: 'hyperagent/sol-coder',
      input: 'same request',
      stream: false
    };
    const headers = { 'idempotency-key': 'same-key' };
    const firstResponse = await postResponse(baseUrl, request, { headers });
    const secondResponse = await postResponse(baseUrl, request, { headers });
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    assert.equal(first.id, second.id);
    assert.equal(first.metadata.hyperagent_thread_id, second.metadata.hyperagent_thread_id);
    assert.equal(secondResponse.headers.get('x-idempotency-replayed'), 'true');
    assert.equal(upstream.created.length, 1);
  });
});

test('function, custom, tool-search, and namespaced tools retain declaration order in the relay contract', async () => {
  await withTarget({}, async ({ baseUrl, upstream }) => {
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inspect tools' }] },
        { type: 'additional_tools', tools: [
          { type: 'namespace', name: 'mcp__demo__', tools: [
            { type: 'function', name: 'fourth_function', parameters: { type: 'object' } }
          ] }
        ] }
      ],
      stream: false,
      tools: [
        { type: 'function', name: 'first_function', description: 'first', parameters: { type: 'object' } },
        { type: 'custom', name: 'second_custom', description: 'second' },
        { type: 'tool_search', execution: 'client', description: 'third' }
      ]
    });
    assert.equal(response.status, 200);
    const prompt = upstream.created[0].prompt;
    const positions = ['first_function', 'second_custom', 'tool_search', 'mcp__demo__fourth_function']
      .map(name => prompt.indexOf(name));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });
});

test('response.incomplete is unsupported and is never emitted as a terminal state', async () => {
  const upstream = new FakeHyperagentUpstream({
    scenarios: [{ kind: 'reply', text: '{"type":"response.incomplete","incomplete_details":{"reason":"max_output"}}' }]
  });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const result = await streamResponse(baseUrl, { model: 'hyperagent/sol-coder', input: 'hello' });
    assert.equal(result.events.some(item => item.event === 'response.incomplete'), false);
    assert.equal(result.events.at(-1).event, 'response.completed');
    assert.equal(result.events.at(-1).value.response.status, 'completed');
  });
});

test('Idempotency-Key conflicts fail closed and each HTTP attempt gets a fresh request ID', async () => {
  await withTarget({}, async ({ baseUrl, upstream, logs, idempotencyManager }) => {
    const headers = { 'idempotency-key': 'contract-key', 'x-request-id': 'client-spoof' };
    const firstResponse = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder', input: 'first', stream: false
    }, { headers });
    const first = await firstResponse.json();
    assert.match(firstResponse.headers.get('x-request-id'), /^req_[a-f0-9]{32}$/);
    assert.equal(first.metadata.request_id, firstResponse.headers.get('x-request-id'));
    const conflict = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder', input: 'different', stream: false
    }, { headers });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'idempotency_conflict');
    assert.notEqual(conflict.headers.get('x-request-id'), firstResponse.headers.get('x-request-id'));
    assert.equal(upstream.created.length, 1);
    assert.ok(logs.every(item => !('agentId' in item) && !('threadId' in item)));
    assert.equal(idempotencyManager.records.size, 1);
  });
});

test('client abort stops local waiting but does not invoke an upstream cancellation capability', async () => {
  const upstream = new FakeHyperagentUpstream({ scenarios: [{ kind: 'pending' }] });
  await withTarget({ upstream }, async ({ baseUrl }) => {
    const controller = new AbortController();
    const response = await postResponse(baseUrl, {
      model: 'hyperagent/sol-coder',
      input: 'wait',
      stream: true
    }, { signal: controller.signal });
    assert.equal(response.status, 200);
    const bodyRead = response.text();
    await upstream.waitStarted.promise;
    controller.abort();
    await assert.rejects(bodyRead, error => error?.name === 'AbortError');
    const observed = await upstream.waitAborted.promise;
    assert.equal(observed.threadId, upstream.created[0].threadId);
    assert.equal(typeof upstream.cancelThread, 'undefined');
  });
});

test('response cancellation route is not exposed', async () => {
  await withTarget({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/responses/resp_example/cancel`, {
      method: 'POST',
      headers: AUTH_HEADERS
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, 'not_found');
  });
});
