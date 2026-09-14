const TASK_STATES = new Set([
  'draft',
  'approved',
  'active',
  'ready',
  'done',
  'removed',
]);

export function emptyBoard(project) {
  return {
    version: 1,
    project,
    lastEventAt: null,
    queue: [],
    tasks: {},
    proposals: {},
    eventCount: 0,
  };
}

function requireTask(board, taskId) {
  const task = board.tasks[taskId];
  if (!task) throw new Error(`Tarefa inexistente: ${taskId}.`);
  return task;
}

function requireProposal(board, proposalId) {
  const proposal = board.proposals[proposalId];
  if (!proposal) throw new Error(`Proposta inexistente: ${proposalId}.`);
  return proposal;
}

function validTaskId(value) {
  return (
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(value || '') &&
    !value.includes('..')
  );
}

function normalizedRank(value, length) {
  const rank = Number(value);
  if (!Number.isInteger(rank)) return length + 1;
  return Math.max(1, Math.min(rank, length + 1));
}

function insertAt(queue, taskId, rank) {
  const next = queue.filter((id) => id !== taskId);
  next.splice(normalizedRank(rank, next.length) - 1, 0, taskId);
  return next;
}

function applyApproval(board, proposal, event) {
  if (proposal.status !== 'pending') {
    throw new Error(`A proposta ${proposal.id} já foi decidida.`);
  }
  proposal.status = 'approved';
  proposal.approval = {
    by: event.approvedBy,
    ref: event.approvalRef,
    at: event.at,
  };

  if (proposal.kind === 'add') {
    const task = requireTask(board, proposal.taskId);
    if (task.status !== 'draft') {
      throw new Error(`A tarefa ${task.id} não está em rascunho.`);
    }
    task.status = 'approved';
    task.approval = proposal.approval;
    board.queue = insertAt(board.queue, task.id, proposal.suggestedRank);
    return;
  }

  if (proposal.kind === 'remove') {
    const task = requireTask(board, proposal.taskId);
    if (['done', 'removed'].includes(task.status)) {
      throw new Error(`A tarefa ${task.id} já está ${task.status}.`);
    }
    task.status = 'removed';
    task.removal = {
      consequence: proposal.consequence,
      approval: proposal.approval,
    };
    board.queue = board.queue.filter((id) => id !== task.id);
    return;
  }

  if (proposal.kind === 'reorder') {
    const task = requireTask(board, proposal.taskId);
    if (!board.queue.includes(task.id)) {
      throw new Error(`A tarefa ${task.id} não pertence à fila aprovada.`);
    }
    board.queue = insertAt(board.queue, task.id, proposal.suggestedRank);
    return;
  }

  throw new Error(`Tipo de proposta desconhecido: ${proposal.kind}.`);
}

