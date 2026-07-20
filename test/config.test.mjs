import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, loadConfig } from '../src/config.mjs';

test('loadConfig creates and persists a strong local bridge bearer token', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-config-'));
  const previous = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  try {
    const first = await loadConfig();
    const second = await loadConfig();
    assert.equal(first.localApiToken, second.localApiToken);
    assert.ok(first.localApiToken.length >= 32);
    if (process.platform !== 'win32') {
      const mode = (await stat(configPath())).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previous;
  }
});
