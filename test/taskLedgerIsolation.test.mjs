import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

import { syncLedger, withLedger } from '../src/tasks/ledger.mjs';

const ledgerModule = new URL('../src/tasks/ledger.mjs', import.meta.url).href;
const workerSource = `
  import fs from 'node:fs';
  import path from 'node:path';
  import { once } from 'node:events';
  import { execFileSync } from 'node:child_process';
  import { withLedger, newEvent, appendEventsAndPush, readEvents } from ${JSON.stringify(ledgerModule)};
  const config = JSON.parse(process.env.TEST_LEDGER_CONFIG);
  try {
    const result = await withLedger(config, async repo => {
      const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      const release = once(process, 'message');
      process.send({ type: 'ready', repo, revision });
      const [command] = await release;
      if (command.action === 'fail') throw new Error('callback failed');
      if (command.action === 'read') {
        return { events: readEvents(repo, 'p'), checkpoint: fs.readFileSync(path.join(repo, 'projects/p/checkpoints/snapshot.enc'), 'utf8') };
      }
      const id = command.id;
      const event = newEvent('task_drafted', {
        agent: { type: 'codex', id },
        task: { id, title: id, objective: id, doneWhen: id, dependencies: [], suggestedRank: 1 },
        proposal: { id: 'proposal-' + id, kind: 'add', taskId: id, suggestedRank: 1, reason: 'test' },
      });
      const sourcePath = path.join(repo, 'payload');
      fs.writeFileSync(sourcePath, id);
      appendEventsAndPush({ repo, project: 'p', events: [event], message: id,
        files: [{ sourcePath, relativePath: 'projects/p/checkpoints/snapshot.enc' }] });
      return { event };
    });
    process.send({ type: 'done', result });
  } catch (error) {
    process.send({ type: 'done', error: error.message, name: error.name });
  } finally {
    process.disconnect();
  }
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  git(root, 'init', '--bare', '-b', 'main', ledger);
  fs.mkdirSync(seed);
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.name', 'test');
  git(seed, 'config', 'user.email', 'test@example.invalid');
  fs.mkdirSync(path.join(seed, 'projects/p/checkpoints'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'projects/p/checkpoints/snapshot.enc'), 'initial');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', ledger);
  git(seed, 'push', 'origin', 'main');
  return { root, ledger, cacheDir: path.join(root, 'cache') };
}

function worker(t, config) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerSource], {
    env: { ...process.env, TEST_LEDGER_CONFIG: JSON.stringify(config) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const messages = new Map();
  const waiting = new Map();
  child.on('message', message => {
    messages.set(message.type, message);
    waiting.get(message.type)?.resolve(message);
  });
  child.on('exit', code => {
    for (const [type, waiter] of waiting) {
      if (!messages.has(type)) waiter.reject(new Error(`Worker exited ${code}: ${stderr}`));
    }
  });
  return {
    child,
    message(type) {
      if (messages.has(type)) return Promise.resolve(messages.get(type));
      return new Promise((resolve, reject) => waiting.set(type, { resolve, reject }));
    },
    release(command) { child.send(command); return this.message('done'); },
  };
}

for (const shared of [true, false]) {
  test(`multiprocess writer/writer and reader/writer (${shared ? 'same' : 'distinct'} cache)`, { timeout: 30_000 }, async t => {
    const config = fixture(t);
    // Existing caller-owned cache content must never be reused or erased.
    fs.mkdirSync(config.cacheDir);
    fs.writeFileSync(path.join(config.cacheDir, 'keep'), 'caller data');
    const a = worker(t, config);
    const b = worker(t, { ...config, cacheDir: shared ? config.cacheDir : path.join(config.root, 'other') });
    const reader = worker(t, { ...config, cacheDir: shared ? config.cacheDir : path.join(config.root, 'reader') });
    const snapshots = await Promise.all([a.message('ready'), b.message('ready'), reader.message('ready')]);
    assert.equal(new Set(snapshots.map(item => item.repo)).size, 3);
    assert.equal(new Set(snapshots.map(item => item.revision)).size, 1);
    const outcomes = await Promise.all([
      a.release({ action: 'write', id: 'writer-a' }),
      b.release({ action: 'write', id: 'writer-b' }),
    ]);
    const winner = outcomes.find(item => !item.error);
    assert.equal(outcomes.filter(item => !item.error).length, 1);
    assert.equal(outcomes.find(item => item.error).name, 'LedgerConflictError');
    const read = await reader.release({ action: 'read' });
    assert.deepEqual(read.result, { events: [], checkpoint: 'initial' });
    const confirmed = JSON.parse(git(config.root, '--git-dir', config.ledger, 'show', 'main:projects/p/events.jsonl'));
    assert.deepEqual(confirmed, winner.result.event);
    assert.equal(git(config.root, '--git-dir', config.ledger, 'show', 'main:projects/p/checkpoints/snapshot.enc'), confirmed.task.id);
    for (const snapshot of snapshots) assert.equal(fs.existsSync(snapshot.repo), false);
    assert.equal(fs.readFileSync(path.join(config.cacheDir, 'keep'), 'utf8'), 'caller data');
  });
}

test('multiprocess initial clones, callback failure, rejection and interrupted orphan', { timeout: 30_000 }, async t => {
  const config = fixture(t);
  const a = worker(t, config);
  const b = worker(t, config);
  const [first, second] = await Promise.all([a.message('ready'), b.message('ready')]);
  assert.notEqual(first.repo, second.repo);
  assert.equal(fs.existsSync(config.cacheDir), false);
  const failed = await a.release({ action: 'fail' });
  assert.match(failed.error, /callback failed/);
  assert.equal(fs.existsSync(first.repo), false);
  const survivor = worker(t, config);
  const survivorSnapshot = await survivor.message('ready');
  const exited = once(b.child, 'exit');
  b.child.kill('SIGKILL');
  await exited;
  assert.equal(fs.existsSync(second.repo), true);
  assert.equal((await survivor.release({ action: 'read' })).result.checkpoint, 'initial');
  assert.equal(fs.existsSync(survivorSnapshot.repo), false);
  const next = worker(t, config);
  const nextSnapshot = await next.message('ready');
  assert.notEqual(nextSnapshot.repo, second.repo);
  assert.equal((await next.release({ action: 'read' })).result.checkpoint, 'initial');
  assert.equal(fs.existsSync(nextSnapshot.repo), false);
  // Explicit server rejection must never return a successful confirmation.
  fs.writeFileSync(path.join(config.ledger, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const rejected = worker(t, config);
  const rejectedSnapshot = await rejected.message('ready');
  assert.equal((await rejected.release({ action: 'write', id: 'rejected' })).name, 'LedgerConflictError');
  assert.equal(fs.existsSync(rejectedSnapshot.repo), false);
  assert.equal(git(config.root, '--git-dir', config.ledger, 'log', '--format=%s', 'main'), 'seed');
});

test('syncLedger remains synchronous/string-returning; failed clone and async lifecycle clean up', async t => {
  const config = fixture(t);
  const repo = syncLedger(config);
  assert.equal(typeof repo, 'string');
  fs.rmSync(repo, { recursive: true, force: true });
  assert.throws(() => syncLedger({ ...config, branch: 'missing' }));
  assert.equal(fs.readdirSync(config.root).some(name => name.startsWith('cache.operation-')), false);
  let snapshot;
  await assert.rejects(withLedger(config, async repo => {
    snapshot = repo;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fs.existsSync(repo), true);
    throw new Error('async failure');
  }), /async failure/);
  assert.equal(fs.existsSync(snapshot), false);
});

test('cleanup failure warns without replacing a successful operation result', async t => {
  const config = fixture(t);
  const remove = fs.rmSync;
  const log = console.error;
  const warnings = [];
  let snapshot;
  try {
    console.error = message => warnings.push(message);
    const result = await withLedger(config, async repo => {
      snapshot = repo;
      fs.rmSync = (target, options) => {
        if (target === repo) throw new Error('cleanup denied');
        return remove(target, options);
      };
      return { confirmed: true };
    });
    assert.deepEqual(result, { confirmed: true });
    assert.match(warnings[0], /cleanup denied/);
    assert.ok(warnings[0].includes(snapshot));
  } finally {
    fs.rmSync = remove;
    console.error = log;
  }
});