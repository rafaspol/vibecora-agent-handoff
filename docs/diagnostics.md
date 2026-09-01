# Diagnóstico

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
