import path from 'node:path';
import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function identity(value) {
  if (typeof value !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(value) ||
      value.includes('..')) throw new Error('Identidade de candidato inválida.');
}

// Store only credential-free, explicit endpoints, never a remote alias.
export function validateRepository(repository) {
  if (typeof repository !== 'string' || /[\s\\?#\x00-\x1f]/.test(repository)) {
    throw new Error('Repositório candidato inválido ou contém credenciais.');
  }
  if (path.isAbsolute(repository)) return repository;
  if (/^git@[a-z0-9.-]+:[a-z0-9/._-]+$/i.test(repository)) return repository;
  let url;
  try { url = new URL(repository); } catch { /* rejected below */ }
  if (!url || !['https:', 'ssh:'].includes(url.protocol) ||
      url.password || (url.username && !(url.protocol === 'ssh:' && url.username === 'git')) ||
      !url.hostname || !/^\/[a-z0-9/._~-]+$/i.test(url.pathname)) {
    throw new Error('Use um repositório explícito sem credenciais (HTTPS, SSH git ou caminho absoluto).');
  }
  return repository;
}

export function validateCandidate(candidate, { project, taskId, commit } = {}) {
  if (!candidate || candidate.version !== 1) throw new Error('Candidato legado sem metadados recuperáveis.');
  identity(candidate.project);
  identity(candidate.taskId);
  validateRepository(candidate.repository);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate.commit) ||
      candidate.ref !== `refs/vibecora/candidates/${candidate.project}/${candidate.taskId}/${candidate.commit}` ||
      (project !== undefined && candidate.project !== project) ||
      (taskId !== undefined && candidate.taskId !== taskId) ||
      (commit !== undefined && candidate.commit !== commit)) {
    throw new Error('Identidade, ref ou hash do candidato divergente.');
  }
  return candidate;
}

function confirm(cwd, candidate, allowMissing = false) {
  const output = git(cwd, ['ls-remote', '--refs', '--', candidate.repository, candidate.ref]);
  if (!output && allowMissing) return false;
  if (output !== `${candidate.commit}\t${candidate.ref}`) {
    throw new Error('SHA/ref remoto do candidato não confirmado.');
  }
  return true;
}

export function persistCandidate({ cwd, repository, project, taskId, commit }) {
  const endpoint = repository || git(cwd, ['remote', 'get-url', '--push', 'origin']);
  const candidate = validateCandidate({
    version: 1, repository: endpoint, project, taskId, commit,
    ref: `refs/vibecora/candidates/${project}/${taskId}/${commit}`,
  });
  if (!confirm(cwd, candidate, true)) {
    git(cwd, ['-c', 'push.followTags=false', 'push', '--no-force', '--no-follow-tags',
      '--', endpoint, `${commit}:${candidate.ref}`]);
  }
  confirm(cwd, candidate);
  return candidate;
}

export function recoverCandidate({ cwd, candidate, project, taskId, commit, repository }) {
  validateCandidate(candidate, { project, taskId, commit });
  validateRepository(repository);
  if (repository !== candidate.repository) throw new Error('Repositório informado diverge do ledger.');
  confirm(cwd, candidate);
  git(cwd, ['fetch', '--no-tags', '--no-recurse-submodules', '--', repository, candidate.ref]);
  if (git(cwd, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']) !== candidate.commit) {
    throw new Error('Hash recuperado diverge do candidato.');
  }
  return { taskId, candidateCommit: candidate.commit, candidate, fetched: true };
}