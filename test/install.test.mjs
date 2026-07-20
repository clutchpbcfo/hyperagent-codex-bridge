import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, modelCatalogPath } from '../src/config.mjs';
import { codexProfilePath, installCodexProfile, installSkill, uninstallCodexProfile } from '../src/install.mjs';

const agents = [
  { id: 'agent-sol-123456', name: 'Sol Coder', description: 'Sol model', model: 'openai/gpt-5.6-sol' },
  { id: 'agent-fable-654321', name: 'Fable Coder', description: 'Fable model', model: 'claude-fable-5' }
];

test('Codex profile and authoritative model catalog are generated without touching base config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hacb-install-'));
  const oldHacb = process.env.HACB_HOME;
  const oldCodex = process.env.CODEX_HOME;
  process.env.HACB_HOME = join(root, 'state');
  process.env.CODEX_HOME = join(root, 'codex');
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    aliases: { 'hyperagent/sol': agents[0].id },
    exposeAllAgents: true,
    localApiToken: 'local-profile-token-12345678901234567890'
  };

  try {
    const result = await installCodexProfile(config, { defaultModel: 'hyperagent/sol', agents });
    assert.equal(result.selected, 'hyperagent/sol');
    const profile = await readFile(codexProfilePath(), 'utf8');
    assert.match(profile, /model = "hyperagent\/sol"/);
    assert.match(profile, /model_provider = "hyperagent_credits"/);
    assert.match(profile, /base_url = "http:\/\/127\.0\.0\.1:47831\/v1"/);
    assert.match(profile, /wire_api = "responses"/);
    assert.match(profile, /experimental_bearer_token = "local-profile-token-/);

    const catalog = JSON.parse(await readFile(modelCatalogPath(), 'utf8'));
    assert.deepEqual(catalog.models.map(model => model.slug), [
      'hyperagent/sol',
      'hyperagent/sol-coder',
      'hyperagent/fable-coder'
    ]);
    assert.equal(catalog.models.every(model => model.visibility === 'list'), true);

    await uninstallCodexProfile();
    await assert.rejects(() => readFile(codexProfilePath(), 'utf8'), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
    if (oldHacb === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = oldHacb;
    if (oldCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodex;
  }
});

test('bundled Codex skill installs as a materialized directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hacb-skill-'));
  const oldCodex = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(root, 'codex');
  try {
    const result = await installSkill();
    const skill = await readFile(join(result.target, 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: hyperagent-codex-bridge\n/m);
    assert.match(skill, /hacb app-on/);
    const reference = await readFile(join(result.target, 'references', 'COMMANDS.md'), 'utf8');
    assert.match(reference, /Migrate to a second machine/);
  } finally {
    await rm(root, { recursive: true, force: true });
    if (oldCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodex;
  }
});
