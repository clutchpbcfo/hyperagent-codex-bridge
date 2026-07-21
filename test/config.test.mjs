import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, consumeDailyRequestBudget, getDailyBudgetStatus, loadConfig } from '../src/config.mjs';

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

test('daily request budget persists and fails closed at the cap', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-budget-'));
  const previous = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  try {
    const config = { maxRequestsPerDay: 2 };
    assert.equal((await consumeDailyRequestBudget(config)).remaining, 1);
    assert.equal((await consumeDailyRequestBudget(config)).remaining, 0);
    await assert.rejects(() => consumeDailyRequestBudget(config), /Daily Hyperagent request cap reached/);
    const status = await getDailyBudgetStatus(config);
    assert.equal(status.used, 2);
    assert.equal(status.remaining, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previous;
  }
});
