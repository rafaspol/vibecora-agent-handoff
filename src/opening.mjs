// A REGRA da abertura de sessão. Sem E/S: recebe leituras já feitas e devolve o
// veredito. Quem lê o mundo é `src/commands/start.mjs` — a mesma divisão de
// `classify.mjs`/`commands/new.mjs` e `reconcile.mjs`/`commands/audit.mjs`.
//
// O problema que isto resolve: o fechamento do handoff tem gate (o `check` roda
// no CI de quem adota), mas a abertura era prosa. Num projeto real o mesmo
// acidente aconteceu TRÊS vezes: um retrato CORRETO foi lido como se fosse o
// estado atual. Na terceira, o resumo dizia "não há fila" enquanto vinte
// commits esperavam numa branch, com uma PR aberta ao lado. Nenhum gate
// pegaria: o retrato não estava errado — a fonte é que estava.
//
// Precedência das fontes, do mais forte para o mais fraco:
//   medição ao vivo > constraints.yaml > retrato (intenção, nunca estado)
//   > telemetria (fora do caminho de leitura)
//
// Por que só três detectores bloqueiam: um bloqueio na abertura que erra ou que
// ninguém mantém ensina o agente a passar por cima, e aí é pior que não
// existir. Bloqueia só o que é fato barato e sem ambiguidade. O resto informa.
//
// E a regra de desligamento é parte do desenho: se um bloqueio atrapalhar duas
// vezes seguidas sem ter razão, o certo é DESLIGÁ-LO e deixar só o relatório,
// não "ajustar o limiar". Um detector que vira ritual de contorno já não mede
// nada.

export const DETECTORS = [
  'queue_hidden',
  'snapshot_stale',
  'constraint_dropped',
  'production_unverified',
  'remote_ahead',
];

// Deliberadamente FORA desta lista: `remote_ahead`. É tentador bloquear quando
// o remoto está à frente, mas esse é o estado normal de quem ainda não deu
// `pull` — alarme que grita sempre é alarme desligado, e aí perde-se o caso
// que importa.
export const BLOCKING = new Set([
  'queue_hidden',
  'snapshot_stale',
  'constraint_dropped',
]);

// Relação entre o commit do retrato e o que está publicado. `null` quer dizer
// "não deu para medir", que NÃO é o mesmo que "medi e está errado".
export const SNAPSHOT_RELATIONS = ['contained', 'ahead', 'diverged'];

const list = (v) => (Array.isArray(v) ? v : []);

// Trabalho aberto que o retrato, por definição, não pode conhecer: uma PR
// aberta ou uma branch que existe no remoto e nunca chegou a este clone.
function queueHidden({ openPrs, missingBranches }) {
  const prs = list(openPrs);
  const branches = list(missingBranches);
  if (!prs.length && !branches.length) return null;
  const parts = [];
  if (prs.length) {
    parts.push(
      `${prs.length} PR(s) aberta(s): ${prs
        .map((pr) => `#${pr.number} ${pr.title ?? ''}`.trim())
        .join('; ')}`
    );
  }
  if (branches.length) {
    parts.push(
      `${branches.length} branch(es) no remoto ausente(s) do clone: ${branches.join(', ')}`
    );
  }
  return `há trabalho aberto que o retrato não conhece — ${parts.join(' e ')}`;
}

// O retrato aponta para uma linha de histórico que não é a publicada. Ler um
// retrato assim como estado atual é o acidente que motivou esta camada.
//
// A medição é BIDIRECIONAL, e essa é a parte que erra fácil: um retrato à
// frente do publicado é trabalho local ainda não pushado — caso comum, e em
// muitos projetos o mais comum. Só a divergência de verdade (nenhum dos dois
// contém o outro) é `stale`. A primeira versão desta regra olhava uma direção
// só e bloqueou a primeira abertura real depois de um fechamento sem push.
//
// Retrato AUSENTE é diferente de retrato sem commit: o primeiro é um projeto
// que ainda não gravou o dele — a situação de quem acabou de rodar `init`, e
// bloqueá-la faria a ferramenta reprovar quem está começando a usá-la. O
// segundo é um retrato quebrado, e esse bloqueia.
function snapshotStale({ snapshotPresent, snapshotCommit, snapshotRelation }) {
  if (!snapshotCommit) {
    return snapshotPresent === false ? null : 'o retrato não declara commit.';
  }
  if (snapshotRelation === 'diverged') {
    return `o commit do retrato (${snapshotCommit}) não está na linha do publicado, nem à frente dela — ele descreve outra linha de histórico.`;
  }
  return null;
}

// Uma trava só some por edição explícita, e edição explícita move o id para
// `retired`. Sumir do arquivo sem passar por lá é o apagamento silencioso que
// custou sessões quando as travas moravam dentro do retrato.
function constraintDropped({
  currentConstraints,
  historicalConstraints,
  retiredConstraints,
}) {
  const current = new Set(list(currentConstraints));
  const retired = new Set(list(retiredConstraints));
  const gone = list(historicalConstraints).filter(
    (id) => !current.has(id) && !retired.has(id)
  );
  if (!gone.length) return null;
  const unique = [...new Set(gone)];
  return `constraint(s) que existiam sumiram sem entrar em \`retired\`: ${unique.join(', ')}`;
}

// Informa, não bloqueia: rodar sem a fonte publicada configurada é o caso
// normal, e transformar isso em falha atrapalharia quem apenas ainda não a
// configurou.
function productionUnverified({ productionChecked }) {
  return productionChecked
    ? null
    : 'o estado publicado não foi consultado nesta abertura — o que você souber dele vem do retrato, que é intenção, não estado.';
}

function remoteAhead({ commitsBehind }) {
  if (!commitsBehind) return null;
  return `o remoto está ${commitsBehind} commit(s) à frente do clone — rode \`git pull\` antes de trabalhar.`;
}

const RULES = {
  queue_hidden: queueHidden,
  snapshot_stale: snapshotStale,
  constraint_dropped: constraintDropped,
  production_unverified: productionUnverified,
  remote_ahead: remoteAhead,
};

// Nota informativa que não é detector: o projeto ainda não tem retrato. Dita
// aqui, e não no comando, para o texto viver junto da regra que a dispensa.
function firstRunNote({ snapshotPresent }) {
  return snapshotPresent === false
    ? 'ainda não há retrato neste projeto — rode `vibecora-handoff new` para gravar o primeiro.'
    : null;
}

// Devolve { blocked, reasons, notes, detectors }.
// `detectors` traz TODOS os detectores, disparados ou não, para o relatório
// mostrar o que foi olhado — e não só o que deu ruim.
export function evaluateOpening(readings = {}) {
  const detectors = {};
  const reasons = [];
  const notes = [];

  for (const name of DETECTORS) {
    const reason = RULES[name](readings);
    const blocking = BLOCKING.has(name);
    detectors[name] = {
      fired: Boolean(reason),
      blocking,
      reason: reason || null,
    };
    if (!reason) continue;
    if (blocking) reasons.push(`${name}: ${reason}`);
    else notes.push(`${name}: ${reason}`);
  }

  const first = firstRunNote(readings);
  if (first) notes.unshift(first);

  return { blocked: reasons.length > 0, reasons, notes, detectors };
}
