const TYPE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function present(value) {
  return value != null && String(value).trim() !== '';
}

export function normalizeAgentIdentity(value) {
  const type = String(value?.type || '').trim().toLowerCase();
  const id = String(value?.id || '').trim();
  if (!TYPE_PATTERN.test(type)) {
    throw new Error('Tipo de agente inválido ou ausente.');
  }
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error('Identificador de agente inválido ou ausente.');
  }
  return { type, id };
}

function pair(type, id, source) {
  if (present(type) !== present(id)) {
    throw new Error(`${source} exige tipo e identificador do agente juntos.`);
  }
  return present(type) ? normalizeAgentIdentity({ type, id }) : null;
}

export function resolveAgentIdentity(args = {}, env = process.env) {
  if (present(args.owner)) {
    throw new Error(
      '--owner foi substituído por --agent-type e --agent-id.',
    );
  }
  const explicit = pair(args.agentType, args.agentId, '--agent-type/--agent-id');
  if (explicit) return explicit;

  const standard = pair(
    env.VIBECORA_AGENT_TYPE,
    env.VIBECORA_AGENT_ID,
    'VIBECORA_AGENT_TYPE/VIBECORA_AGENT_ID',
  );
  if (standard) return standard;

  if (present(env.CODEX_THREAD_ID)) {
    return normalizeAgentIdentity({ type: 'codex', id: env.CODEX_THREAD_ID });
  }
  throw new Error(
    'Identidade do agente indisponível; informe --agent-type e --agent-id.',
  );
}

export function sameAgent(left, right) {
  return Boolean(
    left &&
      right &&
      left.type === right.type &&
      left.id === right.id,
  );
}

export function agentRef(agent) {
  const normalized = normalizeAgentIdentity(agent);
  return `${normalized.type}:${normalized.id}`;
}

export function shortAgentRef(agent) {
  if (!agent) return 'agente desconhecido';
  const normalized = normalizeAgentIdentity(agent);
  const shortId = normalized.id.length > 8
    ? normalized.id.slice(0, 8)
    : normalized.id;
  return `${normalized.type}:${shortId}`;
}
