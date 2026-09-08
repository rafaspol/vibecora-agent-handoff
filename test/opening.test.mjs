import assert from 'node:assert/strict';
import test from 'node:test';

import { BLOCKING, DETECTORS, evaluateOpening } from '../src/opening.mjs';

// Abertura limpa: nada disparado. É a base de todo negativo simétrico abaixo —
// cada teste liga UMA condição e confere que ela, e só ela, muda o veredito.
const clean = () => ({
  openPrs: [],
  missingBranches: [],
  commitsBehind: 0,
  snapshotPresent: true,
  snapshotCommit: 'abc1234',
  snapshotRelation: 'contained',
  currentConstraints: ['trava-a', 'trava-b'],
  historicalConstraints: ['trava-a', 'trava-b'],
  retiredConstraints: [],
  productionChecked: true,
});

test('estado limpo não bloqueia e não dispara nada', () => {
  const r = evaluateOpening(clean());
  assert.equal(r.blocked, false);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(Object.keys(r.detectors).sort(), [...DETECTORS].sort());
});

test('queue_hidden: PR aberta bloqueia; sem PR não bloqueia', () => {
  const r = evaluateOpening({
    ...clean(),
    openPrs: [{ number: 69, title: 'estabilização' }],
  });
  assert.equal(r.blocked, true);
  assert.equal(r.detectors.queue_hidden.fired, true);
  assert.ok(r.reasons.some((m) => m.includes('#69')));

  assert.equal(evaluateOpening(clean()).detectors.queue_hidden.fired, false);
});

test('queue_hidden: branch remota ausente do clone bloqueia sozinha', () => {
  // Sem PR nenhuma. Uma branch que existe no remoto e nunca chegou a este
  // checkout é trabalho que o retrato não tem como conhecer.
  const r = evaluateOpening({
    ...clean(),
    missingBranches: ['fix/estabilizacao'],
  });
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((m) => m.includes('fix/estabilizacao')));
});

test('snapshot_stale: divergente bloqueia; contido não', () => {
  const r = evaluateOpening({ ...clean(), snapshotRelation: 'diverged' });
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((m) => m.includes('outra linha de histórico')));

  assert.equal(
    evaluateOpening({ ...clean(), snapshotRelation: 'contained' }).blocked,
    false
  );
});

test('snapshot_stale: retrato À FRENTE do publicado não bloqueia', () => {
  // O falso positivo que a primeira versão desta regra produziu, pego na
  // primeira abertura real: o retrato foi gravado num commit local que ainda
  // não subiu. Onde o push é deliberado, esse é o caso comum — e um bloqueio
  // que dispara no caso comum ensina o agente a passar por cima.
  const r = evaluateOpening({ ...clean(), snapshotRelation: 'ahead' });
  assert.equal(r.blocked, false);
  assert.equal(r.detectors.snapshot_stale.fired, false);
});

test('snapshot_stale: não conseguir medir NÃO é o mesmo que estar errado', () => {
  // `null` é "não deu para medir" (sem remoto, sem rede). Bloquear aqui faria
  // o comando reprovar quem está offline.
  const r = evaluateOpening({ ...clean(), snapshotRelation: null });
  assert.equal(r.blocked, false);
  assert.equal(r.detectors.snapshot_stale.fired, false);
});

test('snapshot_stale: retrato AUSENTE informa, retrato QUEBRADO bloqueia', () => {
  // O simétrico que separa os dois casos de `snapshotCommit` vazio. Sem ele, um
  // projeto que acabou de rodar `init` levaria bloqueio na primeira abertura —
  // a ferramenta reprovando quem está começando a usá-la.
  const ausente = evaluateOpening({
    ...clean(),
    snapshotPresent: false,
    snapshotCommit: null,
    snapshotRelation: null,
  });
  assert.equal(ausente.blocked, false);
  assert.equal(ausente.detectors.snapshot_stale.fired, false);
  assert.ok(ausente.notes.some((m) => m.includes('ainda não há retrato')));

  const quebrado = evaluateOpening({
    ...clean(),
    snapshotPresent: true,
    snapshotCommit: null,
  });
  assert.equal(quebrado.blocked, true);
  assert.ok(quebrado.reasons.some((m) => m.includes('não declara commit')));
});

