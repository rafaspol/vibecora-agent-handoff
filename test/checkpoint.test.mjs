import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureCheckpoint,
  isCredentialPath,
  restoreCheckpoint,
} from '../src/tasks/checkpoint.mjs';
import { tmpRepoWithRemote } from './helpers.mjs';

test('classificação de credencial preserva apenas o exemplo público', () => {
  assert.equal(isCredentialPath('.env'), true);
  assert.equal(isCredentialPath('.env.local'), true);
  assert.equal(isCredentialPath('keys/private.pem'), true);
  assert.equal(isCredentialPath('.env.example'), false);
});

test('checkpoint restaura commits, índice, working tree, binário, modo e symlink', () => {
  const repo = tmpRepoWithRemote();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-checkpoint-test-'));
  const encrypted = path.join(root, 'checkpoint.enc');
  const destination = path.join(root, 'restored');
  const key = crypto.randomBytes(32);

  repo.write('app.txt', 'commit não publicado\n');
  repo.write('bin/run.sh', '#!/bin/sh\necho ok\n');
  fs.chmodSync(path.join(repo.dir, 'bin/run.sh'), 0o750);
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'unpublished');

  repo.write('asset.bin', Buffer.from([0, 255, 1, 128]));
  repo.git('add', 'asset.bin');
  repo.write('asset.bin', Buffer.from([0, 255, 2, 128]));
  repo.write('notes/next.txt', 'retomar daqui\n');
  fs.symlinkSync('../app.txt', path.join(repo.dir, 'notes/app-link'));

  const captured = captureCheckpoint({
    cwd: repo.dir,
    outputPath: encrypted,
    key,
  });
  assert.equal(captured.unpublishedCommits, 1);

  const restored = restoreCheckpoint({
    cwd: repo.dir,
    checkpointPath: encrypted,
    destination,
    branch: 'task/recovered',
    key,
  });
  assert.equal(restored.manifest.headSha, repo.git('rev-parse', 'HEAD'));
  assert.equal(
    repo.git('status', '--short'),
    repo.git('-C', destination, 'status', '--short'),
  );
  assert.deepEqual(fs.readFileSync(path.join(destination, 'asset.bin')), Buffer.from([0, 255, 2, 128]));
  assert.equal(fs.lstatSync(path.join(destination, 'bin/run.sh')).mode & 0o777, 0o750);
  assert.equal(fs.readlinkSync(path.join(destination, 'notes/app-link')), '../app.txt');

  repo.git('worktree', 'remove', '--force', destination);
  repo.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

test('chave incorreta e adulteração são recusadas', () => {
  const repo = tmpRepoWithRemote();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-checkpoint-auth-'));
  const encrypted = path.join(root, 'checkpoint.enc');
  const key = crypto.randomBytes(32);
  captureCheckpoint({ cwd: repo.dir, outputPath: encrypted, key });

  assert.throws(
    () =>
      restoreCheckpoint({
        cwd: repo.dir,
        checkpointPath: encrypted,
        destination: path.join(root, 'wrong'),
        branch: 'task/wrong',
        key: crypto.randomBytes(32),
      }),
  );
  const tampered = fs.readFileSync(encrypted);
  tampered[tampered.length - 1] ^= 1;
  fs.writeFileSync(encrypted, tampered);
  assert.throws(
    () =>
      restoreCheckpoint({
        cwd: repo.dir,
        checkpointPath: encrypted,
        destination: path.join(root, 'tampered'),
        branch: 'task/tampered',
        key,
      }),
  );
  repo.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

test('credencial e artefato acima do teto são recusados', () => {
  const repo = tmpRepoWithRemote();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-checkpoint-limit-'));
  const key = crypto.randomBytes(32);
  repo.write('.env.local', 'SECRET=value\n');
  assert.throws(
    () =>
      captureCheckpoint({
        cwd: repo.dir,
        outputPath: path.join(root, 'secret.enc'),
        key,
      }),
    /credencial/,
  );
  fs.rmSync(path.join(repo.dir, '.env.local'));
  assert.throws(
    () =>
      captureCheckpoint({
        cwd: repo.dir,
        outputPath: path.join(root, 'large.enc'),
        key,
        maxBytes: 1,
      }),
    /excede o teto/,
  );
  repo.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});
