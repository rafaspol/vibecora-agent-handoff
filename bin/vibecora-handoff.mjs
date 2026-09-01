#!/usr/bin/env node
import process from 'node:process';

import { loadConfig } from '../src/config.mjs';

const COMMANDS = {
  init: () => import('../src/commands/init.mjs'),
  new: () => import('../src/commands/new.mjs'),
  brief: () => import('../src/commands/brief.mjs'),
  check: () => import('../src/commands/check.mjs'),
  finalize: () => import('../src/commands/finalize.mjs'),
  audit: () => import('../src/commands/audit.mjs'),
};

const USAGE = `vibecora-handoff <comando> [opções]

  init       cria config + arquivo de entrada (não sobrescreve)
  new        regenera o retrato inteiro a partir do Git + entrada (offline)
  brief      visão compacta do retrato (--json); não escreve, offline
  check      valida schema, Git, histórico e evidências (offline)
  finalize   acrescenta um único run_completed (idempotente, offline)
  audit      reconcilia GitHub, /api/release e a plataforma (rede, só leitura)

Opções gerais:
  --json           saída em JSON (brief, check, finalize)
  --config <path>   caminho do arquivo de config (default .agents/handoff.config.json)
  --result <r>      finalize: result do run_completed (success|failed|partial|unknown)
  -h, --help
`;

function parseArgs(argv) {
  const args = { _: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--result') args.result = argv[++i];
    else if (a === '--recorded-at') args.recordedAt = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  const askedForHelp = !cmd || cmd === '-h' || cmd === '--help' || args.help;
  const unknownCmd = cmd && !askedForHelp && !COMMANDS[cmd];
  if (askedForHelp || unknownCmd) {
    (unknownCmd ? console.error : console.log)(USAGE);
    return unknownCmd ? 1 : 0;
  }

  const cwd = process.cwd();
  let configInfo;
  try {
    configInfo = loadConfig(cwd, args.config);
  } catch (e) {
    console.error(String(e.message));
    return 2;
  }

  const mod = await COMMANDS[cmd]();
  const code = await mod.run(args, {
    cwd,
    config: configInfo.config,
    configInfo,
  });
  return typeof code === 'number' ? code : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err?.stack || String(err));
    process.exit(2);
  },
);
