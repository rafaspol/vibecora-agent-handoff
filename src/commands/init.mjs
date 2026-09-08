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

const CONSTRAINTS_TEMPLATE = `# Travas: decisões que NÃO pertencem a nenhum retrato.
#
# O retrato é substituído inteiro a cada entrega. Uma decisão cara que more
# dentro dele depende de alguém copiá-la para o próximo — e é assim que ela
# desaparece num merge, junto com as tarefas de verdade.
#
# Aqui elas ficam fora do ciclo. Acrescentar é livre; REMOVER exige mover o id
# para \`retired\` com o motivo. O \`vibecora-handoff start\` compara os ids daqui
# com os que já existiram no histórico Git DESTE arquivo e bloqueia a abertura
# quando um sumiu sem aposentadoria.
#
# COMMITE ESTE ARQUIVO. Enquanto ele não estiver no histórico, não há com o que
# comparar e o detector fica inerte.
#
# O que entra: decisão medida que um agente futuro tentaria "consertar", peça
# que parece morta e não está, dívida com dono e sem prazo.
# O que NÃO entra: tarefa. Tarefa vive no \`remaining\` do retrato e morre quando
# é feita.

version: 1

constraints: []
# Exemplo do formato:
#   - id: polaridade-invertida        # slug kebab-case, único
#     resumo: >                       # o que é, dito na polaridade correta
#       O contraste invertido nesta tela é intencional.
#     porque: >                       # por que NÃO é bug — é isto que faz a
#       Foi medido contra a referência e escolhido assim   # trava sobreviver a
#       mesmo assim.                                       # quem discordar dela
#     fonte: "ADR 0007"               # onde verificar

# Travas removidas de propósito. Mover para cá é o que distingue uma decisão de
# um apagamento — e é o que o detector \`constraint_dropped\` procura.
retired: []
#   - id: polaridade-invertida
#     motivo: "a referência mudou; a inversão deixou de fazer sentido"
#     em: 2026-01-01
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

  // Sem este arquivo no histórico, o detector `constraint_dropped` não tem com
  // o que comparar e fica inerte para sempre — um detector morto em silêncio é
  // pior que um ausente. Criá-lo vazio é o que torna o mecanismo descobrível.
  if (config.files.constraints) {
    const constraintsPath = path.resolve(
      process.cwd(),
      config.files.constraints,
    );
    if (fs.existsSync(constraintsPath)) {
      skipped.push(constraintsPath);
    } else {
      fs.mkdirSync(path.dirname(constraintsPath), { recursive: true });
      fs.writeFileSync(constraintsPath, CONSTRAINTS_TEMPLATE);
      created.push(constraintsPath);
    }
  }

  for (const f of created) console.log(`criado: ${f}`);
  for (const f of skipped) console.log(`mantido (já existe): ${f}`);
  return 0;
}
