import { access, chmod, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteText, ensureStateDir, modelCatalogPath } from './config.mjs';
import { codexHome, generateCatalog } from './install.mjs';

const ACTIVE_BEGIN = '# BEGIN Hyperagent Codex Bridge app mode';
const ACTIVE_END = '# END Hyperagent Codex Bridge app mode';
const PROVIDER_BEGIN = '# BEGIN Hyperagent Codex Bridge provider';
const PROVIDER_END = '# END Hyperagent Codex Bridge provider';
const LEGACY_PROVIDER_BEGIN = '# Hyperagent Codex Bridge provider for app handoff';
const LEGACY_PROVIDER_END = '# End Hyperagent Codex Bridge provider';
const ROOT_KEYS = new Set(['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort']);

export function mainConfigPath() {
  return join(codexHome(), 'config.toml');
}

export function appBackupPath() {
  return join(codexHome(), 'config.toml.hacb-app-backup');
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path, fallback = '') {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function removeDelimitedBlock(text, begin, end) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === begin) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) output.push(line);
  }
  return output.join('\n');
}

function removeProviderTable(text, providerId) {
  const target = `[model_providers.${providerId}]`;
  const lines = text.split(/\r?\n/);
  const output = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === target) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]$/.test(trimmed)) {
      skipping = false;
      output.push(line);
      continue;
    }
    if (!skipping) output.push(line);
  }
  return output.join('\n');
}

function removeManagedContent(text, providerId) {
  let value = text;
  value = removeDelimitedBlock(value, ACTIVE_BEGIN, ACTIVE_END);
  value = removeDelimitedBlock(value, PROVIDER_BEGIN, PROVIDER_END);
  value = removeDelimitedBlock(value, LEGACY_PROVIDER_BEGIN, LEGACY_PROVIDER_END);
  value = removeProviderTable(value, providerId);
  return value.replace(/^\s+|\s+$/g, '');
}

function removeRootSelections(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) inTable = true;
    if (!inTable) {
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
      if (match && ROOT_KEYS.has(match[1])) continue;
    }
    output.push(line);
  }
  return output.join('\n').replace(/^\s+|\s+$/g, '');
}

function providerBlock(config) {
  const baseUrl = `http://${config.bridgeHost}:${config.bridgePort}/v1`;
  return [
    PROVIDER_BEGIN,
    `[model_providers.${config.codexProviderId}]`,
    'name = "Hyperagent Credits"',
    `base_url = ${tomlString(baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    `experimental_bearer_token = ${tomlString(config.localApiToken)}`,
    'supports_websockets = false',
    'request_max_retries = 1',
    'stream_max_retries = 1',
    `stream_idle_timeout_ms = ${Math.max(300000, config.runTimeoutMs)}`,
    PROVIDER_END
  ].join('\n');
}

function activeBlock(config, model) {
  return [
    ACTIVE_BEGIN,
    `model = ${tomlString(model)}`,
    `model_provider = ${tomlString(config.codexProviderId)}`,
    `model_catalog_json = ${tomlString(modelCatalogPath())}`,
    'model_reasoning_effort = "medium"',
    ACTIVE_END
  ].join('\n');
}

export async function activateAppMode(config, { model, agents = null } = {}) {
  if (config.bridgeHost !== '127.0.0.1' && config.bridgeHost !== 'localhost') {
    throw new Error('App Mode requires the bridge to bind to loopback.');
  }
  await ensureStateDir();
  await mkdir(codexHome(), { recursive: true, mode: 0o700 });
  const { models } = await generateCatalog(config, agents);
  const selected = model && models.some(item => item.slug === model) ? model : models[0]?.slug;
  if (!selected) throw new Error('No reachable Hyperagent relay models are available.');

  const path = mainConfigPath();
  const current = await readText(path);
  if (!current.includes(ACTIVE_BEGIN) && !(await exists(appBackupPath()))) {
    await atomicWriteText(appBackupPath(), current, 0o600);
  }
  const clean = removeRootSelections(removeManagedContent(current, config.codexProviderId));
  const content = [
    activeBlock(config, selected),
    clean,
    providerBlock(config),
    ''
  ].filter(Boolean).join('\n\n');
  await atomicWriteText(path, content, 0o600);
  await chmod(path, 0o600).catch(() => {});
  return { path, selected, backup: appBackupPath() };
}

export async function deactivateAppMode(config) {
  await mkdir(codexHome(), { recursive: true, mode: 0o700 });
  const path = mainConfigPath();
  const backup = appBackupPath();
  const source = (await exists(backup)) ? await readText(backup) : await readText(path);
  const clean = removeManagedContent(source, config.codexProviderId);
  const content = [clean, providerBlock(config), ''].filter(Boolean).join('\n\n');
  await atomicWriteText(path, content, 0o600);
  if (await exists(backup)) {
    const last = `${backup}.last`;
    await rm(last, { force: true });
    await rename(backup, last);
  }
  return { path };
}

export async function appModeStatus(config) {
  const text = await readText(mainConfigPath());
  const active = text.includes(ACTIVE_BEGIN);
  const model = text.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1] || null;
  const provider = text.match(/^model_provider\s*=\s*["']([^"']+)["']/m)?.[1] || null;
  return {
    active,
    model,
    provider,
    providerConfigured: text.includes(`[model_providers.${config.codexProviderId}]`),
    configPath: mainConfigPath(),
    backupPath: appBackupPath()
  };
}
