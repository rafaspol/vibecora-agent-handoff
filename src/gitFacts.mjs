import { execFileSync } from 'node:child_process';

// Fatos de Git locais. Tudo sem rede. Cada função devolve `null` (ou lista
// vazia) quando o comando falha, para o chamador decidir.

function git(args, { cwd } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitRaw(args, { cwd } = {}) {
  // Como git(), mas SEM trim — preserva o espaço-coluna de `status --porcelain`
  // (a 1ª linha perderia o char de status com trim()).
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

export function makeGitFacts({ cwd = process.cwd(), mainRef = 'main' } = {}) {
  const g = (args) => git(args, { cwd });

  function resolvedMainRef() {
    if (g(['rev-parse', '--verify', '--quiet', `origin/${mainRef}`]) !== null) {
      return `origin/${mainRef}`;
    }
    return mainRef;
  }

  function headCommit() {
    return g(['rev-parse', '--short', 'HEAD']);
  }

  function currentBranch() {
    return g(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  function commitExists(sha) {
    if (!sha) return false;
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
        cwd,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  function isAncestor(sha, ref) {
    if (!sha) return false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, ref], {
        cwd,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  // Ancestral de origin/<main> OU de <main> local — num fluxo commit-então-push
  // direto na main o commit está na main local antes do push.
  function mainContains(sha) {
    return isAncestor(sha, `origin/${mainRef}`) || isAncestor(sha, mainRef);
  }

  function baseRef() {
    const base =
      g(['merge-base', resolvedMainRef(), 'HEAD']) ||
      g(['merge-base', mainRef, 'HEAD']) ||
      g(['rev-list', '--max-parents=0', 'HEAD']);
    return base ? base.split('\n')[0] : null;
  }

  function changedPathsSince(base) {
    if (!base) return [];
    const out = g(['diff', '--name-only', `${base}..HEAD`]);
    const committed = out ? out.split('\n').filter(Boolean) : [];
    const dirty = gitRaw(['status', '--porcelain'], { cwd });
    const uncommitted = dirty
      ? dirty
          .split('\n')
          .filter(Boolean)
          .map((line) => line.slice(3).split(' -> ').pop())
          .filter(Boolean)
      : [];
    return [...new Set([...committed, ...uncommitted])];
  }

  function commitsInRange(base, head = 'HEAD') {
    if (!base) return [];
    const out = g(['rev-list', `${base}..${head}`]);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  function pathsInCommit(sha) {
    const out = g(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  function workingTreeDirty() {
    return Boolean(g(['status', '--porcelain']));
  }

  function branchHasUpstream() {
    return (
      g(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) !== null
    );
  }

  function inferCodeState() {
    if (workingTreeDirty()) return 'working_tree';
    const head = g(['rev-parse', 'HEAD']);
    if (head && mainContains(head)) return 'merged_main';
    if (branchHasUpstream()) return 'pushed_branch';
    return 'local_commit';
  }

  function remoteMainCommit() {
    const out = g(['ls-remote', 'origin', `refs/heads/${mainRef}`]);
    return out ? out.split(/\s+/)[0] : null;
  }

  return {
    headCommit,
    currentBranch,
    commitExists,
    mainContains,
    isAncestor,
    baseRef,
    changedPathsSince,
    commitsInRange,
    pathsInCommit,
    workingTreeDirty,
    inferCodeState,
    remoteMainCommit,
    mainRef,
  };
}