export function reduceTaskEvents(events, { project = 'unknown' } = {}) {
  const board = emptyBoard(project);
  const eventIds = new Set();

  for (const event of events) {
    if (!event || typeof event !== 'object') throw new Error('Evento inválido.');
    if (!event.id || eventIds.has(event.id)) {
      throw new Error(`Evento sem id único: ${event.id || 'ausente'}.`);
    }
    eventIds.add(event.id);
    board.eventCount += 1;
    board.lastEventAt = event.at || board.lastEventAt;

    if (event.type === 'task_drafted') {
      if (!validTaskId(event.task?.id)) {
        throw new Error(`Id de tarefa inválido: ${event.task?.id || 'ausente'}.`);
      }
      if (board.tasks[event.task.id]) {
        throw new Error(`Tarefa duplicada: ${event.task.id}.`);
      }
      if (!event.proposal?.id || board.proposals[event.proposal.id]) {
        throw new Error(`Proposta duplicada ou ausente: ${event.proposal?.id || 'ausente'}.`);
      }
      const task = {
        ...event.task,
        status: 'draft',
        owner: null,
        claimEpoch: 0,
        claims: [],
        checkpoint: null,
        alternateCandidates: [],
        impediment: null,
        createdAt: event.at,
      };
      if (!TASK_STATES.has(task.status)) throw new Error('Estado de tarefa inválido.');
      board.tasks[task.id] = task;
      board.proposals[event.proposal.id] = {
        ...event.proposal,
        taskId: task.id,
        kind: 'add',
        status: 'pending',
        createdAt: event.at,
      };
    } else if (event.type === 'proposal_created') {
      if (board.proposals[event.proposal.id]) {
        throw new Error(`Proposta duplicada: ${event.proposal.id}.`);
      }
      requireTask(board, event.proposal.taskId);
      board.proposals[event.proposal.id] = {
        ...event.proposal,
        status: 'pending',
        createdAt: event.at,
      };
    } else if (event.type === 'proposal_approved') {
      applyApproval(board, requireProposal(board, event.proposalId), event);
    } else if (event.type === 'task_claimed') {
      const task = requireTask(board, event.taskId);
      if (!['approved', 'active'].includes(task.status)) {
        throw new Error(`A tarefa ${task.id} não pode ser reivindicada em ${task.status}.`);
      }
      if (event.claimEpoch !== task.claimEpoch + 1) {
        throw new Error(`Época de claim inválida para ${task.id}.`);
      }
      task.status = 'active';
      task.owner = event.owner;
      task.claimEpoch = event.claimEpoch;
      task.claimedAt = event.at;
      task.measurement = event.measurement || null;
      task.claims.push({
        owner: event.owner,
        claimEpoch: event.claimEpoch,
        at: event.at,
      });
    } else if (event.type === 'checkpoint_armed') {
      const task = requireTask(board, event.taskId);
      task.checkpoint = { ...event.checkpoint, at: event.at };
    } else if (event.type === 'task_ready') {
      const task = requireTask(board, event.taskId);
      if (
        task.status !== 'active' ||
        task.owner !== event.owner ||
        task.claimEpoch !== event.claimEpoch
      ) {
        throw new Error(`Somente o responsável atual pode concluir ${task.id}.`);
      }
      task.status = 'ready';
      task.candidateCommit = event.candidateCommit;
      task.readyAt = event.at;
    } else if (event.type === 'task_alternate_candidate') {
      const task = requireTask(board, event.taskId);
      const claim = task.claims.find(
        (item) =>
          item.owner === event.owner && item.claimEpoch === event.claimEpoch,
      );
      if (!claim || event.claimEpoch >= task.claimEpoch) {
        throw new Error(`O candidato alternativo de ${task.id} não vem de claim anterior.`);
      }
      task.alternateCandidates.push({
        owner: event.owner,
        claimEpoch: event.claimEpoch,
        candidateCommit: event.candidateCommit,
        mergeBase: event.mergeBase,
        at: event.at,
      });
    } else if (event.type === 'task_done') {
      const task = requireTask(board, event.taskId);
      if (task.status !== 'ready') {
        throw new Error(`A tarefa ${task.id} precisa estar ready antes de done.`);
      }
      task.status = 'done';
      task.doneAt = event.at;
      board.queue = board.queue.filter((id) => id !== task.id);
    } else if (event.type === 'task_impeded') {
      const task = requireTask(board, event.taskId);
      if (!['approved', 'active'].includes(task.status)) {
        throw new Error(`A tarefa ${task.id} não aceita impedimento em ${task.status}.`);
      }
      task.impediment = {
        reason: event.reason,
        at: event.at,
      };
    } else if (event.type === 'task_impediment_cleared') {
      const task = requireTask(board, event.taskId);
      if (!task.impediment) throw new Error(`A tarefa ${task.id} não tem impedimento.`);
      task.impediment = null;
    } else {
      throw new Error(`Tipo de evento desconhecido: ${event.type}.`);
    }
  }

  return board;
}

export function taskBlockers(board, task) {
  const dependencies = (task.dependencies || []).filter(
    (id) => board.tasks[id]?.status !== 'done',
  );
  return {
    dependencies,
    impediment: task.impediment?.reason || null,
    blocked: dependencies.length > 0 || Boolean(task.impediment),
  };
}

