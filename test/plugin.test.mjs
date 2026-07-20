import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Codex plugin manifest points to the bundled skill and matches package version', async () => {
  const plugin = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(plugin.name, 'hyperagent-codex-bridge');
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.license, 'MIT');
  assert.match(plugin.repository, /clutchpbcfo\/hyperagent-codex-bridge/);
  const skill = await readFile(join(root, 'skills', 'hyperagent-codex-bridge', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: hyperagent-codex-bridge\n/m);
});
