import { CHANGE_CLASSES } from './classify.mjs';

// Schema e validação do handoff v3. Determinístico e offline. Não conhece
// ROADMAP nem plataforma — isso é do consumidor / do `audit`.

export const CODE_STATES = [
  'working_tree',
  'local_commit',
  'pushed_branch',
  'merged_main',
];
export const RELEASE_INTENTS = ['not_requested', 'requested', 'authorized'];
export const ROADMAP_STATES = ['updated', 'not_applicable'];
export const TEST_RESULTS = ['pass', 'fail', 'partial', 'not_run'];
export const REMAINING_STATES = ['ready', 'blocked', 'deferred'];
export const CLAIM_BASES = ['verified', 'observed', 'assumed', 'unknown'];
export const OPERATIONS = [
  'analyze',
  'diagnose',
  'implement',
  'review',
  'test',
  'refactor',
  'document',
  'other',
];

function requireString(value, path, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path} deve ser uma string não vazia.`);
  }
}

function requireEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} deve ser um de: ${allowed.join(', ')}.`);
  }
}

function requireStringArray(value, path, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} deve ser uma lista de strings.`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    errors.push(`${path} deve listar ao menos um item.`);
  }
  value.forEach((item, i) => requireString(item, `${path}[${i}]`, errors));
}

export function validateSchema(handoff, errors) {
  if (handoff.version !== 3) {
    errors.push('version deve ser 3.');
  }
  for (const field of ['run_id', 'recorded_at', 'branch', 'task_class']) {
    requireString(handoff[field], field, errors);
  }
  requireEnum(handoff.operation, OPERATIONS, 'operation', errors);

  requireString(handoff.agent_runtime?.agent, 'agent_runtime.agent', errors);
  requireString(handoff.agent_runtime?.model, 'agent_runtime.model', errors);
  requireString(
    handoff.agent_runtime?.environment,
    'agent_runtime.environment',
    errors,
  );

  if (!Array.isArray(handoff.change_class) || handoff.change_class.length === 0) {
    errors.push('change_class deve listar ao menos uma classe.');
  } else {
    const seen = new Set();
    handoff.change_class.forEach((cls, i) => {
      if (!CHANGE_CLASSES.includes(cls)) {
        errors.push(
          `change_class[${i}] deve ser um de: ${CHANGE_CLASSES.join(', ')}.`,
        );
      }
      if (seen.has(cls)) errors.push(`change_class[${i}] repete "${cls}".`);
      seen.add(cls);
    });
  }

  requireString(handoff.delivery?.task, 'delivery.task', errors);
  requireStringArray(handoff.delivery?.completed, 'delivery.completed', errors);

  requireEnum(handoff.code?.state, CODE_STATES, 'code.state', errors);
  requireString(handoff.code?.commit, 'code.commit', errors);

  requireEnum(handoff.release_intent, RELEASE_INTENTS, 'release_intent', errors);

  requireStringArray(handoff.tests?.ran, 'tests.ran', errors);
  requireEnum(handoff.tests?.result, TEST_RESULTS, 'tests.result', errors);

  requireEnum(handoff.roadmap?.status, ROADMAP_STATES, 'roadmap.status', errors);
  if (
    handoff.roadmap?.status === 'updated' &&
    (!Array.isArray(handoff.roadmap?.sections) ||
      handoff.roadmap.sections.length === 0)
  ) {
    errors.push('roadmap.sections deve listar o que foi atualizado.');
  }
  if (handoff.roadmap?.status === 'not_applicable' && !handoff.roadmap?.reason) {
    errors.push('roadmap.reason explica por que não se aplica.');
  }

  if (!Array.isArray(handoff.decisions)) {
    errors.push('decisions deve ser uma lista, mesmo que vazia.');
  } else {
    handoff.decisions.forEach((item, i) => {
      requireString(item?.decision, `decisions[${i}].decision`, errors);
      requireString(item?.rationale, `decisions[${i}].rationale`, errors);
    });
  }

  requireStringArray(handoff.risks, 'risks', errors, { allowEmpty: true });
  requireStringArray(handoff.assumptions, 'assumptions', errors, {
    allowEmpty: true,
  });

  if (!Array.isArray(handoff.remaining)) {
    errors.push('remaining deve ser uma lista, mesmo quando vazia.');
  } else {
    handoff.remaining.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`remaining[${i}] deve ser um objeto estruturado.`);
        return;
      }
      requireString(item.task, `remaining[${i}].task`, errors);
      requireString(item.owner, `remaining[${i}].owner`, errors);
      requireEnum(item.status, REMAINING_STATES, `remaining[${i}].status`, errors);
      if (typeof item.blocking !== 'boolean') {
        errors.push(`remaining[${i}].blocking deve ser booleano.`);
      }
    });
  }

  if (!Array.isArray(handoff.context) || handoff.context.length === 0) {
    errors.push('context deve conter claims com base explícita.');
  } else {
    handoff.context.forEach((item, i) => {
      requireString(item?.claim, `context[${i}].claim`, errors);
      requireEnum(item?.basis, CLAIM_BASES, `context[${i}].basis`, errors);
      // Integridade de evidência: verified/observed exigem evidência concreta.
      if (
        (item?.basis === 'verified' || item?.basis === 'observed') &&
        (typeof item?.evidence !== 'string' || item.evidence.trim().length < 3)
      ) {
        errors.push(
          `context[${i}].evidence é obrigatório e concreto quando basis é "${item.basis}".`,
        );
      } else {
        requireString(item?.evidence, `context[${i}].evidence`, errors);
      }
    });
  }
}

function validateRunEvent(handoff, performanceEvents, errors) {
  const matching = performanceEvents.filter(
    (e) => e.event === 'run_completed' && e.run_id === handoff.run_id,
  );
  if (matching.length === 0) {
    errors.push('performance.jsonl não contém run_completed para este run_id.');
    return;
  }
  if (matching.length > 1) {
    errors.push(
      `performance.jsonl tem ${matching.length} run_completed para "${handoff.run_id}" (append-only violado).`,
    );
  }
  const runEvent = matching[matching.length - 1];
  for (const [field, expected] of [
    ['task_class', handoff.task_class],
    ['operation', handoff.operation],
    ['commit', handoff.code?.commit],
    ['code_state', handoff.code?.state],
    ['release_intent', handoff.release_intent],
    ['roadmap_status', handoff.roadmap?.status],
  ]) {
    if (runEvent[field] !== expected) {
      errors.push(
        `run_completed.${field} deve coincidir com o handoff (${String(expected)}).`,
      );
    }
  }
}

// `git` (opcional): { changedPaths: string[], commitExists(sha), mainContains(sha) }
// `classifier` (opcional): de makeClassifier(config)
function validateGitCoherence(handoff, git, classifier, errors) {
  if (!git) return;
  const commit = handoff.code?.commit;
  if (
    commit &&
    typeof git.commitExists === 'function' &&
    !git.commitExists(commit)
  ) {
    errors.push(`code.commit ${commit} não existe no repositório local.`);
  }
  if (
    handoff.code?.state === 'merged_main' &&
    commit &&
    typeof git.mainContains === 'function' &&
    !git.mainContains(commit)
  ) {
    errors.push(`code.state=merged_main mas ${commit} não é ancestral de main.`);
  }
  // change_class: só a direção "classe tocada tem que estar declarada".
  // Declarar mais que o diff imediato é legítimo (o retrato resume a sessão).
  if (
    classifier &&
    Array.isArray(git.changedPaths) &&
    git.changedPaths.length > 0
  ) {
    const touched = classifier.classifyPaths(git.changedPaths, {
      onUnknown: () => {},
    });
    const declared = new Set(handoff.change_class || []);
    for (const cls of touched) {
      if (!declared.has(cls)) {
        errors.push(
          `change_class não inclui "${cls}", mas o diff toca arquivos dessa classe.`,
        );
      }
    }
  }
}

export function validateHandoff({
  handoff,
  performanceEvents = [],
  git,
  classifier,
}) {
  const errors = [];
  validateSchema(handoff, errors);
  validateRunEvent(handoff, performanceEvents, errors);
  validateGitCoherence(handoff, git, classifier, errors);
  return errors;
}

// Evento a partir do retrato (usado pelo `finalize`).
export function buildRunEvent(handoff, { result } = {}) {
  const tr = handoff.tests?.result;
  return {
    event: 'run_completed',
    run_id: handoff.run_id,
    timestamp: handoff.recorded_at,
    agent: handoff.agent_runtime?.agent,
    model: handoff.agent_runtime?.model,
    task: handoff.delivery?.task?.trim?.() ?? handoff.delivery?.task,
    task_class: handoff.task_class,
    operation: handoff.operation,
    result:
      result ||
      (tr === 'pass'
        ? 'success'
        : tr === 'fail'
          ? 'failed'
          : tr === 'not_run'
            ? 'unknown'
            : 'partial'),
    tests: tr === 'partial' ? 'fail' : tr || 'unknown',
    commit: handoff.code?.commit,
    code_state: handoff.code?.state,
    release_intent: handoff.release_intent,
    roadmap_status: handoff.roadmap?.status,
  };
}
