import fs from 'node:fs';
import path from 'node:path';

// Configuração do handoff no projeto consumidor. Caminho padrão:
// `.agents/handoff.config.json`. O núcleo traz defaults genéricos; o consumidor
// sobrescreve o que for específico do layout dele.

export const DEFAULT_CONFIG = {
  version: 3,
  platform: null, // ex.: "quave-one"
  files: {
    handoff: '.agents/handoff.yaml',
    input: '.agents/handoff.input.yaml',
    performance: '.agents/performance.jsonl',
    friction: '.agents/friction.log',
    roadmap: null, // opcional; null => roadmap não faz parte do fluxo
  },
  git: {
    mainRef: 'main',
  },
  classify: {
    // Regras ordenadas: a primeira que casar decide a classe do caminho.
    // `match` aceita globs simples (`**`, `*`) e caminhos literais.
    rules: [
      {
        class: 'state',
        match: [
          '.agents/handoff.yaml',
          '.agents/handoff.input.yaml',
          '.agents/performance.jsonl',
          '.agents/friction.log',
        ],
      },
      { class: 'general_docs', match: ['docs/decisions/**', 'README.md'] },
      { class: 'product_docs', match: ['ROADMAP.md', 'docs/**'] },
      {
        class: 'process',
        match: [
          '.github/**',
          'scripts/**',
          '.githooks/**',
          'tests/**',
          'test/**',
          'evals/**',
          'AGENTS.md',
          'CLAUDE.md',
          '.agents/**',
        ],
      },
      {
        class: 'runtime',
        match: [
          'src/**',
          'app/**',
          'lib/**',
          'client/**',
          'server/**',
          'public/**',
          'package.json',
          'package-lock.json',
          'Dockerfile',
        ],
      },
      { class: 'general_docs', match: ['*.md'] },
    ],
    unknownClass: 'runtime',
  },
  audit: {
    // Nome da env var que aponta a base de `/api/release`. Sem valor => a fonte
    // é reportada como indisponível.
    releaseBaseUrlEnv: 'HANDOFF_AUDIT_BASE_URL',
    quave: {
      envNameEnv: 'QUAVEONE_ENV_NAME',
      envTokenEnv: 'QUAVEONE_ENV_TOKEN',
      cliEnv: 'QUAVEONE_CLI', // caminho do binário; default: "quaveone" no PATH
    },
  },
};

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (
    override == null ||
    typeof override !== 'object' ||
    typeof base !== 'object' ||
    base == null ||
    Array.isArray(base)
  ) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

export function configPath(cwd, override) {
  return path.resolve(cwd, override || '.agents/handoff.config.json');
}

export function loadConfig(cwd = process.cwd(), override) {
  const file = configPath(cwd, override);
  if (!fs.existsSync(file)) {
    return { config: DEFAULT_CONFIG, path: file, exists: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: JSON inválido (${error.message}).`);
  }
  return { config: deepMerge(DEFAULT_CONFIG, parsed), path: file, exists: true };
}
