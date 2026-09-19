import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpRepoWithRemote } from './helpers.mjs';
import { verifyIntegration } from '../src/tasks/integration.mjs';
import { persistCandidate } from '../src/tasks/candidate.mjs';

function fixture() {
  const repo = tmpRepoWithRemote();
  const base = repo.git('rev-parse', 'HEAD');
  repo.git('checkout', '-qb', 'candidate');
  repo.write('feature.txt', 'verified feature\n');
  repo.git('add', '.');
  repo.git('commit', '-qm', 'feature');
  const commit = repo.git('rev-parse', 'HEAD');
  const candidate = persistCandidate({ cwd: repo.dir, project: 'p', taskId: 't', commit });
  const task = { id: 't', candidateCommit: commit, candidate };
  const verify = (options = {}) => verifyIntegration({
    cwd: repo.dir, project: 'p', task, mainRef: 'refs/heads/main', ...options,
  });
  return { repo, base, commit, task, verify };
}
function advanceMain(repo) {
  repo.git('checkout', '-q', 'main');
  repo.write('independent.txt', 'new base\n');
  repo.git('add', '.');
  repo.git('commit', '-qm', 'advance main');
}

test('ancestry records exact chosen main tip; legacy works without recoverability metadata', () => {
  const f = fixture();
  try {
    f.repo.git('checkout', '-q', 'main');
    f.repo.git('merge', '--ff-only', f.commit);
    const result = f.verify();
    assert.equal(result.mode, 'ancestry');
    assert.equal(result.mainTip, f.commit);
    assert.equal(result.integratedCommit, f.commit);
    assert.match(result.patchHash, /^[a-f0-9]{40}$/);
    const legacy = f.verify({ task: { id: 't', candidateCommit: f.commit } });
    assert.equal(legacy.mode, 'ancestry');
    assert.equal(legacy.candidate, undefined);
    assert.throws(() => f.verify({ mainRef: undefined }), /divergem/);
    assert.throws(() => f.verify({ mainRef: f.commit }), /main\/repositório/);
    assert.throws(() => f.verify({ mainBranch: 'main^{commit}' }), /nome de branch/);
  } finally { f.repo.cleanup(); }
});

for (const method of ['cherry-pick', 'rebase']) {
  test(`${method} with identical patch verifies independently and preserves evidence`, () => {
    const f = fixture();
    try {
      advanceMain(f.repo);
      if (method === 'cherry-pick') f.repo.git('cherry-pick', f.commit);
      else {
        f.repo.git('checkout', '-q', 'candidate');
        f.repo.git('rebase', 'main');
        f.repo.git('checkout', '-q', 'main');
        f.repo.git('merge', '--ff-only', 'candidate');
      }
      const integratedCommit = f.repo.git('rev-parse', 'HEAD');
      assert.notEqual(integratedCommit, f.commit);
      assert.throws(() => f.verify(), /não é ancestral/);
      const result = f.verify({ integratedCommit, evidenceRef: 'review:verified' });
      assert.equal(result.mode, 'patch-equivalent');
      assert.equal(result.integratedCommit, integratedCommit);
      assert.equal(result.candidateCommit, f.commit);
      assert.equal(result.evidenceRef, 'review:verified');
      f.repo.git('config', 'diff.external', 'false');
      assert.deepEqual(f.verify({ integratedCommit, evidenceRef: 'review:verified' }), result);
      assert.throws(() => f.verify({ integratedCommit }), /evidence/);
    } finally { f.repo.cleanup(); }
  });
}

test('unrelated, empty, merge, root, off-main and unsafe commits cannot certify equivalence', () => {
  const f = fixture();
  try {
    advanceMain(f.repo);
    const unrelated = f.repo.git('rev-parse', 'HEAD');
    const verify = integratedCommit => f.verify({ integratedCommit, evidenceRef: 'review:test' });
    assert.throws(() => verify(unrelated), /não são equivalentes/);
    assert.throws(() => verify(f.commit), /não é ancestral/);
    assert.throws(() => verify('--help'), /SHA completo/);
    f.repo.git('commit', '--allow-empty', '-qm', 'empty');
    assert.throws(() => verify(f.repo.git('rev-parse', 'HEAD')), /diff vazio/);
    f.repo.git('merge', '--no-ff', '-m', 'merge candidate', 'candidate');
    assert.throws(() => verify(f.repo.git('rev-parse', 'HEAD')), /exatamente um pai/);
    assert.throws(() => verify(f.base), /exatamente um pai/);
    // Same rejection applies to a malformed candidate, not just the target.
    const merge = f.repo.git('rev-parse', 'HEAD');
    assert.throws(() => f.verify({ task: { id: 't', candidateCommit: merge },
      integratedCommit: merge, evidenceRef: 'review:test' }), /exatamente um pai/);
    assert.throws(() => f.verify({ task: { id: 't', candidateCommit: f.base },
      integratedCommit: unrelated, evidenceRef: 'review:test' }), /exatamente um pai/);
  } finally { f.repo.cleanup(); }
});

test('candidate repository binding rejects unrelated remotes and push-only matches', () => {
  const f = fixture();
  const other = tmpRepoWithRemote();
  try {
    f.repo.git('remote', 'set-url', 'origin', other.bare);
    f.repo.git('remote', 'set-url', '--push', 'origin', f.repo.bare);
    assert.throws(() => f.verify(), /remote correspondente/);
    f.repo.git('remote', 'add', 'saved', f.repo.bare);
    assert.throws(() => f.verify({ mainRef: 'refs/remotes/origin/main' }), /main\/repositório/);
    assert.throws(() => f.verify({ task: { ...f.task,
      candidate: { ...f.task.candidate, project: 'wrong' } } }), /divergente/);
  } finally { f.repo.cleanup(); other.cleanup(); }
});