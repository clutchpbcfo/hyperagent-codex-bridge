import { randomUUID } from 'node:crypto';

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'agent';
}

export function buildAgentModels(agents) {
  const used = new Map();
  return agents.map((agent, index) => {
    const base = slugify(agent.name);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    const suffix = count === 1 ? '' : `-${String(agent.id).slice(-6)}`;
    return {
      agent,
      slug: `hyperagent/${base}${suffix}`,
      displayName: agent.model ? `${agent.name} · ${agent.model}` : agent.name,
      priority: index + 1
    };
  });
}

export function resolveAgent(model, agents, config) {
  const requested = String(model || '').trim();
  const alias = config.aliases?.[requested];
  if (alias) {
    const matched = agents.find(agent => agent.id === alias);
    if (matched) return matched;
    throw new Error(`Model alias ${requested} points to unavailable agent ${alias}.`);
  }

  const models = buildAgentModels(agents);
  const bySlug = models.find(item => item.slug === requested);
  if (bySlug) return bySlug.agent;
  const direct = agents.find(agent => agent.id === requested);
  if (direct) return direct;
  const tail = requested.replace(/^hyperagent\//, '');
  const byName = agents.find(agent =>
    agent.name.toLowerCase() === requested.toLowerCase() ||
    slugify(agent.name) === tail
  );
  if (byName) return byName;
  if (config.defaultAgentId) {
    const fallback = agents.find(agent => agent.id === config.defaultAgentId);
    if (fallback) return fallback;
  }
  throw new Error(`Unknown Hyperagent model '${requested}'. Run hacb models and choose one of the listed model IDs.`);
}

export function modelInfo(item) {
  return {
    slug: item.slug,
    display_name: item.displayName,
    description: item.agent.description || `Hyperagent agent: ${item.agent.name}`,
    default_reasoning_level: 'low',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Cost-controlled default' },
      { effort: 'medium', description: 'Use only when the task needs more depth' },
      { effort: 'high', description: 'Explicit opt-in for difficult tasks' }
    ],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: item.priority,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    base_instructions: 'You are a coding agent. Use the client tools when needed, then return a concise final answer.',
    model_messages: null,
    include_skills_usage_instructions: false,
    supports_reasoning_summary_parameter: false,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'bytes', limit: 10000 },
    supports_parallel_tool_calls: false,
    supports_image_detail_original: false,
    context_window: 262144,
    max_context_window: 262144,
    auto_compact_token_limit: 235000,
    effective_context_window_percent: 90,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: false,
    use_responses_lite: false
  };
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? '');
  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (part?.type === 'input_image' && typeof part.image_url === 'string') {
        return `[Image URL supplied by Codex: ${part.image_url}]`;
      }
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join('\n');
}

function injectedContext(text, role) {
  const value = String(text || '').trimStart();
  if (role === 'developer' || role === 'system') return true;
  return [
    '<environment_context>',
    '<permissions instructions>',
    '<app-context>',
    '<collaboration_mode>',
    '<apps_instructions>',
    '<plugins_instructions>',
    '<skills_instructions>',
    '<skill>',
    '# AGENTS.md instructions for '
  ].some(prefix => value.startsWith(prefix));
}

