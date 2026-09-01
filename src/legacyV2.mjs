// Leitura do handoff v2 apenas como histórico. Não valida, não converte — só
// permite inspecionar um retrato antigo. Fechamentos novos usam v3.

export function detectVersion(handoff) {
  if (handoff && typeof handoff === 'object') {
    if (handoff.version === 3) return 3;
    if (handoff.version === 2) return 2;
  }
  return null;
}

export function summarizeV2(handoff) {
  return {
    version: 2,
    run_id: handoff.run_id ?? null,
    timestamp: handoff.timestamp ?? null,
    commit: handoff.commit ?? null,
    code_state: handoff.lifecycle?.code_state ?? null,
    production_state: handoff.lifecycle?.production_state ?? null,
    task: handoff.task ?? null,
    note: 'Retrato v2 — lido apenas como histórico. Regenere em v3 para fechar.',
  };
}
