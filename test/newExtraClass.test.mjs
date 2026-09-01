import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { GOOD_INPUT, runCli, tmpRepo } from './helpers.mjs';

function setup(configExtra) {
  const repo = tmpRepo();
  repo.write('src/a.mjs', 'export const x = 1;\n');
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'add src');
  runCli(repo.dir, ['init']);
  if (configExtra) {
    const cfg = JSON.parse(repo.read('.agents/handoff.config.json'));
    Object.assign(cfg.classify, configExtra);
    repo.write('.agents/handoff.config.json', JSON.stringify(cfg, null, 2));
  }
  repo.write('.agents/handoff.input.yaml', GOOD_INPUT);
  return repo;
}

function changeClassOf(repo) {
  const y = repo.read('.agents/handoff.yaml');
  return y
    .split('\n')
    .filter((l) => l.startsWith('  - '))
    .map((l) => l.slice(4).trim())
    .filter((c) =>
      ['runtime', 'process', 'product_docs', 'state', 'general_docs'].includes(c),
    );
}

test('--extra-class entra no change_class do retrato', () => {
  const repo = setup();
  const r = runCli(repo.dir, ['new', '--extra-class', 'product_docs']);
  assert.equal(r.code, 0, r.err);
  assert.ok(changeClassOf(repo).includes('product_docs'));
  repo.cleanup();
});

test('config.classify.recordAlsoTouches entra no change_class', () => {
  const repo = setup({ recordAlsoTouches: ['product_docs'] });
  const r = runCli(repo.dir, ['new']);
  assert.equal(r.code, 0, r.err);
  assert.ok(changeClassOf(repo).includes('product_docs'));
  repo.cleanup();
});

test('--extra-class inválida é ignorada', () => {
  const repo = setup();
  const r = runCli(repo.dir, ['new', '--extra-class', 'bogus']);
  assert.equal(r.code, 0);
  assert.ok(!changeClassOf(repo).includes('bogus'));
  repo.cleanup();
});
