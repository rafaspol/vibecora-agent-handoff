#!/usr/bin/env node
import process from 'node:process';

import { loadConfig } from '../src/config.mjs';

const COMMANDS = {
  init: () => import('../src/commands/init.mjs'),
  start: () => import('../src/commands/start.mjs'),
  new: () => import('../src/commands/new.mjs'),
  brief: () => import('../src/commands/brief.mjs'),
  check: () => import('../src/commands/check.mjs'),
  finalize: () => import('../src/commands/finalize.mjs'),
  audit: () => import('../src/commands/audit.mjs'),
  task: () => import('../src/commands/task.mjs'),
};

const USAGE = `vibecora-handoff <comando> [opções]

  init       cria config, entrada e travas (não sobrescreve)
  start      mede o estado ANTES de a sessão começar; sai 1 se bloqueado,
             e chama o brief no fim (rede, só leitura, nada é escrito)
  new        regenera o retrato inteiro a partir do Git + entrada (offline)
             --extra-class <c>   classe extra que passos posteriores do fluxo
                                 (ex.: roadmap-sync) vão tocar; repetível
  brief      visão compacta do retrato (--json); não escreve, offline
  check      valida schema, Git, histórico e evidências (offline)
  finalize   acrescenta um único run_completed (idempotente, offline)
  audit      reconcilia GitHub, /api/release e a plataforma (rede, só leitura)
  task       fila compartilhada: list|propose|approve|next|arm|resume|finish|block|unblock

Opções gerais:
  --json            saída em JSON (start, brief, check, finalize)
  --config <path>   caminho do arquivo de config (default .agents/handoff.config.json)
  --result <r>      finalize: result do run_completed (success|failed|partial|unknown)
  --recorded-at <iso>  new: recorded_at explícito (default: agora, em UTC)
  --agent-type <tipo> --agent-id <id>  identidade para ações de tarefa
  -h, --help
`;

function parseArgs(argv) {
  const args = { _: [], json: false, extraClass: [], dependsOn: [] };
  const valueFlags = new Map([
    ['--config', 'config'],
    ['--result', 'result'],
    ['--recorded-at', 'recordedAt'],
    ['--kind', 'kind'],
    ['--proposal-id', 'proposalId'],
    ['--task-id', 'taskId'],
    ['--title', 'title'],
    ['--objective', 'objective'],
    ['--done-when', 'doneWhen'],
    ['--suggested-rank', 'suggestedRank'],
    ['--roadmap-ref', 'roadmapRef'],
    ['--reason', 'reason'],
    ['--consequence', 'consequence'],
    ['--approval-ref', 'approvalRef'],
    ['--owner', 'owner'],
    ['--agent-type', 'agentType'],
    ['--agent-id', 'agentId'],
    ['--claim-epoch', 'claimEpoch'],
    ['--quota-remaining', 'quotaRemaining'],
    ['--context-remaining', 'contextRemaining'],
    ['--measured-at', 'measuredAt'],
    ['--measurement-source', 'measurementSource'],
    ['--claim', 'claim'],
    ['--destination', 'destination'],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--integrated') args.integrated = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--extra-class') args.extraClass.push(argv[++i]);
    else if (a === '--depends-on') args.dependsOn.push(argv[++i]);
    else if (valueFlags.has(a)) args[valueFlags.get(a)] = argv[++i];
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
