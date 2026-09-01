import fs from 'node:fs';
import path from 'node:path';

import { detectVersion, summarizeV2 } from '../legacyV2.mjs';
import { parseYaml } from '../yaml.mjs';

// Visão compacta do retrato. Determinístico, SEM escrita, SEM rede.

function buildBrief(handoff) {
  const open = (handoff.remaining || []).filter((r) => r.status !== 'deferred');
  return {
    version: 3,
    run_id: handoff.run_id ?? null,
    recorded_at: handoff.recorded_at ?? null,
    branch: handoff.branch ?? null,
    code: handoff.code
      ? `${handoff.code.state} @ ${handoff.code.commit}`
      : null,
    release_intent: handoff.release_intent ?? null,
    change_class: handoff.change_class || [],
    task: handoff.delivery?.task?.trim?.() ?? handoff.delivery?.task ?? null,
    tests: handoff.tests?.result ?? null,
    roadmap: handoff.roadmap?.status ?? null,
    counts: {
      completed: (handoff.delivery?.completed || []).length,
      decisions: (handoff.decisions || []).length,
      risks: (handoff.risks || []).length,
      assumptions: (handoff.assumptions || []).length,
      remaining_open: open.length,
      context: (handoff.context || []).length,
    },
    remaining_open: open.map((r) => ({
      task: r.task?.trim?.() ?? r.task,
      owner: r.owner,
      blocking: !!r.blocking,
    })),
    decisions: (handoff.decisions || []).map((d) => d.decision),
    risks: handoff.risks || [],
    context: (handoff.context || []).map((c) => ({
      claim: c.claim,
      basis: c.basis,
    })),
  };
}

function printText(b) {
  const line = (k, v) => console.log(`  ${String(k).padEnd(15)} ${v ?? '—'}`);
  console.log('── retrato ──');
  line('run_id', b.run_id);
  line('recorded_at', b.recorded_at);
  line('branch', b.branch);
  line('code', b.code);
  line('release_intent', b.release_intent);
  line('change_class', b.change_class.join(', '));
  line('tests', b.tests);
  line('roadmap', b.roadmap);
  line('entrega', b.task);
  if (b.remaining_open.length) {
    console.log('\n── pendências ──');
    for (const r of b.remaining_open) {
      console.log(
        `  [${r.blocking ? 'BLOQUEIA' : 'aberto'}] (${r.owner}) ${r.task}`,
      );
    }
  }
  if (b.decisions.length) {
    console.log('\n── decisões ──');
    for (const d of b.decisions) console.log(`  - ${d}`);
  }
  if (b.risks.length) {
    console.log('\n── riscos ──');
    for (const r of b.risks) console.log(`  - ${r}`);
  }
  if (b.context.length) {
    console.log('\n── context ──');
    for (const c of b.context) console.log(`  [${c.basis}] ${c.claim}`);
  }
}

export function run(args, { cwd, config }) {
  const handoffPath = path.resolve(cwd, config.files.handoff);
  if (!fs.existsSync(handoffPath)) {
    console.error(`retrato não encontrado: ${handoffPath}`);
    return 1;
  }
  const handoff = parseYaml(fs.readFileSync(handoffPath, 'utf8'));
  const version = detectVersion(handoff);

  if (version === 2) {
    const s = summarizeV2(handoff);
    if (args.json) console.log(JSON.stringify(s, null, 2));
    else {
      console.log('── retrato v2 (histórico) ──');
      for (const [k, v] of Object.entries(s)) {
        console.log(`  ${k.padEnd(16)} ${v ?? '—'}`);
      }
    }
    return 0;
  }
  if (version !== 3) {
    console.error('retrato sem version 2 ou 3 reconhecível.');
    return 1;
  }

  const b = buildBrief(handoff);
  if (args.json) console.log(JSON.stringify(b, null, 2));
  else printText(b);
  return 0;
}
