import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  boardProjection,
  reduceTaskEvents,
  renderBoardMarkdown,
} from './reducer.mjs';

export class LedgerConflictError extends Error {
  constructor(message = 'Outro agente alterou o ledger antes deste claim.') {
    super(message);
    this.name = 'LedgerConflictError';
  }
}

function git(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      killSignal: 'SIGKILL',
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.toString().trim();
    throw new Error(detail || `git ${args.join(' ')} falhou.`);
  }
}

function safeSegment(value, label) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value || '')) {
    throw new Error(`${label} inválido: ${value || 'ausente'}.`);
  }
  return value;
}

function cacheKey(ledger) {
  return crypto.createHash('sha256').update(ledger).digest('hex').slice(0, 16);
}

export function projectPaths(repo, project) {
  const root = path.join(repo, 'projects', safeSegment(project, 'project'));
  return {
    root,
    events: path.join(root, 'events.jsonl'),
    board: path.join(root, 'board.json'),
    markdown: path.join(root, 'BOARD.md'),
    checkpoints: path.join(root, 'checkpoints'),
  };
}

export function readEvents(repo, project) {
  const file = projectPaths(repo, project).events;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: JSON inválido (${error.message}).`);
      }
    });
}

export function writeProjection(repo, project, events) {
  const paths = projectPaths(repo, project);
  const board = reduceTaskEvents(events, { project });
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(paths.events, `${events.map((event) => JSON.stringify(event)).join('\n')}${events.length ? '\n' : ''}`);
  fs.writeFileSync(paths.board, `${JSON.stringify(boardProjection(board), null, 2)}\n`);
  fs.writeFileSync(paths.markdown, renderBoardMarkdown(board));
  return board;
}

export function ledgerCacheDir(tasksConfig) {
  if (tasksConfig.cacheDir) return path.resolve(tasksConfig.cacheDir);
  const root = process.env.VIBE_CORA_TASK_CACHE || path.join(os.tmpdir(), 'vibecora-agent-handoff');
  return path.join(root, cacheKey(tasksConfig.ledger));
}

export function syncLedger(tasksConfig) {
  if (!tasksConfig.ledger) throw new Error('tasks.ledger não configurado.');
  const branch = tasksConfig.branch || 'main';
  const cache = ledgerCacheDir(tasksConfig);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  // The configured cache is a namespace, never a mutable shared checkout.
  // Keep the string-returning API; direct callers own this directory's lifetime.
  const repo = fs.mkdtempSync(`${cache}.operation-`);
  try {
    git(['clone', '--branch', branch, '--single-branch', tasksConfig.ledger, repo], {
      cwd: path.dirname(repo),
    });
    git(['config', 'user.name', tasksConfig.gitUserName || 'vibecora-task-system'], {
      cwd: repo,
    });
    git(
      ['config', 'user.email', tasksConfig.gitUserEmail || 'tasks@vibecora.invalid'],
      { cwd: repo },
    );
    return repo;
  } catch (error) {
    cleanupSnapshot(repo);
    throw error;
  }
}

function cleanupSnapshot(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch (error) {
    // Cleanup must not turn a confirmed push into an apparent failed claim.
    console.error(`Aviso: snapshot não removido (${repo}): ${error.message}`);
  }
}

export async function withLedger(tasksConfig, operation) {
  const repo = syncLedger(tasksConfig);
  try {
    return await operation(repo);
  } finally {
    cleanupSnapshot(repo);
  }
}

export function newEvent(type, fields = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    ...fields,
  };
}

export function appendEventsAndPush({
  repo,
  project,
  events,
  files = [],
  message,
  branch = 'main',
}) {
  const previous = readEvents(repo, project);
  const all = [...previous, ...events];
  const board = writeProjection(repo, project, all);
  for (const file of files) {
    const destination = path.join(repo, file.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.sourcePath, destination);
  }
  const paths = projectPaths(repo, project);
  git(['add', paths.root], { cwd: repo });
  git(['commit', '-m', message], { cwd: repo });
  const commit = git(['rev-parse', 'HEAD'], { cwd: repo });
  const pushed = git(['push', 'origin', `${commit}:refs/heads/${branch}`], {
    cwd: repo,
    allowFailure: true,
  });
  if (pushed === null) {
    throw new LedgerConflictError(
      `Push não confirmado para ${commit}; possível conflito ou falha de transporte. Consulte o ledger antes de repetir.`,
    );
  }
  return board;
}

export function currentBoard(repo, project) {
  return reduceTaskEvents(readEvents(repo, project), { project });
}

export function relativeCheckpointPath(project, taskId, epoch) {
  safeSegment(project, 'project');
  safeSegment(taskId, 'task id');
  if (!Number.isInteger(epoch) || epoch < 1) throw new Error('Época inválida.');
  return path.posix.join(
    'projects',
    project,
    'checkpoints',
    taskId,
    `${epoch}.enc`,
  );
}
