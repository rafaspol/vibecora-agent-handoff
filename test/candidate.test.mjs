import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpRepoWithRemote } from './helpers.mjs';
import { persistCandidate, recoverCandidate, validateCandidate, validateRepository } from '../src/tasks/candidate.mjs';

test('candidate validation rejects unsafe identities, credentials, hash/ref and legacy', () => {
  const c = { version: 1, project: 'p', taskId: 't', repository: '/safe/repo',
    commit: 'a'.repeat(40), ref: `refs/vibecora/candidates/p/t/${'a'.repeat(40)}` };
  assert.equal(validateCandidate(c), c);
  for (const change of [{ project: '../p' }, { taskId: '-x' }, { commit: '--help' },
    { ref: 'refs/heads/main' }, { version: 2 }]) {
    assert.throws(() => recoverCandidate({ cwd: '/does-not-exist',
      candidate: { ...c, ...change }, repository: c.repository }));
  }
  assert.throws(() => validateCandidate(null), /legado/);
  for (const url of ['https://token@example.com/repo', 'https://host/repo?token=x',
    'ext::evil', '-upload-pack=evil', 'origin', 'ssh://git:secret@host/repo']) {
    assert.throws(() => validateRepository(url));
  }
  assert.throws(() => validateCandidate(c, { project: 'other' }));
  assert.throws(() => validateCandidate(c, { commit: 'b'.repeat(40) }));
});

test('wrong remote SHA refuses persistence and recovery without overwriting', () => {
  const repo = tmpRepoWithRemote();
  try {
    const old = repo.git('rev-parse', 'HEAD').trim();
    repo.write('candidate-file', 'candidate');
    repo.git('add', '.');
    repo.git('commit', '-qm', 'candidate');
    const commit = repo.git('rev-parse', 'HEAD').trim();
    const candidate = persistCandidate({ cwd: repo.dir, project: 'p', taskId: 't', commit });
    repo.git('--git-dir', repo.bare, 'update-ref', candidate.ref, old);
    assert.throws(() => persistCandidate({ cwd: repo.dir, project: 'p', taskId: 't', commit }), /não confirmado/);
    assert.throws(() => recoverCandidate({ cwd: repo.dir, candidate, repository: repo.bare }), /não confirmado/);
    assert.equal(repo.git('--git-dir', repo.bare, 'rev-parse', candidate.ref).trim(), old);
  } finally { repo.cleanup(); }
});