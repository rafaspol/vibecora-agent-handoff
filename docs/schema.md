# Contrato do handoff v3

O retrato é um YAML imutável, identificado por `recorded_at`. Registra o estado
do trabalho no instante do fechamento. Não registra versão de plataforma nem
resultado futuro de deploy — isso vem do `audit`.

## Campos

| Campo | Tipo | Regra |
|---|---|---|
| `version` | número | `3` |
| `run_id` | string | identificador único da sessão |
| `recorded_at` | string | ISO 8601; instante da geração (derivado) |
| `branch` | string | branch no momento (derivado) |
| `task_class` | string | nome curto livre do tipo de problema |
| `operation` | enum | `analyze` `diagnose` `implement` `review` `test` `refactor` `document` `other` |
| `agent_runtime` | objeto | `agent`, `model`, `environment` (strings) |
| `change_class` | lista | subconjunto de `runtime` `process` `product_docs` `state` `general_docs` (derivado; entrada pode acrescentar) |
| `delivery.task` | string | uma frase: o que a sessão entregou |
| `delivery.completed` | lista de strings | itens concluídos e verificados |
| `code.state` | enum | `working_tree` `local_commit` `pushed_branch` `merged_main` (derivado; entrada pode forçar) |
| `code.commit` | string | commit no momento (derivado) |
| `release_intent` | enum | `not_requested` `requested` `authorized` — intenção, **não** resultado |
| `tests.ran` | lista de strings | o que rodou |
| `tests.result` | enum | `pass` `fail` `partial` `not_run` |
| `roadmap.status` | enum | `updated` ou `not_applicable` |
| `roadmap.sections` | lista | obrigatório se `updated` |
| `roadmap.reason` | string | obrigatório se `not_applicable` |
| `decisions[]` | objetos | `decision`, `rationale` (strings) |
| `risks[]` | lista de strings | pode ser vazia |
| `assumptions[]` | lista de strings | pode ser vazia |
| `remaining[]` | objetos | `task`, `owner`, `status` (`ready` `blocked` `deferred`), `blocking` (booleano) |
| `context[]` | objetos | `claim`, `basis` (`verified` `observed` `assumed` `unknown`), `evidence` |

`context[].evidence` deve ser concreto (≥ 3 caracteres) quando `basis` é
`verified` ou `observed`.

## O que `check` valida (offline)

- schema acima;
- Git: `code.commit` existe; `code.state=merged_main` ⇒ o commit é ancestral de
  `main` (aceita `origin/main` ou `main` local);
- `change_class`: toda classe tocada pelo diff (`base..HEAD` + árvore suja)
  precisa estar declarada. Declarar **mais** que o diff imediato é legítimo — o
  retrato resume a sessão inteira.
- histórico append-only: exatamente um `run_completed` para o `run_id`;
- cross-check: `run_completed` bate com o retrato em `task_class`, `operation`,
  `commit`, `code_state`, `release_intent`, `roadmap_status`.

## `performance.jsonl`

Append-only. Cada linha um JSON. `finalize` acrescenta um `run_completed`:

```
{"event":"run_completed","run_id":"...","timestamp":"...","agent":"...",
 "model":"...","task":"...","task_class":"...","operation":"...","result":"...",
 "tests":"...","commit":"...","code_state":"...","release_intent":"...",
 "roadmap_status":"..."}
```

`run_reviewed` (opcional, registrado por outro agente ao revisar um run):
`timestamp`, `reviewer_agent`, `reviewer_model`, `run_id`, `outcome`
(`confirmed` `corrected` `questioned`), `evidence`.

## Leitura do v2

Retratos v2 são lidos apenas como histórico (`brief` os resume). Fechamentos
novos são v3.
