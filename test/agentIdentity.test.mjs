import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentRef,
  resolveAgentIdentity,
  sameAgent,
  shortAgentRef,
} from '../src/tasks/agentIdentity.mjs';

test('flags vencem ambiente e preservam tipo mais instância', () => {
  const identity = resolveAgentIdentity(
    { agentType: 'Claude', agentId: 'run-explicito' },
    {
      VIBECORA_AGENT_TYPE: 'outro',
      VIBECORA_AGENT_ID: 'ambiente',
      CODEX_THREAD_ID: 'codex-thread',
    },
  );
  assert.deepEqual(identity, { type: 'claude', id: 'run-explicito' });
});

test('ambiente padrão vence detecção específica do Codex', () => {
  const identity = resolveAgentIdentity({}, {
    VIBECORA_AGENT_TYPE: 'replit',
    VIBECORA_AGENT_ID: 'agent-7',
    CODEX_THREAD_ID: 'codex-thread',
  });
  assert.deepEqual(identity, { type: 'replit', id: 'agent-7' });
});

test('CODEX_THREAD_ID identifica automaticamente a instância', () => {
  assert.deepEqual(resolveAgentIdentity({}, { CODEX_THREAD_ID: 'thread-123' }), {
    type: 'codex',
    id: 'thread-123',
  });
});

test('identidade incompleta ou ausente é recusada', () => {
  assert.throws(
    () => resolveAgentIdentity({ agentType: 'codex' }, {}),
    /tipo e identificador.*juntos/,
  );
  assert.throws(
    () => resolveAgentIdentity({}, {}),
    /Identidade do agente indisponível/,
  );
  assert.throws(
    () => resolveAgentIdentity({ owner: 'agent-a' }, { CODEX_THREAD_ID: 'x' }),
    /--owner foi substituído/,
  );
});

test('comparação usa a identidade completa e a forma humana é curta', () => {
  const agent = { type: 'codex', id: '01a09952-d287-7423-9fe3-da12d7c87e84' };
  assert.equal(sameAgent(agent, { ...agent }), true);
  assert.equal(sameAgent(agent, { type: 'codex', id: 'outra' }), false);
  assert.equal(agentRef(agent), 'codex:01a09952-d287-7423-9fe3-da12d7c87e84');
  assert.equal(shortAgentRef(agent), 'codex:01a09952');
});
