import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { makeClassifier } from '../classify.mjs';
import { makeGitFacts } from '../gitFacts.mjs';
import { collectQuave } from '../quave/adapter.mjs';
import { reconcile } from '../reconcile.mjs';
import { parseYaml } from '../yaml.mjs';

const TIMEOUT_MS = 8_000;

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TIMEOUT_MS,
    }).trim();
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* deixa null */
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function collectGhActions(mainRef) {
  const out = sh('gh', [
    'run',
    'list',
    '--branch',
    mainRef,
    '--limit',
    '1',
    '--json',
    'databaseId,status,conclusion,headSha,createdAt',
  ]);
  if (!out) return { available: false, reason: 'gh indisponível ou não logado' };
  try {
    const [runObj] = JSON.parse(out);
    if (!runObj) return { available: false, reason: 'nenhum run' };
    return {
      available: true,
      status: runObj.status,
      conclusion: runObj.conclusion,
      headSha: runObj.headSha,
      createdAt: runObj.createdAt,
      runId: runObj.databaseId,
    };
  } catch (e) {
    return { available: false, reason: `parse gh: ${e.message}` };
  }
}

async function collectApiRelease(config) {
  const envName =
    config?.audit?.releaseBaseUrlEnv || 'HANDOFF_AUDIT_BASE_URL';
  const base = config?.audit?.releaseBaseUrl || process.env[envName];
  if (!base) {
    return {
      available: false,
      reason: `sem base de /api/release (config.audit.releaseBaseUrl ou ${envName})`,
    };
  }
  const url = `${base.replace(/\/$/, '')}/api/release`;
  try {
    const { ok, status, json } = await fetchJson(url);
    if (!ok) return { available: false, reason: `HTTP ${status}` };
    if (!json || typeof json.commit === 'undefined') {
      return { available: false, reason: `HTTP ${status} sem JSON de release` };
    }
    return { available: true, commit: json.commit, recordedAt: json.recordedAt };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

export async function run(args, { cwd, config }) {
  const handoffPath = path.resolve(cwd, config.files.handoff);
  let snapshot;
  try {
    snapshot = parseYaml(fs.readFileSync(handoffPath, 'utf8'));
  } catch (e) {
    console.error(`audit: não consegui ler o retrato: ${e.message}`);
    return 2;
  }

  const mainRef = config.git?.mainRef || 'main';
  const git = makeGitFacts({ cwd, mainRef });
  const classifier = makeClassifier(config);

  // Tolera "commit-retrato à frente": snapshot é ancestral do live e o
  // intervalo só tem commits de classe não-runtime.
  const ancestry = (snapSha, liveSha) => {
    if (!snapSha || !liveSha) return 'other';
    const a = snapSha.slice(0, 12);
    const b = liveSha.slice(0, 12);
    if (a === b || snapSha.startsWith(liveSha) || liveSha.startsWith(snapSha)) {
      return 'equal';
    }
    if (!git.isAncestor(snapSha, liveSha)) return 'other';
    const commits = git.commitsInRange(snapSha, liveSha);
    if (commits.length === 0) return 'other';
    const allNonRuntime = commits.every((c) => {
      const classes = classifier.classifyPaths(git.pathsInCommit(c), {
        onUnknown: () => {},
      });
      return !classes.has('runtime');
    });
    return allNonRuntime ? 'trailing' : 'other';
  };

  const remoteMain = git.remoteMainCommit();
  const [apiRelease] = await Promise.all([collectApiRelease(config)]);

  const report = reconcile(
    snapshot,
    {
      remote_git: remoteMain
        ? { available: true, mainCommit: remoteMain }
        : { available: false, reason: 'git ls-remote falhou' },
      gh_actions: collectGhActions(mainRef),
      api_release: apiRelease,
      quave: collectQuave({ config, env: process.env }),
    },
    { ancestry },
  );

  console.log(JSON.stringify(report, null, 2));
  return 0; // drift é relatório, não erro
}
