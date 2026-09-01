import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Verificação de informação: procura termos proibidos (nome de produto,
// domínio, identificadores) em arquivos e no histórico Git. Os termos vêm da
// env var HANDOFF_FORBIDDEN_TERMS (lista separada por vírgula) e NÃO são
// versionados. A saída informa arquivo e linha, nunca repete o termo.

export function parseTerms(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yml', '.yaml',
  '.jsonl', '.sh', '.html', '.css', '', '.example',
]);

function walk(dir, ignore, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ignore, out);
    else out.push(full);
  }
}

export function collectFiles(root, { ignore = ['.git', 'node_modules'] } = {}) {
  const out = [];
  walk(root, new Set(ignore), out);
  return out.filter((f) => TEXT_EXT.has(path.extname(f)));
}

// Retorna [{ file, line }] — sem o termo. `terms` já parseado.
export function scanFiles(files, terms, { root = process.cwd() } = {}) {
  const needles = terms.map((t) => t.toLowerCase());
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase();
      if (needles.some((n) => lower.includes(n))) {
        findings.push({ file: path.relative(root, file), line: i + 1 });
      }
    }
  }
  return findings;
}

// Varre o histórico Git NOVO (todos os commits alcançáveis por HEAD, já que a
// história é limpa): mensagens e diffs. Retorna [{ commit, where }].
export function scanGitHistory(terms, { cwd = process.cwd() } = {}) {
  const needles = terms.map((t) => t.toLowerCase());
  let log;
  try {
    log = execFileSync(
      'git',
      ['log', '--all', '--format=%H%x00%B%x00', '-p', '--no-color'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return [];
  }
  const findings = [];
  let currentCommit = null;
  for (const line of log.split('\n')) {
    const m = line.match(/^([0-9a-f]{40})\x00/);
    if (m) currentCommit = m[1].slice(0, 12);
    const lower = line.toLowerCase();
    if (currentCommit && needles.some((n) => lower.includes(n))) {
      const where = line.startsWith('commit ') || line.includes('\x00')
        ? 'mensagem'
        : 'diff';
      findings.push({ commit: currentCommit, where });
    }
  }
  // dedup
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.commit}:${f.where}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function runForbiddenTermsCheck({
  root = process.cwd(),
  termsEnv = 'HANDOFF_FORBIDDEN_TERMS',
  includeHistory = true,
} = {}) {
  const terms = parseTerms(process.env[termsEnv]);
  if (terms.length === 0) {
    return {
      configured: false,
      reason: `${termsEnv} não definida — a verificação não protege nada.`,
      fileFindings: [],
      historyFindings: [],
    };
  }
  const fileFindings = scanFiles(collectFiles(root), terms, { root });
  const historyFindings = includeHistory
    ? scanGitHistory(terms, { cwd: root })
    : [];
  return {
    configured: true,
    termCount: terms.length,
    fileFindings,
    historyFindings,
    clean: fileFindings.length === 0 && historyFindings.length === 0,
  };
}
