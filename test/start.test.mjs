import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  GOOD_INPUT,
  envWithoutGh,
  runCli,
  tmpRepo,
  tmpRepoWithRemote,
} from './helpers.mjs';

// Todo `start` daqui roda SEM `gh` no PATH: o comando degrada para "PRs não
// consultadas" em vez de depender de uma ferramenta externa autenticada.
const start = (dir, extra = []) =>
  runCli(dir, ['start', ...extra], { env: envWithoutGh() });

const CONSTRAINTS = (ids, retired = []) =>
  `version: 1\nconstraints:\n${ids
    .map(
      (id) =>
        `  - id: ${id}\n    resumo: "uma decisão medida que parece defeito"\n    porque: "foi medida e escolhida assim mesmo"\n`,
    )
    .join('')}retired:\n${retired.map((id) => `  - id: ${id}\n    motivo: "não vale mais"\n`).join('')}`;

function withSnapshot(repo) {
  repo.write('.agents/handoff.input.yaml', GOOD_INPUT);
  runCli(repo.dir, ['new']);
  runCli(repo.dir, ['finalize']);
  return repo;
}

test('o primeiro start depois do init NÃO bloqueia', () => {
  // O caso de quem está adotando a ferramenta: ainda não existe retrato. Um
  // bloqueio aqui reprovaria justamente quem está começando a usá-la — e é o
  // primeiro comando que essa pessoa roda.
  const repo = tmpRepo();
  runCli(repo.dir, ['init']);
  const r = start(repo.dir, ['--json']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.blocked, false);
  assert.ok(j.notes.some((n) => n.includes('ainda não há retrato')));
  repo.cleanup();
});

test('retrato à frente do publicado não bloqueia (o falso positivo real)', () => {
  // Trabalho local ainda não pushado. Onde o push é deliberado esse é o caso
  // comum, e a primeira versão desta regra — que media uma direção só —
  // bloqueava a primeira abertura depois de um fechamento sem push.
  const repo = tmpRepoWithRemote();
  repo.write('src/a.mjs', 'export const x = 1;\n');
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'trabalho local, sem push');
  runCli(repo.dir, ['init']);
  withSnapshot(repo);

  const r = start(repo.dir, ['--json']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.blocked, false);
  assert.equal(j.measured.snapshot.relation_to_published, 'ahead');
  repo.cleanup();
});

test('retrato numa linha divergente bloqueia', () => {
  // O negativo simétrico do anterior: alguém empurrou na main, e este clone
  // commitou por cima de uma base anterior sem buscar. Nenhum dos dois contém
  // o outro — é o único caso que a regra chama de `stale`.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  repo.pushFrom('main', 'de-fora.txt');
  repo.write('src/b.mjs', 'export const y = 2;\n');
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'outra linha');
  repo.git('fetch', '-q', 'origin');
  withSnapshot(repo);

  const r = start(repo.dir, ['--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.equal(j.measured.snapshot.relation_to_published, 'diverged');
  assert.ok(j.reasons.some((m) => m.startsWith('snapshot_stale:')));
  repo.cleanup();
});

test('branch remota que este clone nunca viu bloqueia', () => {
  // O acidente que motivou a camada, com Git de verdade e sem `gh`: existe
  // trabalho no remoto que o retrato, por ser imutável, não tem como conhecer.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  withSnapshot(repo);
  repo.pushFrom('fix/estabilizacao', 'trabalho.txt');

  const r = start(repo.dir, ['--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.ok(j.reasons.some((m) => m.includes('fix/estabilizacao')));
  assert.equal(j.detectors.queue_hidden.fired, true);
  repo.cleanup();
});

test('constraint apagada em silêncio bloqueia; aposentada libera', () => {
  // Contra o histórico Git de verdade, que é a única fonte capaz de dizer que
  // um id EXISTIU. É o teste que prova que o detector não é decorativo.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  repo.write('.agents/constraints.yaml', CONSTRAINTS(['trava-a', 'trava-b']));
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'duas travas');
  withSnapshot(repo);

  repo.write('.agents/constraints.yaml', CONSTRAINTS(['trava-a']));
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'apaga uma trava');
  const apagada = start(repo.dir, ['--json']);
  assert.equal(apagada.code, 1);
  assert.ok(
    JSON.parse(apagada.out).reasons.some((m) => m.includes('trava-b')),
  );

  // O simétrico: o MESMO id, agora aposentado de propósito.
  repo.write('.agents/constraints.yaml', CONSTRAINTS(['trava-a'], ['trava-b']));
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'aposenta a trava');
  const aposentada = start(repo.dir, ['--json']);
  assert.equal(aposentada.code, 0, aposentada.err);
  assert.equal(
    JSON.parse(aposentada.out).detectors.constraint_dropped.fired,
    false,
  );
  repo.cleanup();
});

