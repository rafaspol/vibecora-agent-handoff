# vibecora-agent-handoff

Contrato de handoff v3 entre agentes de código: um retrato YAML imutável do
estado de uma sessão, gerado por comando, verificado offline e reconciliado com
o estado publicado.

## Instalação

Distribuído por tag do GitHub (sem npm):

```
npm i -D github:rafaspol/vibecora-agent-handoff#v0.1.0
```

Requer Node.js ≥ 20.

## Comandos

```
vibecora-handoff <comando>

  init       cria config + arquivo de entrada (não sobrescreve)
  new        regenera o retrato inteiro a partir do Git + entrada (offline)
  brief      visão compacta do retrato (--json); não escreve, offline
  check      valida schema, Git, histórico e evidências (offline)
  finalize   acrescenta um único run_completed (idempotente, offline)
  audit      reconcilia GitHub, /api/release e a plataforma (rede, só leitura)
```

`new`, `brief`, `check` e `finalize` não fazem chamadas de rede. `audit` usa
rede com timeout e reporta cada fonte indisponível com um motivo.

## Fluxo

Início de sessão:

```
vibecora-handoff brief        # estado de partida
vibecora-handoff audit        # o que está publicado (se há rede/credenciais)
```

Fechamento:

```
# 1. commit da entrega
# 2. editar .agents/handoff.input.yaml com a narrativa
vibecora-handoff new
vibecora-handoff finalize
vibecora-handoff check        # só encerrar com "consistente"
```

## Configuração

`.agents/handoff.config.json` (criado por `init`) declara caminhos de arquivo,
`git.mainRef`, as regras de classificação de caminhos e a plataforma de
auditoria. Ver `references/adoption.md`.

## Contrato

- protocolo v3; v2 é lido apenas como histórico;
- `performance.jsonl` é append-only;
- um handoff não autoriza deploy, publicação ou ação externa;
- deploy, rollback, smoke e sincronização de roadmap ficam no projeto
  consumidor, não aqui.

Ver `references/schema.md` para o contrato completo.

## Proteção de informação

`scripts/check-forbidden.mjs` procura termos proibidos (lista via
`HANDOFF_FORBIDDEN_TERMS`, não versionada) em arquivos e no histórico Git. Roda
antes de cada tag. A saída informa arquivo e linha, sem repetir o termo.

## Licença

MIT.
