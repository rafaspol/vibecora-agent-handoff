import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boardProjection,
  boardView,
  proposalImpact,
  reduceTaskEvents,
} from '../src/tasks/reducer.mjs';

let sequence = 0;
const event = (type, fields = {}) => ({
  id: `event-${++sequence}`,
  type,
  at: `2026-09-13T00:00:${String(sequence).padStart(2, '0')}Z`,
  ...fields,
});

function draft(id, rank, dependencies = []) {
  return event('task_drafted', {
    task: {
      id,
      title: `Tarefa ${id}`,
      objective: `Fazer ${id}`,
      doneWhen: `${id} verificada`,
      dependencies,
      suggestedRank: rank,
      roadmapRef: null,
    },
    proposal: {
      id: `proposal-${id}`,
      kind: 'add',
      taskId: id,
      suggestedRank: rank,
      reason: 'necessária',
    },
  });
}

const approve = (id) =>
  event('proposal_approved', {
    proposalId: `proposal-${id}`,
    approvedBy: '@rafaspol',
    approvalRef: `thread:${id}`,
  });

test('rascunho e task propose não mudam a fila aprovada', () => {
  const board = reduceTaskEvents([draft('a', 1)], { project: 'p' });
  assert.equal(board.tasks.a.status, 'draft');
  assert.deepEqual(board.queue, []);
  assert.equal(boardView(board).drafts.length, 1);
});

test('aprovação insere em posição única e calcula deslocados', () => {
  const events = [draft('a', 1), approve('a'), draft('b', 1)];
  const before = reduceTaskEvents(events, { project: 'p' });
  assert.deepEqual(proposalImpact(before, before.proposals['proposal-b']), {
    suggestedRank: 1,
    displaced: ['a'],
  });
  const after = reduceTaskEvents([...events, approve('b')], { project: 'p' });
  assert.deepEqual(after.queue, ['b', 'a']);
});

test('dependência bloqueia sem reordenar e expõe a próxima executável', () => {
  const board = reduceTaskEvents(
    [draft('a', 1, ['b']), approve('a'), draft('b', 2), approve('b')],
    { project: 'p' },
  );
  const view = boardView(board);
  assert.deepEqual(board.queue, ['a', 'b']);
  assert.equal(view.blockedPriorities[0].id, 'a');
  assert.equal(view.nextExecutable.id, 'b');
});

test('impedimento bloqueia sem alterar prioridade e pode ser limpo', () => {
  const base = [draft('a', 1), approve('a')];
  const impeded = reduceTaskEvents(
    [...base, event('task_impeded', { taskId: 'a', reason: 'aguarda decisão' })],
    { project: 'p' },
  );
  assert.deepEqual(impeded.queue, ['a']);
  assert.equal(
    boardView(impeded).blockedPriorities[0].blockers.impediment,
    'aguarda decisão',
  );
  const clear = reduceTaskEvents(
    [
      ...base,
      event('task_impeded', { taskId: 'a', reason: 'aguarda decisão' }),
      event('task_impediment_cleared', { taskId: 'a' }),
    ],
    { project: 'p' },
  );
  assert.equal(boardView(clear).nextExecutable.id, 'a');
});

test('remoção e reordenação só acontecem após aprovação e preservam história', () => {
  const initial = [draft('a', 1), approve('a'), draft('b', 2), approve('b')];
  const removeProposal = event('proposal_created', {
    proposal: {
      id: 'remove-a',
      kind: 'remove',
      taskId: 'a',
      reason: 'substituída',
      consequence: 'A deixa de ser atendida.',
    },
  });
  const pending = reduceTaskEvents([...initial, removeProposal], { project: 'p' });
  assert.deepEqual(pending.queue, ['a', 'b']);
  const removed = reduceTaskEvents(
    [
      ...initial,
      removeProposal,
      event('proposal_approved', {
        proposalId: 'remove-a',
        approvedBy: '@rafaspol',
        approvalRef: 'thread:remove',
      }),
    ],
    { project: 'p' },
  );
  assert.equal(removed.tasks.a.status, 'removed');
  assert.deepEqual(removed.queue, ['b']);
  assert.equal(boardView(removed).history[0].id, 'a');
});

test('claim usa época monotônica e agente anterior não finaliza após transferência', () => {
  const base = [draft('a', 1), approve('a')];
  const claimed = event('task_claimed', {
    taskId: 'a',
    owner: 'agent-a',
    claimEpoch: 1,
  });
  const transferred = event('task_claimed', {
    taskId: 'a',
    owner: 'agent-b',
    claimEpoch: 2,
  });
  assert.throws(
    () =>
      reduceTaskEvents(
        [
          ...base,
          claimed,
          transferred,
          event('task_ready', {
            taskId: 'a',
            owner: 'agent-a',
            claimEpoch: 1,
            candidateCommit: 'abc',
          }),
        ],
        { project: 'p' },
      ),
    /responsável atual/,
  );
  assert.throws(
    () =>
      reduceTaskEvents(
        [
          ...base,
          claimed,
          event('task_claimed', {
            taskId: 'a',
            owner: 'agent-b',
            claimEpoch: 3,
          }),
        ],
        { project: 'p' },
      ),
    /Época de claim inválida/,
  );
  assert.throws(
    () =>
      reduceTaskEvents(
        [
          ...base,
          claimed,
          transferred,
          event('task_claimed', {
            taskId: 'a',
            owner: 'agent-a',
            claimEpoch: 3,
          }),
          event('task_ready', {
            taskId: 'a',
            owner: 'agent-a',
            claimEpoch: 1,
            candidateCommit: 'abc',
          }),
        ],
        { project: 'p' },
      ),
    /responsável atual/,
  );
});

test('resultado tardio vira candidato alternativo ligado ao claim anterior', () => {
  const events = [
    draft('a', 1),
    approve('a'),
    event('task_claimed', { taskId: 'a', owner: 'agente-a', claimEpoch: 1 }),
    event('task_claimed', { taskId: 'a', owner: 'agente-b', claimEpoch: 2 }),
    event('task_alternate_candidate', {
      taskId: 'a',
      owner: 'agente-a',
      claimEpoch: 1,
      candidateCommit: 'a'.repeat(40),
      mergeBase: 'b'.repeat(40),
    }),
  ];
  const board = reduceTaskEvents(events, { project: 'x' });
  assert.equal(board.tasks.a.alternateCandidates.length, 1);
  assert.equal(board.tasks.a.alternateCandidates[0].owner, 'agente-a');
  assert.throws(
    () =>
      reduceTaskEvents(
        [
          ...events,
          event('task_alternate_candidate', {
            taskId: 'a',
            owner: 'agente-b',
            claimEpoch: 2,
            candidateCommit: 'c'.repeat(40),
            mergeBase: 'b'.repeat(40),
          }),
        ],
        { project: 'x' },
      ),
    /não vem de claim anterior/,
  );
});

test('projeção contém somente estado derivado do histórico', () => {
  const board = reduceTaskEvents([draft('a', 1), approve('a')], { project: 'p' });
  const projection = boardProjection(board);
  assert.equal(projection.priorities[0].id, 'a');
  assert.equal(projection.priorities[0].rank, 1);
  assert.equal(projection.drafts.length, 0);
});
