import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  captureCheckpoint,
  loadCheckpointKey,
  restoreCheckpoint,
} from '../tasks/checkpoint.mjs';
import {
  appendEventsAndPush,
  currentBoard,
  newEvent,
  relativeCheckpointPath,
  syncLedger,
} from '../tasks/ledger.mjs';
import { boardView, proposalImpact } from '../tasks/reducer.mjs';
import { readMeasurement, resourceDecision } from '../tasks/measurements.mjs';

const ACTIONS = new Set(['list', 'propose', 'approve', 'next', 'arm', 'resume', 'finish']);

function required(value, label) {
  if (value == null || value === '') throw new Error(`${label} é obrigatório.`);
  return value;
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} precisa ser inteiro positivo.`);
  }
  return parsed;
}

function taskConfig(config) {
  const tasks = config.tasks || {};
  if (!tasks.enabled) throw new Error('Sistema de tarefas desativado na configuração.');
  required(tasks.project, 'tasks.project');
  required(tasks.ledger, 'tasks.ledger');
  return tasks;
}

function print(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function formatList(board) {
  const view = boardView(board);
  const lines = [`TAREFAS — ${view.project}`, ''];
  lines.push('Fila aprovada:');
  if (view.priorities.length === 0) lines.push('  vazia');
  for (const task of view.priorities) {
    const blocker = task.blockers.blocked
      ? ` · bloqueada por ${[
          ...task.blockers.dependencies,
          task.blockers.impediment,
        ].filter(Boolean).join(', ')}`
      : '';
    lines.push(
      `  ${task.rank}. ${task.id} — ${task.title} [${task.status}]${task.owner ? ` · ${task.owner}` : ''}${blocker}`,
    );
  }
  lines.push(
    '',
    `Próxima executável: ${view.nextExecutable ? `${view.nextExecutable.id} — ${view.nextExecutable.title}` : 'nenhuma'}`,
    `Mudança sugerida: ${view.recommendation}`,
    '',
    'Rascunhos aguardando aprovação:',
  );
  if (view.drafts.length === 0) lines.push('  nenhum');
  for (const task of view.drafts) {
    lines.push(`  ${task.id} — ${task.title} · posição sugerida ${task.suggestedRank}`);
  }
  lines.push('', `Histórico: ${view.history.length} tarefa(s) done/removed.`);
  return lines.join('\n');
}

function append({ repo, tasks, events, files, message }) {
  return appendEventsAndPush({
    repo,
    project: tasks.project,
    events,
    files,
    message,
    branch: tasks.branch || 'main',
  });
}

function proposedTask(args) {
  const id = required(args.taskId, '--task-id');
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(id) || id.includes('..')) {
    throw new Error('--task-id precisa ser um identificador seguro e estável.');
  }
  return {
    id,
    title: required(args.title, '--title'),
    objective: required(args.objective, '--objective'),
    doneWhen: required(args.doneWhen, '--done-when'),
    dependencies: args.dependsOn || [],
    suggestedRank: integer(args.suggestedRank, '--suggested-rank'),
    roadmapRef: args.roadmapRef || null,
  };
}

function propose(args, repo, tasks) {
  const kind = args._[1] || args.kind;
  if (!['add', 'remove', 'reorder'].includes(kind)) {
    throw new Error('Use task propose add|remove|reorder.');
  }
  const board = currentBoard(repo, tasks.project);
  const proposalId = args.proposalId || `proposal-${Date.now()}`;
  let event;
  let proposal;

  if (kind === 'add') {
    const task = proposedTask(args);
    proposal = {
      id: proposalId,
      kind,
      taskId: task.id,
      suggestedRank: task.suggestedRank,
      reason: required(args.reason, '--reason'),
    };
    event = newEvent('task_drafted', { task, proposal });
  } else {
    proposal = {
      id: proposalId,
      kind,
      taskId: required(args.taskId, '--task-id'),
      reason: required(args.reason, '--reason'),
      ...(kind === 'remove'
        ? { consequence: required(args.consequence, '--consequence') }
        : { suggestedRank: integer(args.suggestedRank, '--suggested-rank') }),
    };
    event = newEvent('proposal_created', { proposal });
  }
  const impact = proposalImpact(board, proposal);
  append({
    repo,
    tasks,
    events: [event],
    message: `task: propõe ${kind} ${proposal.taskId}`,
  });
  return {
    proposalId,
    kind,
    taskId: proposal.taskId,
    impact,
    approvalRequired: true,
    message: `Peça aprovação de @rafaspol para ${proposalId}; a fila vigente não mudou.`,
  };
}

function approve(args, repo, tasks) {
  const proposalId = required(args._[1] || args.proposalId, 'proposal id');
  const board = currentBoard(repo, tasks.project);
  const proposal = board.proposals[proposalId];
  if (!proposal) throw new Error(`Proposta inexistente: ${proposalId}.`);
  const impact = proposalImpact(board, proposal);
  const event = newEvent('proposal_approved', {
    proposalId,
    approvedBy: tasks.conductor || '@rafaspol',
    approvalRef: required(args.approvalRef, '--approval-ref'),
  });
  const next = append({
    repo,
    tasks,
    events: [event],
    message: `task: aprova ${proposal.kind} ${proposal.taskId}`,
  });
  return { proposalId, impact, board: boardView(next) };
}

function checkpointTemp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-arm-'));
  return { root, file: path.join(root, 'checkpoint.enc') };
}

function makeCheckpoint({ cwd, args, tasks, task, epoch }) {
  const temp = checkpointTemp();
  try {
    const key = loadCheckpointKey({
      keyEnv: tasks.keyEnv,
      keyFile: tasks.keyFile,
    });
    const checkpoint = captureCheckpoint({
      cwd,
      outputPath: temp.file,
      key,
      maxBytes: tasks.maxCheckpointBytes,
    });
    const relativePath = relativeCheckpointPath(tasks.project, task.id, epoch);
    return {
      event: newEvent('checkpoint_armed', {
        taskId: task.id,
        checkpoint: {
          ...checkpoint,
          epoch,
          path: relativePath,
        },
      }),
      file: { sourcePath: temp.file, relativePath },
      cleanup: () => fs.rmSync(temp.root, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(temp.root, { recursive: true, force: true });
    throw error;
  }
}

function nextTask(args, ctx, repo, tasks) {
  const board = currentBoard(repo, tasks.project);
  const view = boardView(board);
  const task = view.nextExecutable;
  if (!task) throw new Error('Nenhuma tarefa aprovada e executável.');
  const owner = required(args.owner, '--owner');
  const measurement = readMeasurement({
    args,
    ledgerRepo: repo,
    project: tasks.project,
    cacheMinutes: tasks.measurementCacheMinutes,
  });
  const decision = resourceDecision(measurement, tasks.thresholdPercent);
  const claimEpoch = task.claimEpoch + 1;
  const events = [];
  const files = [];
  let armed = null;
  if (decision.arm) {
    armed = makeCheckpoint({ cwd: ctx.cwd, args, tasks, task, epoch: claimEpoch });
    events.push(armed.event);
    files.push(armed.file);
  }
  events.push(
    newEvent('task_claimed', {
      taskId: task.id,
      owner,
      claimEpoch,
      measurement: { ...measurement, decision },
    }),
  );
  try {
    append({
      repo,
      tasks,
      events,
      files,
      message: `task: reivindica ${task.id} por ${owner}`,
    });
  } finally {
    armed?.cleanup();
  }
  return { task, owner, claimEpoch, measurement, decision, checkpoint: armed?.event.checkpoint || null };
}

function findActive(board, args) {
  if (args.taskId) return board.tasks[args.taskId];
  const active = Object.values(board.tasks).filter(
    (task) => task.status === 'active' && (!args.owner || task.owner === args.owner),
  );
  if (active.length !== 1) {
    throw new Error('Informe --task-id; não há exatamente uma tarefa ativa compatível.');
  }
  return active[0];
}

function arm(args, ctx, repo, tasks) {
  const board = currentBoard(repo, tasks.project);
  const task = findActive(board, args);
  if (!task || task.status !== 'active') throw new Error('Tarefa ativa não encontrada.');
  const owner = required(args.owner, '--owner');
  const claimEpoch = integer(args.claimEpoch, '--claim-epoch');
  if (task.owner !== owner || task.claimEpoch !== claimEpoch) {
    throw new Error('Responsável ou época de claim divergente.');
  }
  const epoch = (task.checkpoint?.epoch || 0) + 1;
  const armed = makeCheckpoint({ cwd: ctx.cwd, args, tasks, task, epoch });
  try {
    append({
      repo,
      tasks,
      events: [armed.event],
      files: [armed.file],
      message: `task: arma checkpoint ${task.id}/${epoch}`,
    });
  } finally {
    armed.cleanup();
  }
  return { taskId: task.id, checkpoint: armed.event.checkpoint };
}

function resumable(board) {
  return Object.values(board.tasks)
    .filter((task) => task.status === 'active' && task.checkpoint)
    .map((task) => ({
      id: task.id,
      title: task.title,
      owner: task.owner,
      claimEpoch: task.claimEpoch,
      checkpoint: task.checkpoint,
      objective: task.objective,
      doneWhen: task.doneWhen,
    }));
}

function resume(args, ctx, repo, tasks) {
  const board = currentBoard(repo, tasks.project);
  if (!args.claim) return { resumable: resumable(board) };
  const task = board.tasks[args.claim];
  if (!task || task.status !== 'active' || !task.checkpoint) {
    throw new Error(`Tarefa ${args.claim} não pode ser retomada.`);
  }
  const owner = required(args.owner, '--owner');
  const claimEpoch = task.claimEpoch + 1;
  const checkpointPath = path.join(repo, task.checkpoint.path);
  const destination = path.resolve(
    args.destination || path.join(path.dirname(ctx.cwd), `${task.id}-resume-${claimEpoch}`),
  );
  const branch = `task/${task.id}-resume-${claimEpoch}`;
  const restored = restoreCheckpoint({
    cwd: ctx.cwd,
    checkpointPath,
    destination,
    branch,
    key: loadCheckpointKey({ keyEnv: tasks.keyEnv, keyFile: tasks.keyFile }),
  });
  try {
    append({
      repo,
      tasks,
      events: [
        newEvent('task_claimed', {
          taskId: task.id,
          owner,
          claimEpoch,
          measurement: null,
        }),
      ],
      message: `task: transfere ${task.id} para ${owner}`,
    });
    return { taskId: task.id, owner, claimEpoch, ...restored };
  } catch (error) {
    execFileSync('git', ['worktree', 'remove', '--force', destination], {
      cwd: ctx.cwd,
      stdio: 'ignore',
    });
    execFileSync('git', ['branch', '-D', branch], { cwd: ctx.cwd, stdio: 'ignore' });
    throw error;
  }
}

function head(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function isClean(cwd) {
  return !execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
}

function isAncestor(cwd, sha, ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, ref], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function mergeBase(cwd, sha, ref) {
  try {
    return execFileSync('git', ['merge-base', sha, ref], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function finish(args, ctx, repo, tasks) {
  const board = currentBoard(repo, tasks.project);
  const taskId = required(args.taskId, '--task-id');
  const task = board.tasks[taskId];
  if (!task) throw new Error(`Tarefa inexistente: ${taskId}.`);
  if (args.integrated) {
    if (task.status !== 'ready') throw new Error('Somente tarefa ready pode virar done.');
    const ref = ctx.config.git?.mainRef || 'main';
    if (!isAncestor(ctx.cwd, task.candidateCommit, ref) && !isAncestor(ctx.cwd, task.candidateCommit, `origin/${ref}`)) {
      throw new Error(`O commit candidato não está integrado em ${ref}.`);
    }
    append({
      repo,
      tasks,
      events: [newEvent('task_done', { taskId: task.id })],
      message: `task: conclui ${task.id}`,
    });
    return { taskId: task.id, status: 'done', candidateCommit: task.candidateCommit };
  }
  const owner = required(args.owner, '--owner');
  const claimEpoch = integer(args.claimEpoch, '--claim-epoch');
  if (!isClean(ctx.cwd)) throw new Error('A árvore precisa estar limpa antes de task finish.');
  const candidateCommit = head(ctx.cwd);
  if (task.status === 'active' && task.owner !== owner) {
    const claim = task.claims.find(
      (item) => item.owner === owner && item.claimEpoch === claimEpoch,
    );
    if (!claim || claimEpoch >= task.claimEpoch) {
      throw new Error('O resultado não corresponde a um claim anterior desta tarefa.');
    }
    const ref = ctx.config.git?.mainRef || 'main';
    const base = mergeBase(ctx.cwd, candidateCommit, ref) ||
      mergeBase(ctx.cwd, candidateCommit, `origin/${ref}`);
    append({
      repo,
      tasks,
      events: [
        newEvent('task_alternate_candidate', {
          taskId: task.id,
          owner,
          claimEpoch,
          candidateCommit,
          mergeBase: base,
        }),
      ],
      message: `task: registra candidato alternativo ${task.id}/${claimEpoch}`,
    });
    return {
      taskId: task.id,
      status: 'alternate',
      owner,
      claimEpoch,
      candidateCommit,
      mergeBase: base,
    };
  }
  if (
    task.status !== 'active' ||
    task.owner !== owner ||
    task.claimEpoch !== claimEpoch
  ) {
    throw new Error('Somente o responsável atual pode marcar a tarefa como ready.');
  }
  append({
    repo,
    tasks,
    events: [
      newEvent('task_ready', {
        taskId: task.id,
        owner,
        claimEpoch,
        candidateCommit,
      }),
    ],
    message: `task: deixa ${task.id} pronta`,
  });
  return { taskId: task.id, status: 'ready', candidateCommit };
}

export async function run(args, ctx) {
  const action = args._[0];
  if (!ACTIONS.has(action)) {
    console.error('Use vibecora-handoff task list|propose|approve|next|arm|resume|finish.');
    return 2;
  }
  try {
    const tasks = taskConfig(ctx.config);
    const repo = syncLedger(tasks);
    let result;
    if (action === 'list') result = boardView(currentBoard(repo, tasks.project));
    else if (action === 'propose') result = propose(args, repo, tasks);
    else if (action === 'approve') result = approve(args, repo, tasks);
    else if (action === 'next') result = nextTask(args, ctx, repo, tasks);
    else if (action === 'arm') result = arm(args, ctx, repo, tasks);
    else if (action === 'resume') result = resume(args, ctx, repo, tasks);
    else result = finish(args, ctx, repo, tasks);

    print(action === 'list' && !args.json ? formatList(currentBoard(repo, tasks.project)) : result, args.json);
    return 0;
  } catch (error) {
    console.error(error.message);
    return error.name === 'LedgerConflictError' ? 1 : 2;
  }
}
