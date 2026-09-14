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
  --suggested-rank 2 --reason "Falha reproduzida"

# somente após aprovação explícita do condutor
npx vibecora-handoff task approve <proposal-id> \
  --approval-ref "codex-thread:<referência-estável>"

# reivindica a primeira tarefa executável
npx vibecora-handoff task next --owner <agente> \
  --quota-remaining 18 --context-remaining unknown
```

`task propose remove` exige `--consequence`. `task propose reorder` exige
`--suggested-rank`. Nenhuma das duas altera a fila antes de `task approve`.
Dependências são repetidas com `--depends-on`.

## Estados

`draft` → `approved` → `active` → `ready` → `done`. Uma remoção aprovada leva
a `removed` sem apagar o histórico. Bloqueio é derivado de dependências não
concluídas ou de impedimento registrado; não muda a prioridade.

## Recursos e checkpoint

A medição só ocorre em `task next` e é reutilizada por até 15 minutos. Valores
devem vir de uma fonte confiável do host; o que não puder ser medido fica
`unknown`. Se qualquer recurso conhecido estiver em 20% ou menos, um checkpoint
cifrado é persistido no mesmo commit do claim, antes de a tarefa ser liberada.

`task arm --owner <agente> --claim-epoch <n>` força um checkpoint da tarefa ativa. `task resume` mostra os casos
retomáveis; `task resume --claim <id> --owner <agente>` restaura o estado em uma
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
npx vibecora-handoff task finish --task-id <id> --owner <agente> --claim-epoch <n>

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
