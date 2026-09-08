# Exemplo de `AGENTS.md`

Modelo para o arquivo de contexto do seu projeto, no formato que este handoff
pressupõe. **Copie, corte o que não se aplica e substitua os exemplos** — um
`AGENTS.md` que descreve outro projeto é pior que nenhum.

O porquê do formato — e a evidência que o sustenta — está em
[`docs/context.md`](context.md). Em uma frase: o arquivo carrega só o que **não
é dedutível do código**, e o resto vira uma tabela de leitura condicional.

O bloco abaixo é o modelo. Tudo entre `<...>` é para trocar.

---

```markdown
# AGENTS.md — Guia para agentes de código

<Uma linha sobre como o trabalho é coordenado. Ex.: "Trabalho multiagente, com
o GitHub como ponto único de sincronização.">

Este arquivo contém apenas o que **não é dedutível do código**: autorização,
isolamento, requisitos permanentes e o fluxo entre agentes. Arquitetura e
convenções visíveis no próprio código são leitura condicional.

## O que ler, e quando

| Se a tarefa envolve | Leia também |
|---|---|
| começar ou retomar uma sessão | `npx vibecora-handoff start` — **se sair `blocked`, não comece**. As travas estão em `.agents/constraints.yaml`, não no retrato |
| escopo ou comportamento de produto | <o índice do seu roadmap, depois só a seção pertinente> |
| interface, tokens, tema | <seu documento de design> |
| publicar | <seu documento de release> |
| criar, revisar ou fechar um handoff | `node_modules/vibecora-agent-handoff/docs/schema.md` |
| setup, variáveis de ambiente | `README.md` |

Em conflito, vale o arquivo canônico da área. Anexos, histórico Git e memórias
de incidentes **não são especificação atual**.

## Autorização

<O que exige pedido explícito de uma pessoa. Seja literal: "push na `main`
publica em Produção e só acontece com pedido explícito" é uma regra que um
agente consegue seguir; "tenha cuidado com deploys" não é.>

## Isolamento e segurança

<Regras que não se deduzem do código: o que nunca entra em arquivo versionado,
o que é por usuário, o que exige credencial e de quem.>

## Requisitos permanentes

<Comportamentos que precisam continuar existindo e cuja ausência não aparece
em teste nenhum. É a seção que evita que alguém "limpe" uma peça viva.>

## Handoff entre agentes

O `.agents/handoff.yaml` é um **retrato imutável** do encerramento de uma
sessão. Ele **não** representa o estado atual — é intenção, não estado.

**Ao começar:** `npx vibecora-handoff start`. Ele mede, imprime o veredito e só
então mostra o retrato, nessa ordem, porque o retrato é a fonte mais fraca. Se
o veredito for `blocked`, resolva a razão apontada antes de trabalhar. A
precedência é

    medição ao vivo > .agents/constraints.yaml > retrato > telemetria

**Ao fechar:** commit da entrega → escreva a narrativa em
`.agents/handoff.input.yaml` → `npx vibecora-handoff new` →
`npx vibecora-handoff finalize` → confira que `npx vibecora-handoff check` diz
"consistente" → commit dos artefatos de estado, separado. Nunca edite o
`.agents/handoff.yaml` à mão.

**As travas não vivem no retrato.** `.agents/constraints.yaml` guarda o que não
pode sumir na troca de retrato: decisão medida que um agente futuro tentaria
"consertar", peça que parece morta e não está, dívida com dono e sem prazo.
Acrescentar é livre; **remover exige mover o id para `retired` com o motivo**.

**Registre o atrito.** Se algo no *processo* — não no código — causou
retrabalho, registre uma linha em `.agents/friction.log`: fato objetivo, sem
opinião, só quando há algo concreto.

## Mudança de regra e de escopo

<Como uma regra de processo muda no seu projeto. Se você usa ADRs, diga onde
ficam e quem aprova. Se não usa, diga a quem perguntar.>

<E o que fazer com o que está fora do escopo da tarefa recebida: registrar no
lugar certo e seguir com o que foi pedido, em vez de executar por conta.>

## Verificação

<Os comandos que precisam passar antes de fechar. Literais, copiáveis:>

    <npm test>
    <npm run lint>
    npx vibecora-handoff check

<E o que você espera de um teste. Ex.: "asserção mira o resultado, não o
mecanismo"; "regra nova precisa do caso negativo simétrico".>
```

---

## O que deixar de fora

O que mais infla um `AGENTS.md`, e o que cortar primeiro:

| Sai | Por quê |
|---|---|
| Panorama de arquitetura | Não ajuda o agente a achar arquivo, e é a primeira coisa a ficar desatualizada. |
| Convenção visível no código | O agente lê o código. Repetir cria duas fontes que divergem. |
| Mecânica completa de ferramenta | Vira leitura condicional: uma linha na tabela apontando para a documentação. |
| Estado do projeto | Estado é medido, não escrito. É para isso que existe o `start`. |
| Histórico de incidentes | Registro do passado lido como regra do presente é a origem de vários erros. Vai para o `friction.log`, que ninguém lê como especificação. |

O que **não** cortar: autorização, segurança, isolamento, requisitos
permanentes e o resumo do fluxo de handoff. São regras que, se saírem do
arquivo lido sempre, deixam de existir na prática.