test('constraint_dropped: id que sumiu bloqueia; aposentado não', () => {
  const gone = evaluateOpening({
    ...clean(),
    currentConstraints: ['trava-a'],
    historicalConstraints: ['trava-a', 'trava-b'],
  });
  assert.equal(gone.blocked, true);
  assert.ok(gone.reasons.some((m) => m.includes('trava-b')));

  // O negativo simétrico: o MESMO id fora do arquivo, mas em `retired`. É o
  // que separa uma decisão de um apagamento.
  const retired = evaluateOpening({
    ...clean(),
    currentConstraints: ['trava-a'],
    historicalConstraints: ['trava-a', 'trava-b'],
    retiredConstraints: ['trava-b'],
  });
  assert.equal(retired.blocked, false);
});

test('constraint_dropped: acrescentar constraint é livre', () => {
  const r = evaluateOpening({
    ...clean(),
    currentConstraints: ['trava-a', 'trava-b', 'trava-c'],
  });
  assert.equal(r.blocked, false);
});

test('production_unverified informa, não bloqueia', () => {
  const r = evaluateOpening({ ...clean(), productionChecked: false });
  assert.equal(r.blocked, false);
  assert.equal(r.detectors.production_unverified.fired, true);
  assert.equal(r.detectors.production_unverified.blocking, false);
  assert.ok(r.notes.some((m) => m.includes('production_unverified')));
});

test('remote_ahead informa, não bloqueia', () => {
  // Deliberado: o remoto à frente é o estado normal de quem ainda não deu
  // `pull`. Alarme que grita sempre é alarme desligado.
  const r = evaluateOpening({ ...clean(), commitsBehind: 20 });
  assert.equal(r.blocked, false);
  assert.equal(r.detectors.remote_ahead.fired, true);
  assert.ok(r.notes.some((m) => m.includes('20 commit')));
  assert.equal(BLOCKING.has('remote_ahead'), false);
});

test('o acidente que motivou esta camada seria bloqueado, com as três razões', () => {
  // O caso real: o resumo do retrato dizia "não há fila" enquanto vinte commits
  // esperavam numa branch, com uma PR aberta ao lado, e o retrato apontava para
  // um commit fora da linha publicada. Nenhum gate pegaria — a fonte é que
  // estava errada. Este é o teste que diz se esta camada serve para alguma coisa.
  const r = evaluateOpening({
    openPrs: [{ number: 69, title: 'estabilização sequencial' }],
    missingBranches: ['fix/estabilizacao'],
    commitsBehind: 20,
    snapshotPresent: true,
    snapshotCommit: '13b8d42',
    snapshotRelation: 'diverged',
    currentConstraints: ['trava-a'],
    historicalConstraints: ['trava-a', 'trava-b'],
    retiredConstraints: [],
    productionChecked: false,
  });

  assert.equal(r.blocked, true);
  assert.equal(r.reasons.length, 3);
  assert.ok(r.reasons.some((m) => m.startsWith('queue_hidden:')));
  assert.ok(r.reasons.some((m) => m.startsWith('snapshot_stale:')));
  assert.ok(r.reasons.some((m) => m.startsWith('constraint_dropped:')));
  // E os dois informativos continuam informativos mesmo no pior caso.
  assert.equal(r.notes.length, 2);
});

test('só três detectores bloqueiam, e são estes', () => {
  // Trava de escopo: um bloqueio a mais na abertura é barato de acrescentar e
  // caro de manter.
  assert.deepEqual([...BLOCKING].sort(), [
    'constraint_dropped',
    'queue_hidden',
    'snapshot_stale',
  ]);
});
