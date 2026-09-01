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

export function runCli(cwd, argv) {
  try {
    const out = execFileSync('node', [CLI, ...argv], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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
