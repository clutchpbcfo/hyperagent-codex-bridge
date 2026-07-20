import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentModels,
  buildRelayPrompt,
  modelInfo,
  parseRelayOutput,
  resolveAgent,
  slugify,
  sseEvents
} from '../src/protocol.mjs';

const agents = [
  { id: 'agent-sol-123456', name: 'Sol Coder', description: 'GPT 5.6 Sol coding agent', model: 'openai/gpt-5.6-sol' },
  { id: 'agent-fable-654321', name: 'Fable Coder', description: 'Fable coding agent', model: 'claude-fable-5' }
];

test('agent names become stable Hyperagent model slugs', () => {
  assert.equal(slugify('Fàble Coder!'), 'fable-coder');
  const models = buildAgentModels(agents);
  assert.deepEqual(models.map(model => model.slug), ['hyperagent/sol-coder', 'hyperagent/fable-coder']);
});

test('aliases and generated slugs resolve to agents', () => {
  const config = { aliases: { 'hyperagent/sol': agents[0].id }, defaultAgentId: null };
  assert.equal(resolveAgent('hyperagent/sol', agents, config).id, agents[0].id);
  assert.equal(resolveAgent('hyperagent/fable-coder', agents, config).id, agents[1].id);
  assert.throws(() => resolveAgent('hyperagent/missing', agents, config), /Unknown Hyperagent model/);
});

test('relay prompt preserves Codex instructions, inputs, tools, and tool results', () => {
  const prompt = buildRelayPrompt({
    model: 'hyperagent/sol-coder',
    instructions: 'Work carefully.',
    reasoning: { effort: 'high' },
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the repo.' }] },
      { type: 'function_call_output', call_id: 'call_1', output: 'README contents' }
    ],
    tools: [{ type: 'function', name: 'shell', description: 'Run shell', parameters: { type: 'object' } }]
  }, agents[0]);
  assert.match(prompt, /Work carefully/);
  assert.match(prompt, /Inspect the repo/);
  assert.match(prompt, /README contents/);
  assert.match(prompt, /"name":"shell"/);
  assert.match(prompt, /"reasoning_effort":"high"/);
});

test('relay output maps final and tool calls', () => {
  assert.deepEqual(parseRelayOutput('{"type":"final","text":"done"}'), { type: 'final', text: 'done' });
  assert.deepEqual(
    parseRelayOutput('{"type":"function_call","name":"shell","arguments":{"command":"pwd"}}', [{ type: 'function', name: 'shell' }]),
    { type: 'function_call', name: 'shell', arguments: '{"command":"pwd"}' }
  );
  assert.deepEqual(
    parseRelayOutput('{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch"}', [{ type: 'custom', name: 'apply_patch' }]),
    { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' }
  );
  assert.deepEqual(parseRelayOutput('plain answer'), { type: 'final', text: 'plain answer' });
});

test('Codex model metadata and SSE fixtures include required fields', () => {
  const item = buildAgentModels(agents)[0];
  const info = modelInfo(item);
  assert.equal(info.slug, 'hyperagent/sol-coder');
  assert.equal(info.visibility, 'list');
  assert.equal(info.shell_type, 'shell_command');
  assert.equal(info.apply_patch_tool_type, 'freeform');

  const events = sseEvents(
    { type: 'function_call', name: 'shell', arguments: '{"command":"pwd"}' },
    { responseId: 'resp_1', itemId: 'msg_1', callId: 'call_1' },
    { model: info.slug, threadId: 'thread_1' }
  );
  assert.deepEqual(events.map(event => event.type), ['response.created', 'response.output_item.done', 'response.completed']);
  assert.equal(events[1].item.type, 'function_call');
  assert.equal(events[1].item.call_id, 'call_1');
});
