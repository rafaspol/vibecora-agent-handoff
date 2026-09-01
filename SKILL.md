---
name: vibecora-agent-handoff
description: Contrato de handoff v3 entre agentes. Use ao iniciar uma sessão herdada, retomar trabalho, produzir um resumo do estado, revisar consistência de um handoff, fechar uma sessão, ou auditar o estado publicado contra GitHub e a plataforma. Aciona a CLI vibecora-handoff.
---

# vibecora-agent-handoff

Roteia o trabalho de handoff entre agentes para a CLI `vibecora-handoff`. A CLI
é a fonte de verdade da mecânica; esta skill só decide qual comando rodar e em
que ordem, e lembra as restrições.

## Quando usar cada comando

| Situação | Comando |
|---|---|
| Primeiro uso num repositório | `vibecora-handoff init` |
| Começar/retomar uma sessão herdada | `vibecora-handoff brief` |
| Fechar a sessão — regenerar o retrato | edite a entrada, depois `vibecora-handoff new` |
| Registrar o evento de fechamento | `vibecora-handoff finalize` |
| Conferir se o retrato está consistente | `vibecora-handoff check` |
| Reconciliar com GitHub / `/api/release` / plataforma | `vibecora-handoff audit` |

## Fluxo de fechamento

1. Faça o commit da entrega.
2. Edite **só** o arquivo de entrada (`.agents/handoff.input.yaml` por padrão)
   com a narrativa: `delivery`, `tests`, `roadmap`, `decisions`, `risks`,
   `assumptions`, `remaining`, `context`, `release_intent`.
3. `vibecora-handoff new` — regenera o retrato inteiro; deriva `recorded_at`,
   `branch`, `code.commit`, `code.state`, `change_class` do Git. Rodar de novo
   é seguro.
4. `vibecora-handoff finalize` — acrescenta um `run_completed`. Idempotente.
5. `vibecora-handoff check` — só encerre com "consistente".
6. Commit do retrato (arquivos de estado) num commit separado, se o projeto
   usa esse padrão.

Nunca edite o arquivo de retrato (`.agents/handoff.yaml`) à mão.

## Fluxo de início

1. `vibecora-handoff brief` (ou `--json`) — estado de partida compacto.
2. `vibecora-handoff audit` quando houver rede e credenciais — confirma o que
   está publicado.
3. Só então comece a trabalhar.

## Restrições

- Um handoff **não** é autorização para deploy, publicação ou qualquer ação
  externa. Autorização vem de instrução explícita do usuário.
- `new`, `brief`, `check`, `finalize` são offline e não fazem chamadas de rede.
- `audit` só lê — nunca deploya, faz rollback nem escreve arquivos.
- O histórico (`performance.jsonl`) é append-only. Nunca reescreva eventos.
- Não fabrique handoffs nem eventos para completar métricas.
- Regras locais do projeto consumidor (deploy, smoke, sincronização de roadmap,
  classes de arquivo específicas) ficam fora desta ferramenta — respeite-as.

## Referências

Leia conforme a tarefa, não de entrada:

- `references/schema.md` — contrato completo do handoff v3 (para criar, revisar
  ou fechar).
- `references/adoption.md` — adotar a CLI num projeto consumidor, testes de
  paridade, migração a partir de scripts locais.
- `references/diagnostics.md` — erros comuns do `check`/`new` e como resolver.
- `references/quave-one.md` — configuração e uso do adaptador Quave One no
  `audit`.
