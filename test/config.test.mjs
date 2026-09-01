import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG, loadConfig } from '../src/config.mjs';

test('sem arquivo => defaults, exists false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const { config, exists } = loadConfig(dir);
  assert.equal(exists, false);
  assert.deepEqual(config.classify.rules, DEFAULT_CONFIG.classify.rules);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge em profundidade; listas substituem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.writeFileSync(
    path.join(dir, '.agents/handoff.config.json'),
    JSON.stringify({
      platform: 'quave-one',
      git: { mainRef: 'trunk' },
      audit: { releaseBaseUrl: 'https://x.example' },
      classify: { rules: [{ class: 'runtime', match: ['**'] }] },
    }),
  );
  const { config, exists } = loadConfig(dir);
  assert.equal(exists, true);
  assert.equal(config.platform, 'quave-one');
  assert.equal(config.git.mainRef, 'trunk');
  assert.equal(config.audit.releaseBaseUrl, 'https://x.example');
  // env var name preservado do default (merge)
  assert.equal(config.audit.releaseBaseUrlEnv, 'HANDOFF_AUDIT_BASE_URL');
  // lista substituída, não mesclada
  assert.equal(config.classify.rules.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('JSON inválido => erro claro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.writeFileSync(path.join(dir, '.agents/handoff.config.json'), '{ nope');
  assert.throws(() => loadConfig(dir), /JSON inválido/);
  fs.rmSync(dir, { recursive: true, force: true });
});