test('--json imprime JSON puro e não chama o brief', () => {
  // A saída precisa continuar parseável; o brief no meio dela a quebraria.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  withSnapshot(repo);
  const r = start(repo.dir, ['--json']);
  assert.doesNotThrow(() => JSON.parse(r.out));
  assert.doesNotMatch(r.out, /RETRATO/);
  repo.cleanup();
});

test('o veredito vem ANTES do brief', () => {
  // A ordem é a regra, não estética: foi lendo o retrato como estado atual que
  // três sessões erraram. O retrato é a fonte mais fraca e vai por último.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  withSnapshot(repo);
  const r = start(repo.dir);
  assert.equal(r.code, 0, r.err);
  const veredito = r.out.indexOf('LIVRE');
  const aviso = r.out.indexOf('não o estado atual');
  // Marcador exclusivo do brief: `run_id` sozinho não serve, aparece antes no
  // JSON da medição.
  const brief = r.out.indexOf('── retrato ──');
  assert.ok(veredito > -1 && aviso > -1 && brief > -1);
  assert.ok(veredito < aviso && aviso < brief);
  repo.cleanup();
});

test('sem origin, a relação não é medida e isso NÃO bloqueia', () => {
  // Não conseguir medir é diferente de medir e achar errado.
  const repo = tmpRepo();
  runCli(repo.dir, ['init']);
  withSnapshot(repo);
  const r = start(repo.dir, ['--json']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.measured.snapshot.relation_to_published, null);
  assert.equal(j.detectors.snapshot_stale.fired, false);
  assert.equal(j.measured.remote_read, false);
  repo.cleanup();
});

test('sem releaseBaseUrl configurada, o start não toca a rede', () => {
  // O default é `null`. Sem este teste, um default futuro reintroduziria uma
  // chamada de rede na suíte inteira sem ninguém notar.
  const repo = tmpRepo();
  runCli(repo.dir, ['init']);
  const cfg = JSON.parse(repo.read('.agents/handoff.config.json'));
  assert.equal(cfg.audit.releaseBaseUrl, null);
  withSnapshot(repo);
  const j = JSON.parse(start(repo.dir, ['--json']).out);
  assert.equal(j.measured.published, null);
  assert.equal(j.detectors.production_unverified.fired, true);
  assert.equal(j.detectors.production_unverified.blocking, false);
  repo.cleanup();
});

test('formato inválido do constraints.yaml avisa, nunca bloqueia', () => {
  // Validar formato não é medir estado. Um bloqueio por YAML feio é o alarme
  // que ensina a contornar o mecanismo.
  const repo = tmpRepoWithRemote();
  runCli(repo.dir, ['init']);
  repo.write(
    '.agents/constraints.yaml',
    'version: 1\nconstraints:\n  - id: TRAVA_MAIUSCULA\n    resumo: "x"\nretired: []\n',
  );
  repo.git('add', '-A');
  repo.git('commit', '-qm', 'trava malformada');
  withSnapshot(repo);
  const r = start(repo.dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /kebab-case/);
  repo.cleanup();
});
