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

# somente após aprovação explícita do condutor
npx vibecora-handoff task approve <proposal-id> \
  --approval-ref "codex-thread:<referência-estável>"

# reivindica a primeira tarefa executável
npx vibecora-handoff task next --agent-type codex --agent-id <instância> \
  --quota-remaining 18 --context-remaining unknown
```

`task propose remove` exige `--consequence`. `task propose reorder` exige
`--suggested-rank`. Nenhuma das duas altera a fila antes de `task approve`.
Dependências são repetidas com `--depends-on`.

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

`draft` → `approved` → `active` → `ready` → `done`. Uma remoção aprovada leva
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

### Isolamento e ciclo de vida do ledger

Cada operação usa um clone temporário privado, inclusive `list` e `resume`
sem claim. `cacheDir` (ou o caminho derivado de `VIBE_CORA_TASK_CACHE`) é
somente um namespace: o clone fica em um diretório irmão
`<cacheDir>.operation-<sufixo aleatório>`, criado atomicamente. Um cache antigo
ou conteúdo do chamador nesse caminho não é reutilizado, limpo ou sobrescrito.
Isso evita também corridas durante o primeiro clone. O custo é um clone por
operação, sem aceleração por cache compartilhado.

A pequena cache de medições permanece separada em
`<cacheDir>.measurements/<projeto>.json`, com substituição atômica de cada
amostra completa. Ela preserva a reutilização por quinze minutos, mas não
contém checkout, eventos nem checkpoints e não participa da transação Git.
Escritas concorrentes usam a última substituição concluída. Interrupção durante
uma escrita pode deixar um arquivo `.tmp`, removível manualmente quando não
houver comandos ativos; ele nunca é lido como amostra.

A revisão capturada não recebe fetch/reset durante a operação. Leituras,
checkpoint, redução e commit usam o mesmo snapshot; o push envia o SHA exato
do commit, sem force. Escritores concorrentes partindo da mesma revisão têm
no máximo um push aceito. Rejeição não gera confirmação de sucesso nem retry
automático. Uma falha de transporte pode ocorrer depois da aceitação remota:
o erro informa o SHA e é necessário consultar o ledger antes de repetir.

O CLI mantém o snapshot até concluir a operação e imprimir o resultado, e
o remove em `finally`, tanto em sucesso quanto em erro. `withLedger(config,
callback)` também aguarda callbacks assíncronos. Falha na remoção produz aviso
com o caminho, sem transformar um push confirmado em falha. A API de baixo
nível `syncLedger(config)` continua síncrona e retorna uma string, mas agora
sempre retorna um caminho privado novo: o chamador deve removê-lo ao terminar,
ou preferir `withLedger`. Não se deve compartilhar esse caminho entre operações.

Interrupções que impedem `finally` (inclusive SIGKILL, encerramento por sinal
ou queda do host) podem deixar clones órfãos. Não há lock, identificação por
PID, coleta automática nem reutilização desses diretórios; portanto um órfão
não bloqueia nem altera operações futuras e reutilização de PID é irrelevante.
Para limpeza manual, primeiro encerre os comandos que usam esse namespace e
remova apenas os diretórios `.operation-*` correspondentes. Não apague snapshots
de operações ativas. Um processo interrompido após o push também pode não ter
exibido confirmação: consulte o histórico remoto antes de tentar novamente.

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
