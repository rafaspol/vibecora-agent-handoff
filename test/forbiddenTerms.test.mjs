import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseTerms,
  runForbiddenTermsCheck,
  scanFiles,
} from '../src/forbiddenTerms.mjs';

test('parseTerms separa por vírgula e limpa', () => {
  assert.deepEqual(parseTerms(' Foo , bar ,, baz '), ['Foo', 'bar', 'baz']);
  assert.deepEqual(parseTerms(''), []);
  assert.deepEqual(parseTerms(undefined), []);
});

test('scanFiles acha o termo, insensível a maiúsculas, sem repetir o termo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  fs.writeFileSync(path.join(dir, 'a.md'), 'linha um\nesta cita AcmeCorp aqui\nfim');
  fs.writeFileSync(path.join(dir, 'b.js'), 'const ok = 1;\n');
  const findings = scanFiles(
    [path.join(dir, 'a.md'), path.join(dir, 'b.js')],
    ['acmecorp'],
    { root: dir },
  );
  assert.deepEqual(findings, [{ file: 'a.md', line: 2 }]);
  const serialized = JSON.stringify(findings);
  assert.ok(!serialized.toLowerCase().includes('acmecorp'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('não configurado => reporta que não protege nada', () => {
  const saved = process.env.HANDOFF_FORBIDDEN_TERMS;
  delete process.env.HANDOFF_FORBIDDEN_TERMS;
  const r = runForbiddenTermsCheck({ root: process.cwd(), includeHistory: false });
  assert.equal(r.configured, false);
  assert.match(r.reason, /não protege nada/);
  if (saved !== undefined) process.env.HANDOFF_FORBIDDEN_TERMS = saved;
});

test('configurado e limpo => clean true (projeto fictício)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  fs.writeFileSync(path.join(dir, 'x.md'), 'projeto fictício acme-fake\n');
  const saved = process.env.HANDOFF_FORBIDDEN_TERMS;
  process.env.HANDOFF_FORBIDDEN_TERMS = 'termo-que-nao-existe';
  const r = runForbiddenTermsCheck({ root: dir, includeHistory: false });
  assert.equal(r.configured, true);
  assert.equal(r.clean, true);
  if (saved === undefined) delete process.env.HANDOFF_FORBIDDEN_TERMS;
  else process.env.HANDOFF_FORBIDDEN_TERMS = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});
