import assert from 'node:assert/strict';
import test from 'node:test';

import { makeAncestry } from '../src/ancestry.mjs';
import { makeClassifier } from '../src/classify.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';

const classifier = makeClassifier(DEFAULT_CONFIG);

// git falso: linha reta a<b<c<d; classes por commit definidas no fixture.
function fakeGit(order, classesByCommit) {
  const idx = (s) => order.indexOf(s);
  return {
    isAncestor: (a, b) => idx(a) !== -1 && idx(b) !== -1 && idx(a) <= idx(b),
    commitsInRange: (from, to) => {
      const f = idx(from);
      const t = idx(to);
      if (f === -1 || t === -1 || f >= t) return [];
      return order.slice(f + 1, t + 1);
    },
    pathsInCommit: (c) => classesByCommit[c] || [],
  };
}

test('equal quando é o mesmo commit (ou prefixo)', () => {
  const a = makeAncestry(fakeGit(['x'], {}), classifier);
  assert.equal(a('abcdef123', 'abcdef123'), 'equal');
  assert.equal(a('abcdef123456', 'abcdef123'), 'equal');
});

test('trailing: retrato à frente do deploy só por commits não-runtime', () => {
  const git = fakeGit(['deploy', 'doc1', 'snap'], {
    doc1: ['docs/a.md'],
    snap: ['.agents/handoff.yaml'],
  });
  const a = makeAncestry(git, classifier);
  assert.equal(a('snap', 'deploy'), 'trailing');
});

test('trailing: deploy atrás do retrato só por commits não-runtime', () => {
  const git = fakeGit(['snap', 'doc1', 'deploy'], {
    doc1: ['README.md'],
    deploy: ['ROADMAP.md'],
  });
  const a = makeAncestry(git, classifier);
  assert.equal(a('snap', 'deploy'), 'trailing');
});

test('other: há um commit runtime no intervalo', () => {
  const git = fakeGit(['snap', 'feat', 'deploy'], {
    feat: ['src/app.mjs'],
    deploy: ['docs/a.md'],
  });
  const a = makeAncestry(git, classifier);
  assert.equal(a('snap', 'deploy'), 'other');
});

test('other: commits divergentes (nenhum é ancestral do outro)', () => {
  const git = {
    isAncestor: () => false,
    commitsInRange: () => [],
    pathsInCommit: () => [],
  };
  const a = makeAncestry(git, classifier);
  assert.equal(a('aaa', 'bbb'), 'other');
});
