import assert from 'node:assert/strict';
import test from 'node:test';

import { CHANGE_CLASSES, makeClassifier } from '../src/classify.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';

const { classifyPath, classifyPaths } = makeClassifier(DEFAULT_CONFIG);
const silent = { onUnknown: () => {} };

test('defaults cobrem cada classe', () => {
  assert.equal(classifyPath('src/app.mjs'), 'runtime');
  assert.equal(classifyPath('package.json'), 'runtime');
  assert.equal(classifyPath('.github/workflows/x.yml'), 'process');
  assert.equal(classifyPath('scripts/y.mjs'), 'process');
  assert.equal(classifyPath('ROADMAP.md'), 'product_docs');
  assert.equal(classifyPath('docs/guide.md'), 'product_docs');
  assert.equal(classifyPath('.agents/handoff.yaml'), 'state');
  assert.equal(classifyPath('README.md'), 'general_docs');
  assert.equal(classifyPath('docs/decisions/0001-x.md'), 'general_docs');
  assert.equal(classifyPath('NOTES.md'), 'general_docs');
});

test('regra específica vence a genérica (ordem)', () => {
  assert.equal(classifyPath('docs/decisions/README.md'), 'general_docs');
  assert.notEqual(classifyPath('docs/decisions/a.md'), 'product_docs');
});

test('glob ** casa em qualquer profundidade; * fica no segmento', () => {
  const c = makeClassifier({
    classify: {
      rules: [
        { class: 'runtime', match: ['pkg/**/index.js'] },
        { class: 'process', match: ['cfg/*.json'] },
      ],
      unknownClass: 'general_docs',
    },
  });
  assert.equal(c.classifyPath('pkg/a/b/index.js'), 'runtime');
  assert.equal(c.classifyPath('pkg/index.js'), 'runtime');
  assert.equal(c.classifyPath('cfg/a.json'), 'process');
  assert.equal(c.classifyPath('cfg/sub/a.json'), 'general_docs'); // * não cruza /
});

test('caminho desconhecido cai no unknownClass e é reportado', () => {
  let seen = null;
  const c = makeClassifier({
    classify: { rules: [], unknownClass: 'process' },
  });
  assert.equal(c.classifyPath('x/y.bin', { onUnknown: (p) => (seen = p) }), 'process');
  assert.equal(seen, 'x/y.bin');
});

test('classifyPaths agrega; vazio => set vazio', () => {
  const s = classifyPaths(['src/a.mjs', 'scripts/b.mjs', 'ROADMAP.md'], silent);
  assert.deepEqual([...s].sort(), ['process', 'product_docs', 'runtime']);
  assert.equal(classifyPaths([], silent).size, 0);
});

test('vocabulário fechado', () => {
  assert.deepEqual(CHANGE_CLASSES, [
    'runtime',
    'process',
    'product_docs',
    'state',
    'general_docs',
  ]);
});