export function boardView(board) {
  const priorities = board.queue.map((id, index) => {
    const task = board.tasks[id];
    return {
      rank: index + 1,
      ...task,
      blockers: taskBlockers(board, task),
    };
  });
  const nextExecutable = priorities.find(
    (task) => task.status === 'approved' && !task.blockers.blocked,
  );
  const drafts = Object.values(board.tasks)
    .filter((task) => task.status === 'draft')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pendingProposals = Object.values(board.proposals)
    .filter((proposal) => proposal.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const history = Object.values(board.tasks).filter((task) =>
    ['done', 'removed'].includes(task.status),
  );
  const suggestedChanges = pendingProposals.map((proposal) => ({
    ...proposal,
    impact: proposalImpact(board, proposal),
  }));
  return {
    version: board.version,
    project: board.project,
    lastEventAt: board.lastEventAt,
    priorities,
    nextExecutable: nextExecutable || null,
    blockedPriorities: priorities.filter((task) => task.blockers.blocked),
    drafts,
    pendingProposals,
    suggestedChanges,
    history,
    recommendation:
      pendingProposals.length > 0
        ? 'Há mudanças aguardando aprovação; a fila vigente permanece inalterada.'
        : 'Sem mudança sugerida.',
  };
}

export function proposalImpact(board, proposal) {
  if (proposal.kind === 'add') {
    const effectiveRank = normalizedRank(proposal.suggestedRank, board.queue.length);
    return {
      suggestedRank: proposal.suggestedRank,
      effectiveRank,
      displaced: board.queue.slice(effectiveRank - 1),
    };
  }
  const currentRank = board.queue.indexOf(proposal.taskId) + 1;
  if (proposal.kind === 'remove') {
    return {
      currentRank: currentRank || null,
      consequence: proposal.consequence,
      promoted: currentRank ? board.queue.slice(currentRank) : [],
    };
  }
  if (proposal.kind === 'reorder') {
    const target = normalizedRank(proposal.suggestedRank, board.queue.length - 1);
    const without = board.queue.filter((id) => id !== proposal.taskId);
    const reordered = insertAt(without, proposal.taskId, target);
    return {
      currentRank: currentRank || null,
      suggestedRank: proposal.suggestedRank,
      effectiveRank: reordered.indexOf(proposal.taskId) + 1,
      displaced: reordered.filter(
        (id, index) => board.queue[index] !== id && id !== proposal.taskId,
      ),
    };
  }
  throw new Error(`Tipo de proposta desconhecido: ${proposal.kind}.`);
}

export function boardProjection(board) {
  const view = boardView(board);
  return {
    version: 1,
    project: view.project,
    lastEventAt: view.lastEventAt,
    priorities: view.priorities.map((task) => ({
      id: task.id,
      rank: task.rank,
      title: task.title,
      status: task.status,
      owner: task.owner,
      dependencies: task.dependencies || [],
      blockers: task.blockers,
      roadmapRef: task.roadmapRef || null,
      alternateCandidates: task.alternateCandidates,
    })),
    drafts: view.drafts.map((task) => ({
      id: task.id,
      title: task.title,
      suggestedRank: task.suggestedRank,
    })),
    pendingProposals: view.suggestedChanges.map((proposal) => ({
      id: proposal.id,
      kind: proposal.kind,
      taskId: proposal.taskId,
      impact: proposal.impact,
    })),
    history: view.history.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      doneAt: task.doneAt || null,
    })),
  };
}

export function renderBoardMarkdown(board) {
  const view = boardView(board);
  const lines = [
    `# Tarefas — ${view.project}`,
    '',
    '> Gerado mecanicamente de `events.jsonl`. Não edite à mão.',
    '',
    '## Fila aprovada',
    '',
  ];
  if (view.priorities.length === 0) lines.push('_Fila vazia._');
  for (const task of view.priorities) {
    const blocked = task.blockers.blocked
      ? ` — bloqueada: ${[
          ...task.blockers.dependencies.map((id) => `depende de ${id}`),
          task.blockers.impediment,
        ]
          .filter(Boolean)
          .join('; ')}`
      : '';
    lines.push(
      `${task.rank}. **${task.id} — ${task.title}** · ${task.status}${blocked}`,
    );
  }
  lines.push('', '## Rascunhos aguardando aprovação', '');
  if (view.drafts.length === 0) lines.push('_Nenhum._');
  for (const task of view.drafts) {
    lines.push(`- **${task.id} — ${task.title}** · posição sugerida ${task.suggestedRank}`);
  }
  lines.push('', '## Histórico', '');
  if (view.history.length === 0) lines.push('_Nenhuma tarefa encerrada._');
  for (const task of view.history) {
    lines.push(`- **${task.id} — ${task.title}** · ${task.status}`);
  }
  lines.push('', `Mudança sugerida: ${view.recommendation}`, '');
  return lines.join('\n');
}
