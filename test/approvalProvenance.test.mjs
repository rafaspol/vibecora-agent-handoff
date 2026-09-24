import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_APPROVAL_SUMMARY,
  approvalBasis,
  approvalNote,
  approvalProvenance,
  approvalRecord,
} from '../src/tasks/approvalProvenance.mjs';

const DELEGACAO = 'rafaspol:conversa-2026-09-22:entrada-delegada-ordem-livre';

test('a base sai da referência: documento, delegação ou conversa', () => {
  assert.equal(approvalBasis('ledger:projects/p/approvals/a.md'), 'document');
  assert.equal(
    approvalBasis(DELEGACAO, { delegationRefs: [DELEGACAO] }),
    'delegation'
  );
  // Sem a lista, a mesma referência é só uma conversa citada.
  assert.equal(approvalBasis(DELEGACAO), 'conversation');
  for (const ref of ['codex-thread:x', 'claude-session:y', 'rafaspol:quiz-z', 'texto solto']) {
    assert.equal(approvalBasis(ref), 'conversation', ref);
  }
});

test('documento só vale se existir no ledger, e sem sair dele', () => {
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-prov-'));
  fs.mkdirSync(path.join(ledger, 'approvals'));
  fs.writeFileSync(path.join(ledger, 'approvals', 'a.md'), 'ok\n');

  const ok = approvalProvenance({ ref: 'ledger:approvals/a.md', ledgerRoot: ledger });
  assert.equal(ok.approvalBasis, 'document');
  assert.equal(ok.recordedBy, null);
  assert.equal('approvalSummary' in ok, false);

  assert.throws(
    () => approvalProvenance({ ref: 'ledger:approvals/nao-existe.md', ledgerRoot: ledger }),
    /não existe no ledger/
  );
  for (const ref of ['ledger:../fora.md', 'ledger:/etc/passwd', 'ledger:']) {
    assert.throws(() => approvalProvenance({ ref, ledgerRoot: ledger }), /inválida/, ref);
  }
  fs.rmSync(ledger, { recursive: true, force: true });
});

test('conversa exige resumo do que o condutor decidiu; delegação não', () => {
  assert.throws(
    () => approvalProvenance({ ref: 'rafaspol:quiz-1' }),
    /--approval-summary/
  );
  assert.throws(
    () => approvalProvenance({ ref: 'rafaspol:quiz-1', summary: '   ' }),
    /--approval-summary/
  );
  assert.throws(
    () => approvalProvenance({ ref: 'rafaspol:quiz-1', summary: 'x'.repeat(MAX_APPROVAL_SUMMARY + 1) }),
    /passa de/
  );
  const conversa = approvalProvenance({
    ref: 'rafaspol:quiz-1',
    summary: '  Aceito o ADR 0022  ',
    recordedBy: { type: 'claude', id: '01ekis3z' },
  });
  assert.deepEqual(conversa, {
    approvalBasis: 'conversation',
    recordedBy: { type: 'claude', id: '01ekis3z' },
    approvalSummary: 'Aceito o ADR 0022',
  });
  const delegada = approvalProvenance({ ref: DELEGACAO, delegationRefs: [DELEGACAO] });
  assert.equal(delegada.approvalBasis, 'delegation');
});

test('aprovação antiga é classificada pelo prefixo e marcada, sem inventar registrante', () => {
  const antiga = approvalRecord({
    approvedBy: '@rafaspol',
    approvalRef: 'codex-thread:abc',
    at: '2026-09-14T00:00:00.000Z',
  });
  assert.equal(antiga.legacy, true);
  assert.equal(antiga.basis, 'conversation');
  assert.equal(antiga.recordedBy, null);
  assert.equal(
    approvalRecord({ approvedBy: '@rafaspol', approvalRef: 'ledger:a.md', at: 'x' }).basis,
    'document'
  );

  const nova = approvalRecord({
    approvedBy: '@rafaspol',
    approvalRef: 'rafaspol:quiz-1',
    at: 'x',
    approvalBasis: 'conversation',
    recordedBy: { type: 'claude', id: '01ekis3z' },
    approvalSummary: 'Aceito',
  });
  assert.equal(nova.legacy, false);
  assert.equal(nova.summary, 'Aceito');
});

test('a listagem ressalva o que é declarado e cala sobre o documento', () => {
  assert.equal(approvalNote({ basis: 'document', recordedBy: null }), '');
  assert.equal(approvalNote(null), '');
  assert.equal(
    approvalNote({ basis: 'conversation', recordedBy: { type: 'claude', id: '01ekis3z' } }),
    'aprovação declarada (conversa; claude:01ekis3z)'
  );
  assert.equal(
    approvalNote({ basis: 'delegation', recordedBy: { type: 'codex', id: 'a' } }),
    'aprovação declarada (delegação; codex:a)'
  );
  assert.equal(
    approvalNote({ basis: 'conversation', recordedBy: null, legacy: true }),
    'aprovação declarada (conversa; registro anterior à proveniência)'
  );
  assert.equal(
    approvalNote({ basis: 'conversation', recordedBy: null, legacy: false }),
    'aprovação declarada (conversa; registrante não identificado)'
  );
});
