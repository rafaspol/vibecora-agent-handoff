import fs from 'node:fs';
import path from 'node:path';

import { buildRunEvent } from '../schema.mjs';
import { parseYaml } from '../yaml.mjs';

// Acrescenta UM run_completed ao histórico append-only. Rodar de novo para o
// mesmo run_id não faz nada (idempotente).

export function run(args, { cwd, config }) {
  const handoffPath = path.resolve(cwd, config.files.handoff);
  if (!fs.existsSync(handoffPath)) {
    console.error(`retrato não encontrado: ${handoffPath} (rode "new" antes).`);
    return 1;
  }
  const handoff = parseYaml(fs.readFileSync(handoffPath, 'utf8'));
  if (handoff?.version !== 3) {
    console.error('finalize exige um retrato v3.');
    return 1;
  }
  if (!handoff.run_id) {
    console.error('retrato sem run_id.');
    return 1;
  }

  const perfPath = path.resolve(cwd, config.files.performance);
  let existing = [];
  if (fs.existsSync(perfPath)) {
    existing = fs
      .readFileSync(perfPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const already = existing.some(
    (e) => e.event === 'run_completed' && e.run_id === handoff.run_id,
  );
  if (already) {
    const msg = `run_completed para "${handoff.run_id}" já existe — nada a fazer (idempotente).`;
    if (args.json) console.log(JSON.stringify({ appended: false, reason: 'exists' }));
    else console.log(msg);
    return 0;
  }

  const event = buildRunEvent(handoff, { result: args.result });
  fs.mkdirSync(path.dirname(perfPath), { recursive: true });
  fs.appendFileSync(perfPath, `${JSON.stringify(event)}\n`);

  if (args.json) console.log(JSON.stringify({ appended: true, event }, null, 2));
  else console.log(`run_completed gravado para "${handoff.run_id}".`);
  return 0;
}