function compact(value, limit) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated by Hyperagent Codex Bridge]`;
}

function normalizeInput(input, config = {}) {
  if (typeof input === 'string') return [{ role: 'user', text: compact(input, 12000) }];
  if (!Array.isArray(input)) return [{ role: 'user', text: compact(input, 12000) }];
  const perTurnLimit = Math.max(1000, Number(config.maxTurnChars || 12000));
  const maxTurns = Math.max(2, Number(config.maxConversationTurns || 12));
  const maxTotal = Math.max(perTurnLimit, Number(config.maxInputChars || 48000));
  const turns = [];
  for (const item of input) {
    const type = item?.type || 'message';
    if (type === 'additional_tools') continue;
    if (type === 'message') {
      const role = item.role || 'user';
      const text = contentToText(item.content);
      if (injectedContext(text, role)) continue;
      turns.push({ role, text: compact(text, perTurnLimit) });
      continue;
    }
    if (type === 'function_call') {
      turns.push({ role: 'assistant_tool_call', text: compact({ call_id: item.call_id, name: item.name, namespace: item.namespace, arguments: item.arguments }, perTurnLimit) });
      continue;
    }
    if (type === 'function_call_output') {
      turns.push({ role: 'tool_result', text: compact({ call_id: item.call_id, output: item.output }, perTurnLimit) });
      continue;
    }
    if (type === 'custom_tool_call') {
      turns.push({ role: 'assistant_custom_tool_call', text: compact({ call_id: item.call_id, name: item.name, namespace: item.namespace, input: item.input }, perTurnLimit) });
      continue;
    }
    if (type === 'custom_tool_call_output') {
      turns.push({ role: 'custom_tool_result', text: compact({ call_id: item.call_id, output: item.output }, perTurnLimit) });
      continue;
    }
    if (type === 'tool_search_call') {
      turns.push({ role: 'assistant_tool_search', text: compact({ call_id: item.call_id, arguments: item.arguments }, perTurnLimit) });
      continue;
    }
    if (type === 'tool_search_output') {
      turns.push({ role: 'tool_search_result', text: compact({ call_id: item.call_id, status: item.status, tools: item.tools }, perTurnLimit) });
    }
  }
  const recent = turns.slice(-maxTurns);
  const bounded = [];
  let used = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (used + turn.text.length > maxTotal && bounded.length) break;
    bounded.unshift(turn);
    used += turn.text.length;
  }
  return bounded;
}

function namespaceToolName(namespace, child) {
  if (namespace.endsWith('__')) return `${namespace}${child}`;
  if (namespace.startsWith('mcp__')) return `${namespace}__${child}`;
  return `${namespace}.${child}`;
}

function blockedTool(name, config) {
  if (!config.blockMultiAgentTools) return false;
  return /(^|[._])(?:spawn_agent|send_input|wait_agent|close_agent|resume_agent)$/.test(name)
    || name === 'collaboration'
    || name.startsWith('multi_agent');
}

function normalizeTools(tools, config = {}) {
  if (!Array.isArray(tools)) return [];
  const normalized = [];
  const add = tool => {
    if (!tool?.name || blockedTool(tool.name, config)) return;
    if (normalized.some(existing => existing.name === tool.name && existing.type === tool.type)) return;
    normalized.push(tool);
  };
  for (const tool of tools) {
    if (tool?.type === 'namespace' && Array.isArray(tool.tools)) {
      if (blockedTool(tool.name || '', config)) continue;
      for (const child of tool.tools) {
        if (child?.type !== 'function') continue;
        const name = namespaceToolName(tool.name, child.name);
        add({
          type: 'function',
          name,
          description: compact(child.description || tool.description || '', 800),
          parameters: child.parameters || child.input_schema || { type: 'object' }
        });
      }
      continue;
    }
    if (tool?.type === 'function') {
      add({
        type: 'function',
        name: tool.name,
        description: compact(tool.description || '', 800),
        parameters: tool.parameters || tool.input_schema || { type: 'object' }
      });
      continue;
    }
    if (tool?.type === 'custom') {
      add({
        type: 'custom',
        name: tool.name,
        description: compact(tool.description || '', 800),
        format: tool.format || null
      });
      continue;
    }
    if (tool?.type === 'tool_search') {
      add({ type: 'tool_search', name: 'tool_search', description: compact(tool.description || 'Search deferred client tools.', 800), execution: tool.execution || 'client' });
    }
  }
  return normalized.slice(0, Math.max(4, Number(config.maxForwardedTools || 64)));
}

export function extractClientTools(body, config = {}) {
  const tools = Array.isArray(body?.tools) ? [...body.tools] : [];
  if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      if (item?.type === 'additional_tools' && Array.isArray(item.tools)) tools.push(...item.tools);
      if (item?.type === 'tool_search_output' && Array.isArray(item.tools)) tools.push(...item.tools);
    }
  }
  return normalizeTools(tools, config);
}

export function buildRelayPrompt(body, agent, config = {}, extractedTools = null) {
  const turns = normalizeInput(body.input, config);
  const tools = extractedTools || extractClientTools(body, config);
  const instructions = 'Act as the Codex reasoning backend. Use only the forwarded client tools and return one compact JSON action.';
  const effort = config.allowClientReasoningEffort && body.reasoning?.effort
    ? body.reasoning.effort
    : (config.defaultReasoningEffort || 'low');
  const payload = {
    task: 'Act as the reasoning/model backend for a local Codex coding session.',
    selected_hyperagent_agent: agent.name,
    reasoning_effort: effort,
    developer_instructions: instructions,
    conversation: turns,
    client_tools: tools
  };

  return [
    'You are serving as the model behind Codex. Codex itself owns the local filesystem, shell, patches, and approvals.',
    'Return exactly one JSON object, with no markdown fence and no extra text.',
    'Choose exactly one shape:',
    '{"type":"final","text":"your final answer"}',
    '{"type":"function_call","name":"one exact function tool name","arguments":{}}',
    '{"type":"custom_tool_call","name":"one exact custom tool name","input":"raw tool input"}',
    '{"type":"tool_search_call","arguments":{"query":"tool capability to find"}}',
    'If client_tools is non-empty and local inspection, editing, commands, or tests are required, call the matching client tool instead of claiming you performed the work.',
    'Never invent a tool name. Never execute an equivalent remote tool when the request concerns Codex local files.',
    'After a tool result appears in conversation, either call another client tool or return final.',
    '',
    JSON.stringify(payload)
  ].join('\n');
}

function parseJsonCandidate(text) {
  const trimmed = String(text || '').trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseRelayOutput(text, tools = []) {
  const parsed = parseJsonCandidate(text);
  if (!parsed || typeof parsed !== 'object') return { type: 'final', text: String(text || '') };
  if (parsed.type === 'function_call') {
    const tool = tools.find(item => item?.type === 'function' && item.name === parsed.name);
    if (!tool) return { type: 'final', text: `Hyperagent requested unavailable function tool '${parsed.name}'.\n\n${text}` };
    return {
      type: 'function_call',
      name: parsed.name,
      arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments || {})
    };
  }
  if (parsed.type === 'custom_tool_call') {
    const tool = tools.find(item => item?.type === 'custom' && item.name === parsed.name);
    if (!tool) return { type: 'final', text: `Hyperagent requested unavailable custom tool '${parsed.name}'.\n\n${text}` };
    return { type: 'custom_tool_call', name: parsed.name, input: String(parsed.input || '') };
  }
  if (parsed.type === 'tool_search_call' || parsed.type === 'tool_search') {
    const tool = tools.find(item => item?.type === 'tool_search');
    if (!tool) return { type: 'final', text: `Hyperagent requested unavailable tool_search.\n\n${text}` };
    return { type: 'tool_search_call', arguments: parsed.arguments || { query: String(parsed.query || '') } };
  }
  if (parsed.type === 'final' && typeof parsed.text === 'string') return parsed;
  return { type: 'final', text: typeof parsed.text === 'string' ? parsed.text : String(text || '') };
}

export function responseIds() {
  const id = randomUUID().replace(/-/g, '');
  return { responseId: `resp_${id}`, itemId: `msg_${id}`, callId: `call_${id}` };
}

export function sseEvents(output, ids, { model, threadId } = {}) {
  const response = { id: ids.responseId, status: 'in_progress', model, output: [], metadata: { hyperagent_thread_id: threadId } };
  const events = [{ type: 'response.created', response }];
  if (output.type === 'function_call') {
    events.push({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: ids.callId, name: output.name, arguments: output.arguments }
    });
  } else if (output.type === 'custom_tool_call') {
    events.push({
      type: 'response.output_item.done',
      item: { type: 'custom_tool_call', call_id: ids.callId, name: output.name, input: output.input }
    });
  } else if (output.type === 'tool_search_call') {
    events.push({
      type: 'response.output_item.done',
      item: { type: 'tool_search_call', call_id: ids.callId, status: 'completed', execution: 'client', arguments: output.arguments }
    });
  } else {
    events.push({
      type: 'response.output_item.added',
      item: { type: 'message', role: 'assistant', id: ids.itemId, content: [] }
    });
    if (output.text) events.push({ type: 'response.output_text.delta', item_id: ids.itemId, delta: output.text });
    events.push({
      type: 'response.output_item.done',
      item: { type: 'message', role: 'assistant', id: ids.itemId, content: [{ type: 'output_text', text: output.text || '' }] }
    });
  }
  events.push({
    type: 'response.completed',
    response: {
      id: ids.responseId,
      status: 'completed',
      model,
      metadata: { hyperagent_thread_id: threadId },
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    }
  });
  return events;
}

export function nonStreamingResponse(output, ids, { model, threadId } = {}) {
  const item = output.type === 'function_call'
    ? { type: 'function_call', call_id: ids.callId, name: output.name, arguments: output.arguments }
    : output.type === 'custom_tool_call'
      ? { type: 'custom_tool_call', call_id: ids.callId, name: output.name, input: output.input }
      : output.type === 'tool_search_call'
        ? { type: 'tool_search_call', call_id: ids.callId, status: 'completed', execution: 'client', arguments: output.arguments }
        : { type: 'message', role: 'assistant', id: ids.itemId, content: [{ type: 'output_text', text: output.text || '' }] };
  return {
    id: ids.responseId,
    object: 'response',
    status: 'completed',
    model,
    output: [item],
    metadata: { hyperagent_thread_id: threadId },
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
  };
}
