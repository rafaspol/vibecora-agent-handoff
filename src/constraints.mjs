import { parseYaml } from './yaml.mjs';

// As travas: decisões que não pertencem a nenhum retrato.
//
// O retrato é substituído inteiro a cada entrega. Enquanto as travas moravam
// dentro dele, dependiam de o próximo agente copiá-las para o retrato seguinte
// — e num merge real sete delas quase foram apagadas junto com duas tarefas de
// verdade, misturadas na mesma lista.
//
// Aqui elas ficam fora do ciclo, num arquivo versionado que só muda por edição
// explícita: acrescentar é livre, remover exige mover o id para `retired` com o
// motivo. O detector `constraint_dropped` compara os ids do arquivo com os que
// já existiram NO HISTÓRICO DELE — é a única forma de uma trava desaparecer em
// silêncio ser percebida.

const asArray = (v) => (Array.isArray(v) ? v : []);
const idOf = (item) => (typeof item === 'string' ? item : item?.id);

// Tolerante de propósito: um YAML quebrado não pode derrubar a abertura da
// sessão. Quem valida formato é `validateConstraints`, e o resultado dele é
// nota, nunca bloqueio.
export function readConstraintIds(text) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch {
    return { active: [], retired: [] };
  }
  return {
    active: asArray(doc?.constraints).map(idOf).filter(Boolean),
    retired: asArray(doc?.retired).map(idOf).filter(Boolean),
  };
}

const ID_RE = /^[a-z0-9-]+$/;

export function validateConstraints(doc) {
  const errors = [];
  if (doc == null || typeof doc !== 'object') {
    return ['constraints: o arquivo não é um mapa YAML.'];
  }
  if (!Array.isArray(doc.constraints)) {
    errors.push('constraints: `constraints` deve ser uma lista.');
  }
  if (doc.retired !== undefined && !Array.isArray(doc.retired)) {
    errors.push('constraints: `retired` deve ser uma lista.');
  }

  const seen = new Set();
  asArray(doc.constraints).forEach((item, i) => {
    const id = item?.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(
        `constraints[${i}].id deve ser um slug kebab-case (recebi ${JSON.stringify(id)}).`
      );
      return;
    }
    if (seen.has(id)) errors.push(`constraints: id duplicado "${id}".`);
    seen.add(id);
    // `resumo` diz o que é; `porque` diz por que não é bug. Sem o segundo, a
    // trava não sobrevive ao primeiro agente que discordar dela.
    for (const field of ['resumo', 'porque']) {
      if (typeof item?.[field] !== 'string' || item[field].trim().length < 10) {
        errors.push(`constraints[${i}] (${id}): \`${field}\` ausente ou curto demais.`);
      }
    }
  });

  asArray(doc.retired).forEach((item, i) => {
    if (typeof idOf(item) !== 'string') {
      errors.push(`retired[${i}] precisa ter um \`id\`.`);
    }
  });

  return errors;
}
