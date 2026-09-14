import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readMeasurement, resourceDecision } from '../src/tasks/measurements.mjs';

test('21% não arma; 20% arma', () => {
  const base = {
    contextRemainingPercent: null,
    measuredAt: '2026-09-13T00:00:00Z',
    source: 'test',
  };
  assert.equal(resourceDecision({ ...base, quotaRemainingPercent: 21 }).arm, false);
  assert.equal(resourceDecision({ ...base, quotaRemainingPercent: 20 }).arm, true);
});

test('unknown permanece desconhecido e não é estimado', () => {
  const decision = resourceDecision({
    quotaRemainingPercent: null,
    contextRemainingPercent: null,
  });
  assert.equal(decision.arm, false);
  assert.deepEqual(decision.unknown, ['quota', 'context']);
});

test('medição é reutilizada por quinze minutos', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-measurement-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const now = Date.parse('2026-09-13T00:00:00Z');
  const first = readMeasurement({
    args: { quotaRemaining: '42', measurementSource: 'test' },
    ledgerRepo: repo,
    project: 'p',
    now,
  });
  const cached = readMeasurement({
    args: {},
    ledgerRepo: repo,
    project: 'p',
    now: now + 14 * 60_000,
  });
  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(cached.quotaRemainingPercent, 42);
  fs.rmSync(repo, { recursive: true, force: true });
});
