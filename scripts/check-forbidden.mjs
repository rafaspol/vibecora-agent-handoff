#!/usr/bin/env node
import process from 'node:process';

import { runForbiddenTermsCheck } from '../src/forbiddenTerms.mjs';

// Verificação de informação antes de releases. Termos via
// HANDOFF_FORBIDDEN_TERMS (não versionada). Sai != 0 se achar algo ou se a
// variável não estiver definida (nesse caso não protege nada).

const includeHistory = !process.argv.includes('--no-history');
const soft = process.argv.includes('--soft');
const r = runForbiddenTermsCheck({ root: process.cwd(), includeHistory });

if (!r.configured) {
  console.error(r.reason);
  process.exit(soft ? 0 : 2);
}

for (const f of r.fileFindings) {
  console.error(`termo proibido em ${f.file}:${f.line}`);
}
for (const f of r.historyFindings) {
  console.error(`termo proibido no commit ${f.commit} (${f.where})`);
}

if (r.clean) {
  console.log(
    `ok — ${r.termCount} termo(s) verificado(s), nada encontrado em arquivos${includeHistory ? ' nem no histórico' : ''}.`,
  );
  process.exit(0);
}
console.error(
  `FALHA — ${r.fileFindings.length} em arquivos, ${r.historyFindings.length} no histórico.`,
);
process.exit(1);
