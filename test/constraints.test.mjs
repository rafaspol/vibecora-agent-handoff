import assert from 'node:assert/strict';
import test from 'node:test';

import { readConstraintIds, validateConstraints } from '../src/constraints.mjs';
import { parseYaml } from '../src/yaml.mjs';

const GOOD = `version: 1
constraints:
  - id: trava-a
    resumo: "A polaridade invertida é intencional e foi medida."
    porque: "Contraria a referência, e mesmo assim foi a escolha registrada."
    fonte: "ADR 0007"
retired:
  - id: trava-b
    motivo: "resolvida na v2"
    em: 2026-09-08
`;

test('lê os ids ativos e os aposentados', () => {
  assert.deepEqual(readConstraintIds(GOOD), {
    active: ['trava-a'],
    retired: ['trava-b'],
  });
});

test('YAML quebrado devolve listas vazias, não exceção', () => {
  // Um arquivo malformado não pode derrubar a abertura da sessão: o detector
  // simplesmente não tem o que comparar. Quem reclama de formato é o validador,
  // e o que ele produz é nota, não bloqueio.
  assert.deepEqual(readConstraintIds('constraints: [oops\n  - :'), {
    active: [],
    retired: [],
  });
  assert.deepEqual(readConstraintIds(''), { active: [], retired: [] });
});

test('arquivo válido não produz erro', () => {
  assert.deepEqual(validateConstraints(parseYaml(GOOD)), []);
});

test('id fora do formato, duplicado, e campos curtos são acusados', () => {
  const doc = parseYaml(`version: 1
constraints:
  - id: Trava_A
    resumo: "texto suficientemente longo"
    porque: "texto suficientemente longo"
  - id: trava-b
    resumo: "curto"
    porque: "texto suficientemente longo"
  - id: trava-b
    resumo: "texto suficientemente longo"
    porque: "texto suficientemente longo"
retired: []
`);
  const errs = validateConstraints(doc);
  assert.ok(errs.some((e) => e.includes('kebab-case')));
  assert.ok(errs.some((e) => e.includes('duplicado')));
  assert.ok(errs.some((e) => e.includes('`resumo` ausente ou curto')));
});

test('`porque` é obrigatório — é ele que faz a trava sobreviver a quem discorda', () => {
  // O negativo simétrico do teste acima: um item que tem tudo MENOS o porquê
  // ainda reprova. Sem esta asserção, a regra passaria exigindo só o resumo.
  const doc = parseYaml(`version: 1
constraints:
  - id: trava-a
    resumo: "texto suficientemente longo"
constraints_extra: ignorado
`);
  const errs = validateConstraints(doc);
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('`porque`'));
});

test('lista ausente e tipo errado são acusados sem quebrar', () => {
  assert.ok(validateConstraints(null).length > 0);
  assert.ok(
    validateConstraints({ constraints: 'nope' }).some((e) =>
      e.includes('deve ser uma lista')
    )
  );
  assert.ok(
    validateConstraints({ constraints: [], retired: 'nope' }).some((e) =>
      e.includes('`retired` deve ser uma lista')
    )
  );
});
