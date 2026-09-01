import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG } from '../config.mjs';

const INPUT_TEMPLATE = `# Entrada do handoff v3. O agente edita SÓ este arquivo com a narrativa do
# fechamento; \`vibecora-handoff new\` deriva o resto do Git (recorded_at,
# branch, code.commit, code.state, change_class) e sobrescreve o retrato inteiro.
# NUNCA edite o handoff.yaml à mão.

run_id: "exemplo-2026-01-01-agente"
task_class: "exemplo"
operation: "implement" # analyze|diagnose|implement|review|test|refactor|document|other

agent_runtime:
  agent: "Agente"
  model: "modelo"
  environment: "local"

delivery:
  task: >
    Uma frase: o que esta sessão entregou.
  completed:
    - "Item concluído e verificado."

# code_state é inferido do Git quando omitido:
# code_state: "local_commit" # working_tree|local_commit|pushed_branch|merged_main

release_intent: "not_requested" # not_requested|requested|authorized

tests:
  ran:
    - "npm test"
  result: "pass" # pass|fail|partial|not_run

roadmap:
  status: "not_applicable" # updated|not_applicable
  reason: "Sem mudança de produto." # obrigatório se not_applicable
  # sections: ["Seção alterada"]   # obrigatório se updated

decisions: []
risks: []
assumptions: []
remaining: []

context:
  - claim: "Afirmação factual sobre o estado."
    basis: "verified" # verified|observed|assumed|unknown
    evidence: "Como sei disso."

# change_class extra a unir ao derivado do diff (raro):
# change_class: [process]
`;

export function run(_args, { config, configInfo }) {
  const created = [];
  const skipped = [];

  if (configInfo.exists) {
    skipped.push(configInfo.path);
  } else {
    fs.mkdirSync(path.dirname(configInfo.path), { recursive: true });
    fs.writeFileSync(
      configInfo.path,
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
    );
    created.push(configInfo.path);
  }

  const inputPath = path.resolve(process.cwd(), config.files.input);
  if (fs.existsSync(inputPath)) {
    skipped.push(inputPath);
  } else {
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, INPUT_TEMPLATE);
    created.push(inputPath);
  }

  for (const f of created) console.log(`criado: ${f}`);
  for (const f of skipped) console.log(`mantido (já existe): ${f}`);
  return 0;
}
