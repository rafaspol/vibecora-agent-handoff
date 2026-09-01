import fs from 'node:fs';
import path from 'node:path';

import { makeClassifier } from '../classify.mjs';
import { makeGitFacts } from '../gitFacts.mjs';
import { validateHandoff } from '../schema.mjs';
import { parseYaml } from '../yaml.mjs';

function parseJsonl(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`performance.jsonl:${i + 1}: JSON inválido (${e.message}).`);
      }
    });
}

export function run(args, { cwd, config }) {
  const handoffPath = path.resolve(cwd, config.files.handoff);
  if (!fs.existsSync(handoffPath)) {
    console.error(`retrato não encontrado: ${handoffPath}`);
    return 2;
  }
  const handoff = parseYaml(fs.readFileSync(handoffPath, 'utf8'));

  const perfPath = path.resolve(cwd, config.files.performance);
  let performanceEvents = [];
  try {
    if (fs.existsSync(perfPath)) {
      performanceEvents = parseJsonl(fs.readFileSync(perfPath, 'utf8'));
    }
  } catch (e) {
    console.error(String(e.message));
    return 2;
  }

  const git = makeGitFacts({ cwd, mainRef: config.git?.mainRef || 'main' });
  const classifier = makeClassifier(config);
  const errors = validateHandoff({
    handoff,
    performanceEvents,
    git: {
      changedPaths: git.changedPathsSince(git.baseRef()),
      commitExists: git.commitExists,
      mainContains: git.mainContains,
    },
    classifier,
  });

  if (args.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    return errors.length === 0 ? 0 : 1;
  }
  if (errors.length === 0) {
    console.log(`handoff ${handoff.run_id} consistente.`);
    return 0;
  }
  console.error('handoff inconsistente:');
  errors.forEach((e) => console.error(`- ${e}`));
  return 1;
}
