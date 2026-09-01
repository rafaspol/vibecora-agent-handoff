import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectQuave } from '../src/quave/adapter.mjs';

// CLI Quave simulada: um script que imprime JSON de status.
function fakeCli(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcli-'));
  const file = path.join(dir, 'quaveone');
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(json))});\n`,
  );
  fs.chmodSync(file, 0o755);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const config = { audit: { quave: {} } };

test('sem QUAVEONE_ENV_NAME => indisponível', () => {
  const r = collectQuave({ config, env: { QUAVEONE_ENV_TOKEN: 't' } });
  assert.equal(r.available, false);
  assert.match(r.reason, /QUAVEONE_ENV_NAME/);
});

test('sem token => indisponível', () => {
  const r = collectQuave({ config, env: { QUAVEONE_ENV_NAME: 'prod' } });
  assert.equal(r.available, false);
});

test('CLI simulada => normaliza status', () => {
  const cli = fakeCli({
    currentVersion: 57,
    currentContentId: 'c57',
    currentDeployment: { gitCommitId: 'abc1234def', status: 'DEPLOYED' },
    activityStatus: 'RUNNING',
  });
  const r = collectQuave({
    config,
    env: { QUAVEONE_ENV_NAME: 'prod', QUAVEONE_ENV_TOKEN: 't', QUAVEONE_CLI: cli.file },
  });
  assert.equal(r.available, true);
  assert.equal(r.version, 57);
  assert.equal(r.contentId, 'c57');
  assert.equal(r.gitCommitId, 'abc1234def');
  assert.equal(r.deploymentStatus, 'DEPLOYED');
  cli.cleanup();
});

test('CLI que falha => indisponível com motivo, sem vazar token', () => {
  const r = collectQuave({
    config,
    env: {
      QUAVEONE_ENV_NAME: 'prod',
      QUAVEONE_ENV_TOKEN: 'super-secret-token',
      QUAVEONE_CLI: '/nao/existe/quaveone',
    },
  });
  assert.equal(r.available, false);
  assert.ok(!JSON.stringify(r).includes('super-secret-token'));
});
