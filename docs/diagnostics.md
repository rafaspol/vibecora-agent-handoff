# Diagnóstico

## `start` diz `queue_hidden`

Existe uma PR aberta, ou uma branch no remoto cujo commit não está no seu clone.
É trabalho que o retrato, por ser imutável, não tem como conhecer. Rode
`git fetch`, olhe o que apareceu e decida — não comece por cima.

Se o seu fluxo mantém PRs abertas por muito tempo, este detector vai bloquear
toda abertura. Nesse caso a resposta certa é **desligá-lo**, não conviver com o
contorno: um bloqueio que dispara sempre já não mede nada.

## `start` diz `snapshot_stale`

O commit do retrato não está na linha publicada nem à frente dela — são
históricos diferentes. Ou o retrato veio de uma branch que não foi mergeada, ou
seu clone está numa linha divergente. Rode `git fetch` e compare antes de
trabalhar.

Um retrato **à frente** do publicado (trabalho local ainda não pushado) não cai
aqui: é o caso normal de quem ainda não deu push. E um projeto **sem retrato**
também não — só falta gravar o primeiro com `new`.

## `start` diz `constraint_dropped`

Um id que já existiu no arquivo de travas não está mais nem em `constraints` nem
em `retired`. Ou foi apagado sem querer — restaure — ou a remoção foi
deliberada, e aí ela precisa ser dita:

```yaml
retired:
  - id: <o-id>
    motivo: "por que deixou de valer"
    em: 2026-09-08
```

## `start` não bloqueia nada e o detector de travas nunca dispara

O arquivo de travas provavelmente não está commitado. A comparação é contra o
**histórico Git** do arquivo; sem commit não há histórico, e o detector fica
inerte. `git add .agents/constraints.yaml && git commit`.

## `check` diz "performance.jsonl não contém run_completed"

Rode `vibecora-handoff finalize`. O `check` exige o evento de fechamento; um
retrato recém-gerado por `new` ainda não o tem.

## `check` diz `change_class não inclui "X"`

O diff (`base..HEAD` mais a árvore suja) toca arquivos da classe `X` que o
retrato não declara. Ou:

- adicione `X` à lista `change_class` do arquivo de entrada e rode `new` de novo;
- ou confirme que a regra de classificação na config está correta para aqueles
  caminhos.

Declarar classes **a mais** não é erro.

## `check` diz `code.state=merged_main mas <sha> não é ancestral de main`

O commit do retrato não está em `origin/main` nem em `main` local. Se o merge
ainda não aconteceu, use `code_state: local_commit` ou `pushed_branch` na
entrada. Se aconteceu, atualize as refs (`git fetch`) e rode `new` de novo.

## `check` diz `run_completed.commit deve coincidir ... ou ser ancestral dele`

O commit do evento não está no histórico do commit do retrato — são linhas
diferentes, não um commit a mais. Um commit feito **depois** do `new` não cai
aqui: ancestral passa. Se o retrato aponta para outra branch, regrave com `new`
a partir do commit certo.

## `check` diz `code.commit <sha> não existe`

O commit foi reescrito (rebase, amend, squash) depois do `new`. Rode `new` de
novo para capturar o commit atual.

## `check` diz `append-only violado` (múltiplos `run_completed`)

Há mais de um `run_completed` para o mesmo `run_id` no `performance.jsonl`.
Remova a duplicata manualmente — `finalize` não gera isso (é idempotente), então
veio de edição externa ou de um `run_id` reaproveitado.

## `audit` diz `verdict: drift` mas o estado parece certo

Se a única divergência é o commit do retrato ser o **pai** do commit publicado,
e o intervalo só tem commits de classe não-runtime (ex.: um commit-retrato), o
`audit` marca isso como alinhado com uma nota. Um `drift` real é o commit
publicado divergir do retrato por mudança de `runtime`.

## `audit` — fontes `available: false`

Normal offline ou sem credenciais. `remote_git` precisa de rede;
`gh_actions` precisa do `gh` logado; `api_release` precisa da env var de base
URL; `quave` precisa de `QUAVEONE_ENV_NAME` + token. Cada fonte ausente é
reportada com motivo; o `audit` sempre sai com código 0.
