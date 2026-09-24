# Fila compartilhada e continuidade preventiva

O ledger Git privado é a fonte canônica das tarefas. `events.jsonl` é
append-only; `board.json` e `BOARD.md` são projeções geradas pelo reducer. O
roadmap pode ser referenciado por uma tarefa, mas não replica posição,
responsável nem estado.

## Fluxo

```bash
# leitura canônica, também disponível em --json
npx vibecora-handoff task list

# descoberta: cria rascunho e proposta, sem mudar a fila
npx vibecora-handoff task propose add \
  --task-id corrigir-login --title "Corrigir login" \
  --objective "Restaurar o login" --done-when "Fluxo verificado" \
  --suggested-rank 2 --reason "Falha reproduzida" \
  --agent-type codex --agent-id <instância>

# somente após aprovação explícita do condutor; quem registra se identifica
npx vibecora-handoff task approve <proposal-id> \
  --approval-ref "codex-thread:<referência-estável>" \
  --approval-summary "O que o condutor decidiu, em uma frase" \
  --agent-type codex --agent-id <instância>

# ou a recusa, com o motivo e onde o condutor a decidiu
npx vibecora-handoff task reject <proposal-id> \
  --reason "Duplica outra tarefa" \
  --rejection-ref "codex-thread:<referência-estável>"

# reivindica a primeira tarefa executável
npx vibecora-handoff task next --agent-type codex --agent-id <instância> \
  --quota-remaining 18 --context-remaining unknown
```

`task propose remove` exige `--consequence`. `task propose reorder` exige
`--suggested-rank`. Nenhuma das duas altera a fila antes de `task approve`.
Dependências são repetidas com `--depends-on`.

### Proveniência da aprovação

`task approve` grava `approvedBy: <condutor>` e a referência, como sempre, e
também **quem registrou** (`recordedBy`, a identidade do agente, quando
informada) e **em que a aprovação se apoia** (`approvalBasis`):

| Base | Referência | Exigência |
|---|---|---|
| `document` | `ledger:<caminho no ledger>` | o arquivo existe no ledger na hora do registro |
| `delegation` | uma referência listada em `tasks.delegationRefs` | — |
| `conversation` | qualquer outra (conversa, quiz, thread) | `--approval-summary` com a decisão do condutor, até 280 caracteres |

Só `document` é algo que o sucessor abre. As outras duas são **declaradas** por
quem registrou: o `task list` e o `BOARD.md` dizem isso na linha da tarefa
(`aprovação declarada (conversa; codex:abc12345)`). Nada disto prova que o
condutor aprovou; o que muda é que o texto autodeclarado deixa de se passar por
autenticação. Aprovações anteriores a este registro são classificadas pelo
prefixo da referência e aparecem como `registro anterior à proveniência`, sem
reescrever o histórico. A projeção do quadro (`boardProjection`) não muda.

`task reject` é a outra resposta à mesma proposta, e também só registra decisão
do condutor. Exige `--reason` e `--rejection-ref`; grava `proposal_rejected`
com autor, referência, motivo e data, sem apagar nada. A inclusão recusada leva
o rascunho a `rejected`, que sai dos rascunhos e aparece no histórico; recusar
remoção ou reordenação deixa a fila como estava. Proposta decidida, aprovada
ou recusada, não aceita outra decisão, e o id de uma tarefa recusada não volta
a ser proposto: uma nova tentativa usa id novo. `task list` mostra as recusas
em seção própria.

**Compatibilidade.** Um reducer anterior à 0.4.1 recusa evento desconhecido, e
um único `proposal_rejected` no ledger derruba a leitura da fila em todo clone
que ainda estiver numa versão anterior. Atualize os consumidores do ledger
antes da primeira recusa.

A identidade vem primeiro de `--agent-type/--agent-id`, depois de
`VIBECORA_AGENT_TYPE/VIBECORA_AGENT_ID`. No Codex, `CODEX_THREAD_ID` é detectado
automaticamente. Tipo e instância são obrigatórios para criar ou reivindicar.

Cada tarefa expõe a data e o agente de origem, `queuedAt` após aprovação,
claims estruturados e `implementedBy` quando chega a `ready`. `task list`
calcula a idade em dias completos a partir da origem, sem reordenar ou remover:
antiguidade só pode motivar uma proposta sujeita à aprovação normal.

Um impedimento factual é registrado com
`task block --task-id <id> --reason <motivo>` e removido com `task unblock`.
Isso não muda a posição da tarefa.

## Estados

`draft` → `approved` → `active` → `ready` → `done`; `draft` → `rejected` quando a
inclusão é recusada. Uma remoção aprovada leva
a `removed` sem apagar o histórico. Bloqueio é derivado de dependências não
concluídas ou de impedimento registrado; não muda a prioridade.

## Recursos e checkpoint

A medição só ocorre em `task next` e é reutilizada por até 15 minutos. Valores
devem vir de uma fonte confiável do host; o que não puder ser medido fica
`unknown`. Se qualquer recurso conhecido estiver em 20% ou menos, um checkpoint
cifrado é persistido no mesmo commit do claim, antes de a tarefa ser liberada.

`task arm --agent-type <tipo> --agent-id <id> --claim-epoch <n>` força um checkpoint da tarefa ativa. `task resume` mostra os casos
retomáveis; `task resume --claim <id> --agent-type <tipo> --agent-id <id>` restaura o estado em uma
worktree isolada e só então conclui a transferência no ledger. Claims
concorrentes usam push fast-forward: há um vencedor.

Os checkpoints usam AES-256-GCM e uma chave de 32 bytes em
`VIBE_CORA_TASK_KEY` ou, por padrão,
`~/.config/vibecora-agent-handoff/task-key`. A chave nunca pertence ao ledger.
Arquivos de credencial são recusados e o artefato cifrado não pode exceder
25 MiB.

## Fechamento

```bash
# árvore limpa; registra o HEAD candidato
npx vibecora-handoff task finish --task-id <id> \
  --agent-type <tipo> --agent-id <id> --claim-epoch <n>

# depois de o commit candidato estar em main/origin/main
npx vibecora-handoff task finish --task-id <id> --integrated
```

`ready` significa concluída e verificada, aguardando integração. `done` exige
ancestralidade Git verificável.

Se um agente antigo terminar depois da transferência, ele informa seu
`--claim-epoch`; o resultado é preservado como candidato alternativo com o
merge-base calculado, sem substituir o responsável atual.

## Configuração

```jsonc
{
  "tasks": {
    "enabled": true,
    "project": "meu-projeto",
    "ledger": "https://github.com/owner/estado-privado.git",
    "branch": "main",
    "conductor": "@usuario",
    "thresholdPercent": 20,
    "measurementCacheMinutes": 15,
    "maxCheckpointBytes": 26214400
  }
}
```

O ledger precisa existir e ter a branch configurada. O CLI não inicia agentes,
não consulta recursos sem uma fonte exposta pelo host e não autoriza deploy,
merge ou publicação.
