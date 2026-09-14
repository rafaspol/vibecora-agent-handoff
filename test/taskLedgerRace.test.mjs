import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import {
  appendEventsAndPush,
  currentBoard,
  LedgerConflictError,
  newEvent,
  syncLedger,
  writeProjection,
} from '../src/tasks/ledger.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('push fast-forward dá um único vencedor a claims concorrentes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-ledger-race-'));
  const bare = path.join(root, 'ledger.git');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.name', 'test');
  git(seed, 'config', 'user.email', 'test@test.invalid');
  const drafted = newEvent('task_drafted', {
    task: {
      id: 'task-a',
      title: 'A',
      objective: 'A',
      doneWhen: 'A pronta',
      dependencies: [],
      suggestedRank: 1,
      roadmapRef: null,
    },
    proposal: {
      id: 'proposal-a',
      kind: 'add',
      taskId: 'task-a',
      suggestedRank: 1,
      reason: 'teste',
    },
  });
  const approved = newEvent('proposal_approved', {
    proposalId: 'proposal-a',
    approvedBy: '@rafaspol',
    approvalRef: 'thread:test',
  });
  fs.writeFileSync(path.join(seed, 'schema-version'), '1\n');
  writeProjection(seed, 'p', [drafted, approved]);
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-u', 'origin', 'main');

  const a = syncLedger({ ledger: bare, branch: 'main', cacheDir: path.join(root, 'a') });
  const b = syncLedger({ ledger: bare, branch: 'main', cacheDir: path.join(root, 'b') });
  const claimA = newEvent('task_claimed', {
    taskId: 'task-a',
    owner: 'agent-a',
    claimEpoch: 1,
  });
  const claimB = newEvent('task_claimed', {
    taskId: 'task-a',
    owner: 'agent-b',
    claimEpoch: 1,
  });
  appendEventsAndPush({
    repo: a,
    project: 'p',
    events: [claimA],
    message: 'claim a',
  });
  assert.throws(
    () =>
      appendEventsAndPush({
        repo: b,
        project: 'p',
        events: [claimB],
        message: 'claim b',
      }),
    LedgerConflictError,
  );
  const refreshed = syncLedger({
    ledger: bare,
    branch: 'main',
    cacheDir: path.join(root, 'verify'),
  });
  const board = currentBoard(refreshed, 'p');
  assert.equal(board.tasks['task-a'].owner, 'agent-a');
  assert.equal(board.tasks['task-a'].claimEpoch, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
