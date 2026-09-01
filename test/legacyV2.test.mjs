import assert from 'node:assert/strict';
import test from 'node:test';

import { detectVersion, summarizeV2 } from '../src/legacyV2.mjs';

test('detectVersion', () => {
  assert.equal(detectVersion({ version: 3 }), 3);
  assert.equal(detectVersion({ version: 2 }), 2);
  assert.equal(detectVersion({ version: 1 }), null);
  assert.equal(detectVersion(null), null);
  assert.equal(detectVersion('x'), null);
});

test('summarizeV2 extrai campos do formato antigo, marca como histórico', () => {
  const s = summarizeV2({
    version: 2,
    run_id: 'old-1',
    timestamp: '2026-08-30T12:00:00Z',
    commit: 'abc1234',
    lifecycle: { code_state: 'merged_main', production_state: 'verified' },
    task: 'coisa antiga',
  });
  assert.equal(s.version, 2);
  assert.equal(s.code_state, 'merged_main');
  assert.equal(s.production_state, 'verified');
  assert.match(s.note, /histórico/);
});
