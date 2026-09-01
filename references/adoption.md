# Adoção num projeto consumidor

## Instalação

Sem npm. Instala-se direto de uma tag do GitHub, fixada no lockfile:

```
npm i -D github:rafaspol/vibecora-agent-handoff#v0.1.0
```

Atualizações são deliberadas: mude a tag e rode os testes de paridade de novo.

## Configuração

`vibecora-handoff init` cria `.agents/handoff.config.json` com os defaults. O
consumidor sobrescreve o que for do layout dele:

- `files.handoff`, `files.input`, `files.performance`, `files.roadmap`;
- `git.mainRef`;
- `classify.rules` (globs `**`, `*`, literais) e `classify.unknownClass`;
- `audit.releaseBaseUrlEnv` e `audit.quave.*`.

A config é mesclada em profundidade sobre os defaults; listas substituem.

## Redirecionar os comandos locais

No `package.json` do consumidor:

```json
"scripts": {
  "handoff:init": "vibecora-handoff init",
  "handoff:new": "vibecora-handoff new",
  "handoff:brief": "vibecora-handoff brief",
  "handoff:check": "vibecora-handoff check",
  "handoff:finalize": "vibecora-handoff finalize",
  "handoff:audit": "vibecora-handoff audit"
}
```

O `handoff:record` que fazia tudo num passo vira `new` + `finalize`. Ajuste o
`AGENTS.md` e qualquer git hook.

## Fica local (não migra)

- sincronização de ROADMAP e o formato de qualquer bloco gerado;
- deploy, smoke, rollback, gates de CI;
- classes de arquivo específicas do repositório (vão na config, não no núcleo).

## Testes de paridade

Antes de remover os scripts locais, compare para o mesmo estado de repositório:

- `vibecora-handoff check` × a checagem local — mesmos erros/mesma aprovação;
- `vibecora-handoff brief --json` × o resumo local — mesmos campos;
- `vibecora-handoff audit` × a auditoria local — mesma reconciliação.

Depois produza um handoff real com a CLI e retome-o numa sessão nova. Só então
remova os scripts duplicados.
