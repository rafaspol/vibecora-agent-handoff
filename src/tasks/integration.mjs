import { execFileSync } from 'node:child_process';
import { validateCandidate, validateRepository } from './candidate.mjs';

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
  }).trim();
}
function sha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Informe SHA completo de commit.');
}
function tip(cwd, ref) {
  try { return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]); }
  catch { return null; }
}
function ancestor(cwd, commit, mainTip) {
  try { git(cwd, ['merge-base', '--is-ancestor', commit, mainTip]); return true; }
  catch { return false; }
}

function patchHash(cwd, commit, strict) {
  const parents = git(cwd, ['rev-list', '--parents', '-n', '1', commit]).split(' ');
  if (parents.length !== 2) {
    if (strict) throw new Error('Equivalência exige commits normais com exatamente um pai; merges/root recusados.');
    return null;
  }
  const diff = git(cwd, ['-c', 'diff.algorithm=myers', '-c', 'diff.indentHeuristic=false',
    'diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index', '--no-renames',
    '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3',
    parents[1], commit, '--']);
  if (!diff) {
    if (strict) throw new Error('Equivalência não aceita diff vazio.');
    return null;
  }
  const hash = git(cwd, ['patch-id', '--stable'], `${diff}\n`).split(/\s/)[0];
  sha(hash);
  return hash;
}

export function validateIntegration(integration, candidateCommit) {
  if (!integration || !['ancestry', 'patch-equivalent'].includes(integration.mode)) {
    throw new Error('Metadados de integração inválidos.');
  }
  for (const value of [integration.candidateCommit, integration.integratedCommit, integration.mainTip]) sha(value);
  if (integration.candidateCommit !== candidateCommit ||
      !/^refs\/(?:heads|remotes)\/[a-z0-9/._-]+$/i.test(integration.mainRef) ||
      integration.mainRef.includes('..')) throw new Error('Identidade da integração divergente.');
  if (integration.patchHash !== null) sha(integration.patchHash);
  if (integration.mode === 'patch-equivalent' &&
      (!integration.patchHash || typeof integration.evidenceRef !== 'string' || !integration.evidenceRef.trim())) {
    throw new Error('Equivalência exige patch hash e referência de evidência.');
  }
  if (integration.mode === 'ancestry' && integration.integratedCommit !== candidateCommit) {
    throw new Error('Integração por ancestralidade exige o próprio candidato.');
  }
  return integration;
}

export function verifyIntegration({ cwd, task, project, mainBranch = 'main',
  mainRef, integratedCommit, evidenceRef }) {
  sha(task.candidateCommit);
  if (!/^[a-z0-9][a-z0-9/._-]*$/i.test(mainBranch) ||
      mainBranch.includes('..') || mainBranch.startsWith('refs/')) {
    throw new Error('git.mainRef precisa ser um nome de branch seguro, não SHA/ref arbitrária.');
  }
  if (task.candidate) validateCandidate(task.candidate, {
    project, taskId: task.id, commit: task.candidateCommit,
  });
  if (integratedCommit !== undefined) {
    sha(integratedCommit);
    if (typeof evidenceRef !== 'string' || !evidenceRef.trim() || /[\x00-\x1f]/.test(evidenceRef)) {
      throw new Error('--integration-evidence é obrigatório para equivalência explícita.');
    }
  }
  const remotes = git(cwd, ['remote']).split('\n').filter(Boolean);
  const matching = remotes.filter(remote => {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(remote)) return false;
    if (!task.candidate) return remote === 'origin';
    // A push-only URL cannot authenticate the source of a tracking ref.
    try {
      const url = git(cwd, ['remote', 'get-url', remote]);
      return validateRepository(url) === task.candidate.repository;
    } catch { return false; }
  });
  if (task.candidate && !matching.length) {
    throw new Error('Repositório local não possui remote correspondente ao candidato salvo.');
  }
  const allowed = [`refs/heads/${mainBranch}`,
    ...matching.map(remote => `refs/remotes/${remote}/${mainBranch}`)];
  if (mainRef && !allowed.includes(mainRef)) throw new Error('--integration-main-ref não corresponde ao main/repositório candidato.');
  const available = allowed.map(ref => ({ ref, tip: tip(cwd, ref) })).filter(item => item.tip);
  let selected;
  if (mainRef) selected = available.find(item => item.ref === mainRef);
  else {
    if (new Set(available.map(item => item.tip)).size > 1) {
      throw new Error('Main local/remoto divergem; escolha --integration-main-ref refs/heads/<main> ou refs/remotes/<remote>/<main>.');
    }
    selected = available[0];
  }
  if (!selected) throw new Error('Ref main escolhida não existe localmente; atualize-a explicitamente antes de verificar.');
  const target = integratedCommit || task.candidateCommit;
  if (!ancestor(cwd, target, selected.tip)) throw new Error('Commit integrado não é ancestral do main escolhido.');
  const equivalent = integratedCommit !== undefined;
  const hash = patchHash(cwd, task.candidateCommit, equivalent);
  if (equivalent && hash !== patchHash(cwd, target, true)) {
    throw new Error('Patches do candidato e commit integrado não são equivalentes.');
  }
  return validateIntegration({
    candidateCommit: task.candidateCommit, integratedCommit: target,
    mode: equivalent ? 'patch-equivalent' : 'ancestry',
    mainRef: selected.ref, mainTip: selected.tip, patchHash: hash,
    evidenceRef: evidenceRef || null,
  }, task.candidateCommit);
}