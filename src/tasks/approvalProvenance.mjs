import fs from 'node:fs';
import path from 'node:path';

import { normalizeAgentIdentity, shortAgentRef } from './agentIdentity.mjs';

// De onde vem uma aprovação da fila.
//
// `task approve` sempre gravou `approvedBy: <condutor>` e uma referência de
// texto livre. Quem lia o ledger via "@rafaspol aprovou" em toda linha — e a
// maior parte delas foi digitada por um agente, citando uma conversa que o
// sucessor não consegue abrir. A ausência de prova aparecia como
// autenticação.
//
// Isto não prova nada que antes não se provava. Diz, em cada aprovação, QUEM a
// registrou e em que ela se apoia, para que o texto autodeclarado deixe de se
// passar por outra coisa:
//
//   document      `ledger:<caminho>` — um arquivo no próprio ledger, conferido
//                 na hora do registro. É a única base que o sucessor abre.
//   delegation    uma referência de delegação permanente do condutor (listada
//                 em `tasks.delegationRefs`), como a entrada delegada do
//                 ADR 0020 no projeto de origem.
//   conversation  todo o resto: conversa, quiz, thread. Declarada por quem
//                 registrou, e por isso exige um resumo do que o condutor
//                 disse — o fundamento fica legível mesmo sem a conversa.

export const APPROVAL_BASES = ['document', 'delegation', 'conversation'];

export const MAX_APPROVAL_SUMMARY = 280;

const LEDGER_PREFIX = 'ledger:';

function ledgerPath(ref) {
  const rel = ref.slice(LEDGER_PREFIX.length).trim();
  if (
    !rel ||
    path.isAbsolute(rel) ||
    rel.split(/[\\/]/).includes('..') ||
    /[\x00-\x1f]/.test(rel)
  ) {
    throw new Error(`Referência de documento inválida: ${ref}`);
  }
  return rel;
}

/**
 * A base de uma referência, sem consultar nada. Serve também para classificar
 * aprovações antigas, anteriores a este registro.
 */
export function approvalBasis(ref, { delegationRefs = [] } = {}) {
  const value = String(ref || '').trim();
  if (value.startsWith(LEDGER_PREFIX)) return 'document';
  if (delegationRefs.includes(value)) return 'delegation';
  return 'conversation';
}

/**
 * Os campos de proveniência de um `proposal_approved` novo. Recusa o que não
 * se sustenta: documento que não existe no ledger, e conversa sem resumo.
 */
export function approvalProvenance({
  ref,
  summary,
  recordedBy,
  ledgerRoot,
  delegationRefs = [],
}) {
  const basis = approvalBasis(ref, { delegationRefs });
  if (basis === 'document') {
    const rel = ledgerPath(String(ref).trim());
    if (!ledgerRoot || !fs.existsSync(path.join(ledgerRoot, rel))) {
      throw new Error(
        `O documento da aprovação não existe no ledger: ${rel}. Grave-o antes de aprovar.`,
      );
    }
  }
  const texto = typeof summary === 'string' ? summary.trim() : '';
  if (basis === 'conversation' && !texto) {
    throw new Error(
      'Aprovação por conversa exige --approval-summary com o que o condutor decidiu: o sucessor não abre a conversa, e o resumo é o fundamento que fica.',
    );
  }
  if (texto.length > MAX_APPROVAL_SUMMARY) {
    throw new Error(
      `--approval-summary passa de ${MAX_APPROVAL_SUMMARY} caracteres; resuma a decisão.`,
    );
  }
  if (/[\x00-\x09\x0b-\x1f]/.test(texto)) {
    throw new Error('--approval-summary tem caractere de controle.');
  }
  return {
    approvalBasis: basis,
    recordedBy: recordedBy ? normalizeAgentIdentity(recordedBy) : null,
    ...(texto ? { approvalSummary: texto } : {}),
  };
}

/**
 * A aprovação como o reducer a guarda. Evento antigo, sem os campos novos, é
 * classificado pelo prefixo e marcado `legacy`: não se inventa registrante.
 */
export function approvalRecord(event) {
  const legacy = !('approvalBasis' in event);
  return {
    by: event.approvedBy,
    ref: event.approvalRef,
    at: event.at,
    basis: legacy ? approvalBasis(event.approvalRef) : event.approvalBasis,
    recordedBy: legacy ? null : event.recordedBy || null,
    summary: event.approvalSummary || null,
    legacy,
  };
}

/**
 * O que a listagem diz de uma aprovação. Vazio para documento: é o caso que
 * não precisa de ressalva. Nos outros, diz que foi declarada e por quem.
 */
export function approvalNote(approval) {
  if (!approval || approval.basis === 'document') return '';
  const quem = approval.recordedBy
    ? shortAgentRef(approval.recordedBy)
    : approval.legacy
      ? 'registro anterior à proveniência'
      : 'registrante não identificado';
  const base = approval.basis === 'delegation' ? 'delegação' : 'conversa';
  return `aprovação declarada (${base}; ${quem})`;
}
