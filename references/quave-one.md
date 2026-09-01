# Adaptador Quave One

O `audit` reconcilia o retrato com o estado publicado. Para a Quave One, o
caminho é a **CLI oficial** (`quaveone`), que lê status com user token ou env
token e não dispara deploy.

## Configuração

Na config do consumidor:

```json
"platform": "quave-one",
"audit": {
  "releaseBaseUrl": "https://app.example.com",
  "releaseBaseUrlEnv": "HANDOFF_AUDIT_BASE_URL",
  "quave": {
    "envNameEnv": "QUAVEONE_ENV_NAME",
    "envTokenEnv": "QUAVEONE_ENV_TOKEN",
    "cliEnv": "QUAVEONE_CLI"
  }
}
```

`releaseBaseUrl` (literal na config) tem precedência sobre a env var nomeada em
`releaseBaseUrlEnv`. O `audit` faz `GET <base>/api/release`.

## Variáveis de ambiente no `audit`

| Var | Uso |
|---|---|
| `QUAVEONE_ENV_NAME` | nome do ambiente. Sem ela, a fonte Quave fica indisponível. |
| `QUAVEONE_ENV_TOKEN` | token do ambiente. `QUAVEONE_USER_TOKEN` também serve. Sem token, indisponível. |
| `QUAVEONE_CLI` | caminho do binário `quaveone`. Default: `quaveone` no `PATH`. |
| `HANDOFF_AUDIT_BASE_URL` | base para `GET <base>/api/release`, quando o consumidor expõe esse endpoint. |

## O que o adaptador faz

- roda `quaveone env status --env <nome> --output json`;
- normaliza `version`, `commit` (`currentDeployment.gitCommitId`), `contentId`,
  `deploymentStatus`, `activityStatus`;
- devolve JSON para o `reconcile` comparar com GitHub e `/api/release`;
- **nunca** modifica arquivos, deploya ou faz rollback;
- em erro, devolve `{ available: false, reason }` com stderr resumido — o token
  nunca aparece em erro nem em log.

## Outras plataformas

Fora de escopo. Quem usa outra plataforma substitui `src/quave/adapter.mjs` por
um adaptador que produza o mesmo shape normalizado.
