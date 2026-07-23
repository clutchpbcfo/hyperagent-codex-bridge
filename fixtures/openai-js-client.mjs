import OpenAI from 'openai';

const [baseURL, apiKey] = process.argv.slice(2);
if (!baseURL || !apiKey) throw new Error('Usage: node openai-js-client.mjs <base-url> <api-key>');

const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 });
const response = await client.responses.create({
  model: 'hyperagent/sol-coder',
  input: 'Mocked JavaScript client fixture.',
  stream: false
}, { headers: { 'Idempotency-Key': 'openai-js-fixture' } });

process.stdout.write(JSON.stringify({
  id: response.id,
  text: response.output_text,
  requestId: response.metadata?.request_id,
  usage: response.usage ?? null
}));
