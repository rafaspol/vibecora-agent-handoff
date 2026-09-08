import assert from 'node:assert/strict';
import test from 'node:test';

import { makeClassifier } from '../src/classify.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { buildRunEvent, validateHandoff } from '../src/schema.mjs';

const classifier = makeClassifier(DEFAULT_CONFIG);

function fixture() {
  const handoff = {
    version: 3,
    run_id: 'r1',
    recorded_at: '2026-09-01T00:00:00Z',
    branch: 'feat/x',
    task_class: 'demo',
    operation: 'implement',
    agent_runtime: { agent: 'A', model: 'm', environment: 'local' },
    change_class: ['process'],
    delivery: { task: 'Entrega.', completed: ['Feito.'] },
    code: { state: 'local_commit', commit: 'abc1234' },
    release_intent: 'not_requested',
    tests: { ran: ['npm test'], result: 'pass' },
    roadmap: { status: 'not_applicable', reason: 'sem produto' },
    decisions: [],
    risks: [],
    assumptions: [],
    remaining: [],
    context: [{ claim: 'c', basis: 'verified', evidence: 'rodei os testes' }],
  };
  const event = {
    event: 'run_completed',
    run_id: 'r1',
    task_class: 'demo',
    operation: 'implement',
    commit: 'abc1234',
    code_state: 'local_commit',
    release_intent: 'not_requested',
    roadmap_status: 'not_applicable',
  };
  const git = {
    changedPaths: ['scripts/a.mjs'],
    commitExists: () => true,
    mainContains: () => false,
    isAncestor: () => false,
  };
  return { handoff, event, git };
}

test('handoff v3 consistente passa', () => {
  const { handoff, event, git } = fixture();
  assert.deepEqual(
    validateHandoff({ handoff, performanceEvents: [event], git, classifier }),
    [],
  );
});

test('rejeita version != 3 (v2 só como histórico)', () => {
  const { handoff, event, git } = fixture();
  handoff.version = 2;
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git,
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('version deve ser 3')));
});

test('integridade de evidência: verified exige evidência concreta', () => {
  const { handoff, event, git } = fixture();
  handoff.context = [{ claim: 'c', basis: 'verified', evidence: '' }];
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git,
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('context[0].evidence')));
});

test('assumed aceita evidência curta', () => {
  const { handoff, event, git } = fixture();
  handoff.context = [{ claim: 'c', basis: 'assumed', evidence: 'hipótese' }];
  assert.deepEqual(
    validateHandoff({ handoff, performanceEvents: [event], git, classifier }),
    [],
  );
});

test('append-only: run_completed duplicado é erro', () => {
  const { handoff, event, git } = fixture();
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event, { ...event }],
    git,
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('append-only violado')));
});

test('change_class: classe tocada não declarada é erro (forward-only)', () => {
  const { handoff, event, git } = fixture();
  git.changedPaths = ['src/app.mjs', 'scripts/a.mjs']; // runtime + process
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git,
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('change_class não inclui "runtime"')));
});

test('change_class mais amplo que o diff é aceito', () => {
  const { handoff, event, git } = fixture();
  handoff.change_class = ['process', 'runtime', 'state'];
  assert.deepEqual(
    validateHandoff({ handoff, performanceEvents: [event], git, classifier }),
    [],
  );
});

test('merged_main sem ancestralidade + commit ausente', () => {
  const { handoff, event } = fixture();
  handoff.code.state = 'merged_main';
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git: {
      changedPaths: ['scripts/a.mjs'],
      commitExists: () => false,
      mainContains: () => false,
    },
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('não existe no repositório')));
  assert.ok(errs.some((e) => e.includes('não é ancestral de main')));
});

test('cross-check com run_completed: release_intent divergente', () => {
  const { handoff, event, git } = fixture();
  event.release_intent = 'authorized';
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git,
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('run_completed.release_intent')));
});

test('cross-check: commit do retrato DESCENDENTE do evento passa', () => {
  // `new` grava `code.commit` com o HEAD do momento e `finalize` não reescreve
  // o evento. Commitar depois de gravar fazia divergir e reprovava um retrato
  // honesto — a dor que obrigou a inventar `run_id` com sufixo três vezes num
  // dia. O trabalho do evento está CONTIDO no que o retrato descreve.
  const { handoff, event, git } = fixture();
  handoff.code.commit = 'def5678';
  assert.deepEqual(
    validateHandoff({
      handoff,
      performanceEvents: [event],
      git: { ...git, isAncestor: (a, b) => a === 'abc1234' && b === 'def5678' },
      classifier,
    }),
    [],
  );
});

test('cross-check: commit de outra linha de histórico reprova', () => {
  // O negativo simétrico do anterior. Sem ele, a regra passaria a aceitar
  // qualquer commit diferente — que é exatamente o que o cruzamento existe
  // para pegar.
  const { handoff, event, git } = fixture();
  handoff.code.commit = 'f00ba12';
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git: { ...git, isAncestor: () => false },
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('run_completed.commit')));
});

test('cross-check: sem isAncestor disponível, só a igualdade vale', () => {
  // `git` é opcional no schema, e quem não o fornece não perde o cruzamento:
  // degrada para o comportamento anterior em vez de deixar de checar.
  const { handoff, event, git } = fixture();
  handoff.code.commit = 'def5678';
  const errs = validateHandoff({
    handoff,
    performanceEvents: [event],
    git: { ...git, isAncestor: undefined },
    classifier,
  });
  assert.ok(errs.some((e) => e.includes('run_completed.commit')));
});

test('handoff sem pendências é válido; múltiplos riscos idem', () => {
  const { handoff, event, git } = fixture();
  handoff.remaining = [];
  handoff.risks = ['r1', 'r2', 'r3'];
  assert.deepEqual(
    validateHandoff({ handoff, performanceEvents: [event], git, classifier }),
    [],
  );
});

test('buildRunEvent deriva result de tests.result', () => {
  const { handoff } = fixture();
  assert.equal(buildRunEvent(handoff).result, 'success');
  handoff.tests.result = 'fail';
  assert.equal(buildRunEvent(handoff).result, 'failed');
});
