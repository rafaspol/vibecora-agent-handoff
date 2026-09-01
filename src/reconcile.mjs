// Núcleo puro da reconciliação (comando `audit`). Sem I/O: recebe o retrato e
// as fontes já coletadas e devolve um relatório. Drift é relatório, não erro.

function shortSha(v) {
  return typeof v === 'string' ? v.trim().slice(0, 7) : null;
}

// `ancestry(snapshotSha, liveSha)` (opcional) → 'equal' | 'trailing' | 'other'
//   'trailing' = o snapshot é ancestral do live e o intervalo só tem commits
//   de classe não-runtime (commit-retrato à frente). Conta como alinhado.
function commitRow(field, source, snapshotSha, liveSha, ancestry) {
  if (!source || source.available === false) {
    return {
      field,
      source: source?.name || field,
      snapshot: shortSha(snapshotSha),
      live: null,
      match: null,
    };
  }
  const a = shortSha(snapshotSha);
  const b = shortSha(liveSha);
  let match = a != null && b != null ? a === b : null;
  let note;
  if (match === false && typeof ancestry === 'function') {
    const rel = ancestry(snapshotSha, liveSha);
    if (rel === 'trailing') {
      match = true;
      note = 'diferem só por commits não-runtime';
    }
  }
  const row = { field, source: source.name || field, snapshot: a, live: b, match };
  if (note) row.note = note;
  return row;
}

export function reconcile(snapshot, sources = {}, { ancestry } = {}) {
  const commit = snapshot?.code?.commit;
  const remoteGit = sources.remote_git;
  const ghActions = sources.gh_actions;
  const apiRelease = sources.api_release;
  const quave = sources.quave;

  const reconciliation = [
    commitRow(
      'commit',
      remoteGit && { ...remoteGit, name: 'remote_git' },
      commit,
      remoteGit?.mainCommit,
      ancestry,
    ),
    commitRow(
      'commit',
      apiRelease && { ...apiRelease, name: 'api_release' },
      commit,
      apiRelease?.commit,
      ancestry,
    ),
    commitRow(
      'commit',
      quave && { ...quave, name: 'quave' },
      commit,
      quave?.gitCommitId,
      ancestry,
    ),
  ];

  if (ghActions && ghActions.available !== false) {
    reconciliation.push({
      field: 'last_deploy',
      source: 'gh_actions',
      snapshot: null,
      live: `${ghActions.status ?? '?'}/${ghActions.conclusion ?? '?'}`,
      match:
        ghActions.conclusion == null ? null : ghActions.conclusion === 'success',
    });
  }

  const anyMismatch = reconciliation.some((r) => r.match === false);
  const anyChecked = reconciliation.some((r) => r.match !== null);

  return {
    snapshot: {
      run_id: snapshot?.run_id ?? null,
      recorded_at: snapshot?.recorded_at ?? null,
      branch: snapshot?.branch ?? null,
      commit: shortSha(commit),
      code_state: snapshot?.code?.state ?? null,
      release_intent: snapshot?.release_intent ?? null,
    },
    sources: {
      remote_git: remoteGit ?? { available: false, reason: 'not collected' },
      gh_actions: ghActions ?? { available: false, reason: 'not collected' },
      api_release: apiRelease ?? { available: false, reason: 'not collected' },
      quave: quave ?? { available: false, reason: 'not collected' },
    },
    reconciliation,
    verdict: !anyChecked ? 'unknown' : anyMismatch ? 'drift' : 'aligned',
  };
}
