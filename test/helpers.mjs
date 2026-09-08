import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-'));
  const git = (args) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@test.invalid']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  git(['branch', '-M', 'main']);
  return {
    dir,
    git: (...a) => git(a).toString().trim(),
    write(rel, content) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    },
    read(rel) {
      return fs.readFileSync(path.join(dir, rel), 'utf8');
    },
    exists(rel) {
      return fs.existsSync(path.join(dir, rel));
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const CLI = new URL('../bin/vibecora-handoff.mjs', import.meta.url)
  .pathname;

export function runCli(cwd, argv, { env } = {}) {
  try {
    const out = execFileSync('node', [CLI, ...argv], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return {
      code: e.status ?? 1,
      out: e.stdout?.toString() ?? '',
      err: e.stderr?.toString() ?? '',
    };
  }
}

// Ambiente onde `gh` sempre falha. Sem isto os testes do `start` passariam a
// depender de `gh` instalado E autenticado na máquina de quem roda e no CI —
// falha intermitente garantida, por um motivo que nada tem a ver com o que se
// está testando.
//
// Um `gh` que falha, e não um PATH vazio: o PATH precisa continuar tendo `git`,
// que é o que o comando de fato mede.
let shimDir = null;
export function envWithoutGh() {
  if (!shimDir) {
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-nogh-'));
    const shim = path.join(shimDir, 'gh');
    fs.writeFileSync(shim, '#!/bin/sh\nexit 127\n');
    fs.chmodSync(shim, 0o755);
  }
  return { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` };
}

// Repo com um `origin` de verdade (bare local). É o que torna possível provar
// `ahead` × `diverged` × branch remota ausente sem tocar a rede.
export function tmpRepoWithRemote() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-bare-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], {
    stdio: 'ignore',
  });
  const repo = tmpRepo();
  repo.git('remote', 'add', 'origin', bare);
  repo.git('push', '-q', '-u', 'origin', 'main');
  const baseCleanup = repo.cleanup;
  return {
    ...repo,
    bare,
    // Um segundo clone que empurra trabalho, para simular o que outra pessoa
    // (ou outro agente) fez e este checkout ainda não viu.
    pushFrom(branch, fileName) {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-other-'));
      const g = (args) =>
        execFileSync('git', args, { cwd: other, stdio: ['ignore', 'pipe', 'ignore'] });
      g(['clone', '-q', bare, '.']);
      g(['config', 'user.email', 'test@test.invalid']);
      g(['config', 'user.name', 'test']);
      g(['config', 'commit.gpgsign', 'false']);
      if (branch !== 'main') g(['checkout', '-q', '-b', branch]);
      fs.writeFileSync(path.join(other, fileName), 'x\n');
      g(['add', '-A']);
      g(['commit', '-qm', `trabalho em ${branch}`]);
      g(['push', '-q', 'origin', branch]);
      const sha = g(['rev-parse', 'HEAD']).toString().trim();
      fs.rmSync(other, { recursive: true, force: true });
      return sha;
    },
    cleanup() {
      baseCleanup();
      fs.rmSync(bare, { recursive: true, force: true });
    },
  };
}

export const GOOD_INPUT = `run_id: "fx-2026-09-01-a"
task_class: "demo"
operation: "implement"
agent_runtime: { agent: "A", model: "m", environment: "local" }
delivery:
  task: "Entrega de fixture."
  completed: ["Item feito."]
release_intent: "not_requested"
tests: { ran: ["npm test"], result: "pass" }
roadmap: { status: "not_applicable", reason: "sem produto" }
decisions: []
risks: []
assumptions: []
remaining: []
context:
  - claim: "Verificado na fixture."
    basis: "verified"
    evidence: "comandos rodados no teste"
`;
