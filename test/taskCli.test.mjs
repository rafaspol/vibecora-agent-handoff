import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { runCli, tmpRepoWithRemote } from './helpers.mjs';

const agentArgs = (id) => ['--agent-type', 'codex', '--agent-id', id];

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-task-cli-'));
  const bare = path.join(root, 'ledger.git');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.name', 'test');
  git(seed, 'config', 'user.email', 'test@test.invalid');
  fs.writeFileSync(path.join(seed, 'schema-version'), '2\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-u', 'origin', 'main');

  const consumer = tmpRepoWithRemote();
  const keyFile = path.join(root, 'key');
  fs.writeFileSync(keyFile, `${crypto.randomBytes(32).toString('base64')}\n`, {
    mode: 0o600,
  });
  consumer.write(
    '.agents/handoff.config.json',
    `${JSON.stringify({
      version: 3,
      tasks: {
        enabled: true,
        project: 'chat-vibecora',
        ledger: bare,
        cacheDir: path.join(root, 'cache'),
        keyFile,
      },
    })}\n`,
  );
  consumer.git('add', '.agents/handoff.config.json');
  consumer.git('commit', '-qm', 'config task system');
  return {
    root,
    bare,
    consumer,
    cleanup() {
      consumer.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function propose(repo, id, rank, dependencies = []) {
  return runCli(repo.dir, [
    'task',
    'propose',
    'add',
    '--task-id',
    id,
    '--title',
    `Tarefa ${id}`,
    '--objective',
    `Fazer ${id}`,
    '--done-when',
    `${id} verificada`,
    '--suggested-rank',
    String(rank),
    '--reason',
    'descoberta objetiva',
    ...agentArgs('origin-agent'),
    ...dependencies.flatMap((dependency) => ['--depends-on', dependency]),
    '--json',
  ]);
}

test('CLI mantém rascunho fora da fila até aprovação referenciada', () => {
  const fixture = setup();
  const proposed = propose(fixture.consumer, 'task-a', 1);
  assert.equal(proposed.code, 0, proposed.err);
  const proposal = JSON.parse(proposed.out);
  assert.equal(proposal.approvalRequired, true);
  assert.deepEqual(proposal.origin.agent, {
    type: 'codex',
    id: 'origin-agent',
  });

  const before = runCli(fixture.consumer.dir, ['task', 'list', '--json']);
  assert.equal(JSON.parse(before.out).priorities.length, 0);
  assert.equal(JSON.parse(before.out).drafts[0].id, 'task-a');
  assert.equal(JSON.parse(before.out).drafts[0].ageDays, 0);
  assert.equal(
    JSON.parse(before.out).drafts[0].origin.agent.id,
    'origin-agent',
  );
  const human = runCli(fixture.consumer.dir, ['task', 'list']);
  assert.match(human.out, /origem \d{4}-\d{2}-\d{2} · 0d · codex:origin-a/);

  const missing = runCli(fixture.consumer.dir, [
    'task',
    'approve',
    proposal.proposalId,
  ]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /approval-ref/);

  const approved = runCli(fixture.consumer.dir, [
    'task',
    'approve',
    proposal.proposalId,
    '--approval-ref',
    'thread:approved-by-rafaspol',
    '--json',
  ]);
  assert.equal(approved.code, 0, approved.err);
  const approvedTask = JSON.parse(approved.out).board.priorities[0];
  assert.equal(approvedTask.id, 'task-a');
  assert.ok(approvedTask.queuedAt);
  fixture.cleanup();
});

test('CLI recusa proposta com motivo e referência, e a recusa aparece no task list', () => {
  const fixture = setup();
  const proposal = JSON.parse(propose(fixture.consumer, 'task-a', 1).out);

  const noRef = runCli(fixture.consumer.dir, [
    'task', 'reject', proposal.proposalId, '--reason', 'duplicada',
  ]);
  assert.equal(noRef.code, 2);
  assert.match(noRef.err, /rejection-ref/);
  const noReason = runCli(fixture.consumer.dir, [
    'task', 'reject', proposal.proposalId, '--rejection-ref', 'thread:nao',
  ]);
  assert.equal(noReason.code, 2);
  assert.match(noReason.err, /--reason/);

  const rejected = runCli(fixture.consumer.dir, [
    'task', 'reject', proposal.proposalId,
    '--rejection-ref', 'thread:rejected-by-rafaspol',
    '--reason', 'duplica outra tarefa',
    '--json',
  ]);
  assert.equal(rejected.code, 0, rejected.err);
  assert.equal(JSON.parse(rejected.out).rejection.reason, 'duplica outra tarefa');

  const listed = JSON.parse(runCli(fixture.consumer.dir, ['task', 'list', '--json']).out);
  assert.deepEqual(listed.drafts, []);
  assert.deepEqual(listed.pendingProposals, []);
  assert.equal(listed.history[0].status, 'rejected');
  assert.deepEqual(listed.rejectedProposals[0].rejection.by, '@rafaspol');
  const human = runCli(fixture.consumer.dir, ['task', 'list']);
  assert.match(
    human.out,
    /Recusas:\n  proposal-\d+: add task-a recusada em \d{4}-\d{2}-\d{2} por @rafaspol \(thread:rejected-by-rafaspol\): duplica outra tarefa/,
  );

  const again = runCli(fixture.consumer.dir, [
    'task', 'approve', proposal.proposalId, '--approval-ref', 'thread:mudou-de-ideia',
  ]);
  assert.equal(again.code, 2);
  assert.match(again.err, /já foi decidida/);
  fixture.cleanup();
});

test('task next pula prioridade bloqueada, arma em 20% e não arma em 21%', () => {
  const fixture = setup();
  const taskB = JSON.parse(propose(fixture.consumer, 'task-b', 1).out);
  runCli(fixture.consumer.dir, [
    'task',
    'approve',
    taskB.proposalId,
    '--approval-ref',
    'thread:b',
  ]);
  const taskA = JSON.parse(propose(fixture.consumer, 'task-a', 1, ['task-b']).out);
  runCli(fixture.consumer.dir, [
    'task',
    'approve',
    taskA.proposalId,
    '--approval-ref',
    'thread:a',
  ]);

  const high = runCli(fixture.consumer.dir, [
    'task',
    'next',
    ...agentArgs('agent-a'),
    '--quota-remaining',
    '21',
    '--context-remaining',
    '80',
    '--json',
  ]);
  assert.equal(high.code, 0, high.err);
  assert.equal(JSON.parse(high.out).task.id, 'task-b');
  assert.equal(JSON.parse(high.out).decision.arm, false);

  const ready = runCli(fixture.consumer.dir, [
    'task',
    'finish',
    '--task-id',
    'task-b',
    ...agentArgs('agent-a'),
    '--claim-epoch',
    '1',
    '--json',
  ]);
  assert.equal(ready.code, 0, ready.err);
  const integrate = runCli(fixture.consumer.dir, [
    'task',
    'finish',
    '--task-id',
    'task-b',
    '--integrated',
  ]);
  assert.equal(integrate.code, 0, integrate.err);
  const history = runCli(fixture.consumer.dir, ['task', 'list']);
  assert.match(history.out, /Histórico:/);
  assert.match(history.out, /task-b — Tarefa task-b \[done\]/);
  assert.match(history.out, /implementada por codex:agent-a/);

  const low = runCli(fixture.consumer.dir, [
    'task',
    'next',
    ...agentArgs('agent-b'),
    '--quota-remaining',
    '20',
    '--context-remaining',
    '80',
    '--json',
  ]);
  assert.equal(low.code, 0, low.err);
  assert.equal(JSON.parse(low.out).task.id, 'task-a');
  assert.equal(JSON.parse(low.out).decision.arm, true);
  assert.ok(JSON.parse(low.out).checkpoint.path.endsWith('/task-a/1.enc'));
  fixture.cleanup();
});

test('medição é reutilizada por quinze minutos sem novo input', () => {
  const fixture = setup();
  const task = JSON.parse(propose(fixture.consumer, 'task-a', 1).out);
  runCli(fixture.consumer.dir, [
    'task',
    'approve',
    task.proposalId,
    '--approval-ref',
    'thread:a',
  ]);
  const first = runCli(fixture.consumer.dir, [
    'task',
    'next',
    ...agentArgs('agent-a'),
    '--quota-remaining',
    '21',
    '--json',
  ]);
  assert.equal(first.code, 0, first.err);
  const cache = path.join(fixture.root, 'cache', '.git', 'measurement-chat-vibecora.json');
  assert.equal(fs.existsSync(cache), true);
  const measured = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.equal(measured.quotaRemainingPercent, 21);
  fixture.cleanup();
});

test('task resume transfere o claim e restaura em worktree isolada', () => {
  const fixture = setup();
  const task = JSON.parse(propose(fixture.consumer, 'task-a', 1).out);
  runCli(fixture.consumer.dir, [
    'task',
    'approve',
    task.proposalId,
    '--approval-ref',
    'thread:a',
  ]);
  fixture.consumer.write('notes/continuar.txt', 'estado preventivo\n');
  const claimed = runCli(fixture.consumer.dir, [
    'task',
    'next',
    ...agentArgs('agent-a'),
    '--quota-remaining',
    '20',
    '--json',
  ]);
  assert.equal(claimed.code, 0, claimed.err);

  const preview = runCli(fixture.consumer.dir, ['task', 'resume', '--json']);
  assert.deepEqual(JSON.parse(preview.out).resumable[0].owner, {
    type: 'codex',
    id: 'agent-a',
  });

  const destination = path.join(fixture.root, 'resumed');
  const resumed = runCli(fixture.consumer.dir, [
    'task',
    'resume',
    '--claim',
    'task-a',
    ...agentArgs('agent-b'),
    '--destination',
    destination,
    '--json',
  ]);
  assert.equal(resumed.code, 0, resumed.err);
  const result = JSON.parse(resumed.out);
  assert.deepEqual(result.owner, { type: 'codex', id: 'agent-b' });
  assert.equal(result.claimEpoch, 2);
  assert.equal(
    fs.readFileSync(path.join(destination, 'notes/continuar.txt'), 'utf8'),
    'estado preventivo\n',
  );
  fixture.consumer.git('worktree', 'remove', '--force', destination);
  fixture.cleanup();
});

test('proposta nova sem identidade falha antes de escrever no ledger', () => {
  const fixture = setup();
  const env = { ...process.env };
  delete env.VIBECORA_AGENT_TYPE;
  delete env.VIBECORA_AGENT_ID;
  delete env.CODEX_THREAD_ID;
  const result = runCli(
    fixture.consumer.dir,
    [
      'task',
      'propose',
      'add',
      '--task-id',
      'sem-origem',
      '--title',
      'Sem origem',
      '--objective',
      'Não gravar',
      '--done-when',
      'Nunca',
      '--suggested-rank',
      '1',
      '--reason',
      'teste',
    ],
    { env },
  );
  assert.equal(result.code, 2);
  assert.match(result.err, /Identidade do agente indisponível/);
  const list = JSON.parse(
    runCli(fixture.consumer.dir, ['task', 'list', '--json']).out,
  );
  assert.equal(list.drafts.length, 0);
  fixture.cleanup();
});

test('task block e unblock registram impedimento sem mudar a posição', () => {
  const fixture = setup();
  const task = JSON.parse(propose(fixture.consumer, 'task-a', 1).out);
  runCli(fixture.consumer.dir, [
    'task',
    'approve',
    task.proposalId,
    '--approval-ref',
    'thread:a',
  ]);
  const blocked = runCli(fixture.consumer.dir, [
    'task',
    'block',
    '--task-id',
    'task-a',
    '--reason',
    'aguarda decisão',
  ]);
  assert.equal(blocked.code, 0, blocked.err);
  const during = JSON.parse(
    runCli(fixture.consumer.dir, ['task', 'list', '--json']).out,
  );
  assert.equal(during.priorities[0].rank, 1);
  assert.equal(during.blockedPriorities[0].id, 'task-a');
  const unblocked = runCli(fixture.consumer.dir, [
    'task',
    'unblock',
    '--task-id',
    'task-a',
  ]);
  assert.equal(unblocked.code, 0, unblocked.err);
  const after = JSON.parse(
    runCli(fixture.consumer.dir, ['task', 'list', '--json']).out,
  );
  assert.equal(after.nextExecutable.id, 'task-a');
  fixture.cleanup();
});

test('task list --json lido por pipe sai inteiro acima de 64 KB', () => {
  const fixture = setup();
  const seed = path.join(fixture.root, 'seed');
  const project = path.join(seed, 'projects', 'chat-vibecora');
  fs.mkdirSync(project, { recursive: true });
  const long = 'objetivo longo '.repeat(40);
  const events = Array.from({ length: 200 }, (_, index) => ({
    id: `seed-${index}`,
    type: 'task_drafted',
    at: '2026-09-24T00:00:00Z',
    agent: { type: 'codex', id: 'seed-agent' },
    task: {
      id: `tarefa-${index}`,
      title: `Tarefa ${index}`,
      objective: `${long}${index}`,
      doneWhen: `tarefa-${index} verificada`,
      dependencies: [],
      suggestedRank: 1,
      roadmapRef: null,
    },
    proposal: { id: `proposal-${index}`, kind: 'add', taskId: `tarefa-${index}`, suggestedRank: 1, reason: 'volume' },
  }));
  fs.writeFileSync(
    path.join(project, 'events.jsonl'),
    `${events.map((item) => JSON.stringify(item)).join('\n')}\n`,
  );
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'volume');
  git(seed, 'push', 'origin', 'main');

  const listed = runCli(fixture.consumer.dir, ['task', 'list', '--json']);
  assert.equal(listed.code, 0, listed.err);
  assert.ok(Buffer.byteLength(listed.out) > 65536, `saída de ${Buffer.byteLength(listed.out)} bytes`);
  assert.equal(JSON.parse(listed.out).drafts.length, 200);
  fixture.cleanup();
});
