import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcile } from '../src/reconcile.mjs';

const snap = {
  run_id: 'r9',
  recorded_at: '2026-09-01T00:00:00Z',
  branch: 'main',
  code: { state: 'merged_main', commit: 'aaaaaaa1111' },
  release_intent: 'authorized',
};

test('aligned quando todas as fontes batem', () => {
  const r = reconcile(snap, {
    remote_git: { available: true, mainCommit: 'aaaaaaa11112222' },
    gh_actions: { available: true, status: 'completed', conclusion: 'success' },
    api_release: { available: true, commit: 'aaaaaaa1111' },
    quave: { available: true, gitCommitId: 'aaaaaaa1111' },
  });
  assert.equal(r.verdict, 'aligned');
});

test('drift quando /api/release aponta outro commit', () => {
  const r = reconcile(snap, {
    remote_git: { available: true, mainCommit: 'aaaaaaa1111' },
    api_release: { available: true, commit: 'bbbbbbb2222' },
    quave: { available: false, reason: 'sem token' },
  });
  assert.equal(r.verdict, 'drift');
  assert.equal(
    r.reconciliation.find((x) => x.source === 'api_release').match,
    false,
  );
  assert.equal(r.reconciliation.find((x) => x.source === 'quave').match, null);
});

test('unknown quando nenhuma fonte de commit disponível', () => {
  const r = reconcile(snap, {
    remote_git: { available: false },
    api_release: { available: false },
    quave: { available: false },
  });
  assert.equal(r.verdict, 'unknown');
});

test('ancestry trailing => conta como alinhado, com nota', () => {
  const ancestry = (a, b) =>
    a === 'aaaaaaa1111' && b === 'ccccccc3333' ? 'trailing' : 'other';
  const r = reconcile(
    snap,
    {
      remote_git: { available: true, mainCommit: 'ccccccc3333' },
      api_release: { available: true, commit: 'ccccccc3333' },
    },
    { ancestry },
  );
  assert.equal(r.verdict, 'aligned');
  const row = r.reconciliation.find((x) => x.source === 'remote_git');
  assert.equal(row.match, true);
  assert.match(row.note, /não-runtime/);
});

test('sources ausentes não quebram', () => {
  const r = reconcile(snap, {});
  assert.equal(r.sources.quave.available, false);
  assert.equal(r.verdict, 'unknown');
});

test('gh_actions com falha => match false', () => {
  const r = reconcile(snap, {
    gh_actions: { available: true, status: 'completed', conclusion: 'failure' },
  });
  assert.equal(
    r.reconciliation.find((x) => x.source === 'gh_actions').match,
    false,
  );
});
