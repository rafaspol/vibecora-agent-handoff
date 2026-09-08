# Contexto progressivo

Como escrever o arquivo de contexto do projeto (`AGENTS.md`, `CLAUDE.md`, o
equivalente do seu agente) para que ele carregue o que serve e nada além.

Modelo pronto em [`docs/AGENTS.example.md`](AGENTS.example.md).

## O problema

O arquivo de contexto é lido **incondicionalmente**, em toda sessão, por todo
agente. Isso o torna o lugar mais caro do repositório para guardar informação —
e o mais tentador, porque escrever ali parece garantir que a regra será
respeitada.

O resultado típico: panorama de arquitetura, convenções que o código já mostra,
mecânica completa de cada ferramenta, e um resumo do estado do projeto. Tudo
lido sempre, por qualquer tarefa.

## A evidência

Gloaguen, Mündler, Müller, Raychev e Vechev, *"Evaluating AGENTS.md: Are
Repository-Level Context Files Helpful for Coding Agents?"*
([arXiv:2602.11988](https://arxiv.org/abs/2602.11988), ETH Zurich /
LogicStar.ai), avaliou quatro agentes em SWE-bench e num benchmark montado a
partir de repositórios com arquivos de contexto escritos por desenvolvedores.
Três achados importam aqui:

1. **Panoramas de repositório não ajudam.** Os agentes não localizam os
   arquivos relevantes mais rápido quando o contexto traz uma visão geral da
   arquitetura.
2. **Arquivos de contexto custam mais de 20% a mais** em passos e tokens, e
   elevam os tokens de raciocínio, sem melhora correspondente de resultado.
3. **As instruções são bem seguidas.** O risco de enxugar não é o agente
   desobedecer uma regra que continua escrita — é a regra deixar de estar
   escrita.

E o que o artigo **não** autoriza a esperar: a diferença de taxa de sucesso
entre ter e não ter arquivo de contexto foi de 2,4% e não atingiu significância
estatística, com centenas de instâncias. Enxugar o arquivo é uma decisão de
**custo**, não de qualidade. Quem prometer ganho de acerto está lendo ruído.

## A regra

**O arquivo carrega só o que não é dedutível do código.** O resto vira uma
tabela curta de leitura condicional: tipo de tarefa → o que ler.

Fica, porque não se deduz de lugar nenhum:

- autorização — o que exige pedido explícito de uma pessoa;
- isolamento e segurança — o que nunca entra em arquivo versionado, o que é por
  usuário;
- requisitos permanentes — comportamento cuja ausência nenhum teste acusa;
- o resumo do fluxo de handoff — como abrir e fechar uma sessão;
- o roteamento documental — a tabela.

Sai, porque está em outro lugar ou não ajuda:

- panorama de arquitetura (achado 1);
- convenção visível no código;
- mecânica completa de ferramenta — vira uma linha na tabela;
- estado do projeto — estado é **medido**, e é para isso que existe o `start`;
- histórico de incidentes — vai para o `friction.log`.

## Como isto conversa com o handoff

As três peças cobrem coisas diferentes, e é a separação que mantém o arquivo de
contexto pequeno:

| Peça | Guarda | Lida |
|---|---|---|
| `AGENTS.md` | a regra que não se deduz | sempre |
| `constraints.yaml` | a decisão que não pode sumir | pelo `start`, e quando a trava for tocada |
| retrato (`handoff.yaml`) | a intenção de quem fechou a sessão | pelo `start`, depois do veredito |

Antes de haver um comando de abertura, o arquivo de contexto acumulava as três —
e a terceira, o estado, envelhecia sem avisar. O `start` mede o que é medível,
o `constraints.yaml` guarda o que é decisão, e o que sobra para o `AGENTS.md` é
regra pura.

## Como cortar sem perder guardrail

O achado 3 é o alerta: instruções escritas são seguidas, então tirar uma
instrução é tirar o comportamento. Antes de fechar um corte:

1. Liste as regras que saíram do arquivo lido sempre.
2. Para cada uma, aponte onde ela passou a estar — outro documento **lido
   incondicionalmente**, um teste, ou um gate.
3. Uma regra que não couber em nenhum dos três **volta**.

O critério de sucesso é reduzir a leitura obrigatória sem regressão de
guardrail. A primeira metade é medida direta (o que deixou de ser lido); a
segunda é binária (a regra está, ou não está, em documento lido sempre).

E o gatilho de reversão é por item, não pelo corte inteiro: se faltar uma
informação que fazia falta, ela volta naquele ponto e o caso vai para o
`friction.log`.
