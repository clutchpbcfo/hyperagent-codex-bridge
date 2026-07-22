import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commitDailyRequestBudget,
  configPath,
  consumeDailyRequestBudget,
  getDailyBudgetStatus,
  loadConfig,
  releaseDailyRequestBudget,
  reserveDailyRequestBudget
} from '../src/config.mjs';

const execFileAsync = promisify(execFile);

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

test('budget reservations reconcile before dispatch and remain durable while pending', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-reservation-'));
  const previous = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  try {
    const config = { maxRequestsPerDay: 2 };
    const first = await reserveDailyRequestBudget(config, { requestId: 'req_test_1' });
    assert.equal((await getDailyBudgetStatus(config)).reserved, 1);
    await releaseDailyRequestBudget(first.id, config, { reason: 'client_disconnected' });
    assert.deepEqual(await getDailyBudgetStatus(config), {
      day: new Date().toISOString().slice(0, 10), used: 0, committed: 0, reserved: 0, limit: 2, remaining: 2
    });

    const second = await reserveDailyRequestBudget(config, { requestId: 'req_test_2' });
    const committed = await commitDailyRequestBudget(second.id, config);
    assert.equal(committed.committed, 1);
    assert.equal(committed.remaining, 1);
    await assert.rejects(() => commitDailyRequestBudget(second.id, config), /already reconciled/);
  } finally {
    await rm(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previous;
  }
});

test('legacy unsafe request ceilings migrate to the safe default without rotating secrets', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-migrate-'));
  const previous = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  try {
    const token = 'x'.repeat(43);
    await writeFile(configPath(), `${JSON.stringify({ localApiToken: token, maxRequestsPerDay: 20 })}\n`, { mode: 0o600 });
    const config = await loadConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.maxRequestsPerDay, 6);
    assert.equal(config.localApiToken, token);
    const persisted = JSON.parse(await readFile(configPath(), 'utf8'));
    assert.equal(persisted.configVersion, 2);
    assert.equal(persisted.maxRequestsPerDay, 6);
  } finally {
    await rm(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previous;
  }
});

test('versioned explicit request ceilings remain operator-controlled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-explicit-'));
  const previous = process.env.HACB_HOME;
  process.env.HACB_HOME = home;
  try {
    await writeFile(configPath(), `${JSON.stringify({ configVersion: 2, localApiToken: 'x'.repeat(43), maxRequestsPerDay: 12 })}\n`, { mode: 0o600 });
    const config = await loadConfig();
    assert.equal(config.maxRequestsPerDay, 12);
  } finally {
    await rm(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HACB_HOME;
    else process.env.HACB_HOME = previous;
  }
});

test('daily request budget is enforced across independent processes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hacb-multiprocess-budget-'));
  try {
    const moduleUrl = new URL('../src/config.mjs', import.meta.url).href;
    const script = `import { consumeDailyRequestBudget } from ${JSON.stringify(moduleUrl)}; consumeDailyRequestBudget({ maxRequestsPerDay: 3 }).then(() => process.stdout.write('ok')).catch(() => process.stdout.write('blocked'));`;
    const attempts = await Promise.all(Array.from({ length: 8 }, () => execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, HACB_HOME: home }
    })));
    const outcomes = attempts.map(result => result.stdout);
    assert.equal(outcomes.filter(value => value === 'ok').length, 3);
    assert.equal(outcomes.filter(value => value === 'blocked').length, 5);
    const previous = process.env.HACB_HOME;
    process.env.HACB_HOME = home;
    try {
      assert.equal((await getDailyBudgetStatus({ maxRequestsPerDay: 3 })).used, 3);
    } finally {
      if (previous === undefined) delete process.env.HACB_HOME;
      else process.env.HACB_HOME = previous;
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
