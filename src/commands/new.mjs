import fs from 'node:fs';
import path from 'node:path';

import { CHANGE_CLASSES, makeClassifier } from '../classify.mjs';
import { makeGitFacts } from '../gitFacts.mjs';
import { validateHandoff } from '../schema.mjs';
import { dumpYaml, parseYaml } from '../yaml.mjs';

const HEADER =
  '# GERADO por `vibecora-handoff new`. NÃO edite à mão — edite o arquivo de\n' +
  '# entrada e rode o comando de novo.\n';

export function run(args, { cwd, config }) {
  const inputPath = path.resolve(cwd, config.files.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`entrada não encontrada: ${inputPath} (rode "init" antes).`);
    return 1;
  }
  const input = parseYaml(fs.readFileSync(inputPath, 'utf8'));
  if (!input || typeof input !== 'object') {
    console.error(`${inputPath}: YAML inválido ou vazio.`);
    return 1;
  }

  const git = makeGitFacts({ cwd, mainRef: config.git?.mainRef || 'main' });
  const classifier = makeClassifier(config);

  const commit = git.headCommit();
  const branch = git.currentBranch();
  if (!commit || !branch) {
    console.error('não consegui ler o estado do Git (commit/branch).');
    return 1;
  }

  const recordedAt =
    args.recordedAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const codeState = input.code_state || git.inferCodeState();

  const handoffPath = path.resolve(cwd, config.files.handoff);
  const relHandoff = path.relative(cwd, handoffPath);
  const changed = git.changedPathsSince(git.baseRef());
  const derived = classifier.classifyPaths([...changed, relHandoff], {
    onUnknown: () => {},
  });
  // Classes extras que passos posteriores do fluxo do consumidor vão tocar
  // (ex.: `roadmap-sync` reescreve o ROADMAP depois do `new`): via --extra-class
  // ou config.classify.recordAlsoTouches.
  const extra = [
    ...(args.extraClass || []),
    ...(config.classify?.recordAlsoTouches || []),
  ].filter((c) => CHANGE_CLASSES.includes(c));
  const changeClass = [
    ...new Set([...derived, ...(input.change_class || []), ...extra]),
  ].sort();
  if (changeClass.length === 0) changeClass.push(classifier.unknownClass);

  const handoff = {
    version: 3,
    run_id: input.run_id,
    recorded_at: recordedAt,
    branch,
    task_class: input.task_class,
    operation: input.operation,
    agent_runtime: input.agent_runtime,
    change_class: changeClass,
    delivery: input.delivery,
    code: { state: codeState, commit },
    release_intent: input.release_intent,
    tests: input.tests,
    roadmap: input.roadmap,
    decisions: input.decisions || [],
    risks: input.risks || [],
    assumptions: input.assumptions || [],
    remaining: input.remaining || [],
    context: input.context || [],
  };

  const errors = validateHandoff({
    handoff,
    performanceEvents: [],
    git: {
      changedPaths: [...changed, relHandoff],
      commitExists: () => true,
      mainContains: () => codeState === 'merged_main',
    },
    classifier,
  });
  // O cross-check com run_completed não se aplica no `new` (o evento é do
  // `finalize`); ignora só esse erro.
  const real = errors.filter(
    (e) => !e.includes('performance.jsonl não contém run_completed'),
  );
  if (real.length > 0) {
    console.error('retrato inconsistente — nada foi escrito:');
    real.forEach((e) => console.error(`- ${e}`));
    return 1;
  }

  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, HEADER + dumpYaml(handoff));
  console.log(
    `retrato gravado: ${handoff.run_id} @ ${recordedAt} (${changeClass.join(', ')}).`,
  );
  return 0;
}
