# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto usa [SemVer](https://semver.org/lang/pt-BR/).

**Como atualizar:** a distribuição é por tag do GitHub, sem npm. Atualizar é
mudar a tag no seu `package.json` de propósito e rodar os testes — nunca
acontece sozinho.

```bash
npm i -D github:rafaspol/vibecora-agent-handoff#v0.3.0
```

## [0.3.2] — 2026-09-08

### Adicionado

- `docs/context.md` — como escrever o arquivo de contexto do projeto
  (`AGENTS.md` e equivalentes) para carregar só o que não é dedutível do código,
  com a evidência que sustenta o corte e o método para não perder guardrail.
- `docs/AGENTS.example.md` — um modelo para copiar e adaptar, no formato que
  este handoff pressupõe, mais a tabela do que cortar primeiro.

Nenhuma mudança de código. A CLI não escreve nem edita o `AGENTS.md` do seu
projeto: os dois documentos são orientação, e os sete comandos funcionam igual
sem eles.

## [0.3.1] — 2026-09-08

### Alterado

- README reescrito em formato de referência técnica: "o que faz" em uma frase,
  o problema em tabela, e comandos, detectores, configuração e travas em tabelas
  e blocos de código. A versão anterior contava as motivações como narrativa.
  Nenhuma mudança de código — só documentação.

## [0.3.0] — 2026-09-08

A abertura da sessão passa a medir o estado, em vez de só imprimir o retrato.

### Adicionado

- **`start`, o sétimo comando.** Mede antes de você acreditar: trabalho aberto
  no remoto, relação do commit do retrato com a linha publicada, travas
  apagadas, estado publicado. Dá um veredito e **só então** chama o `brief` —
  nessa ordem, porque o retrato é a fonte mais fraca. Sai 1 quando bloqueado.
  Nada é escrito; tudo que toca a rede tem teto de tempo.
- **Cinco detectores, três bloqueantes** (`queue_hidden`, `snapshot_stale`,
  `constraint_dropped`) e dois informativos (`production_unverified`,
  `remote_ahead`). A regra pura vive em `src/opening.mjs`, sem E/S.
- **`.agents/constraints.yaml`** — as travas que não pertencem a nenhum retrato.
  Acrescentar é livre; remover exige mover o id para `retired` com o motivo.
  O `init` passa a criar o arquivo.
- **`gitFacts`**: `remoteHeads`, `fileHistoryShas`, `fileAtCommit`,
  `countCommitsBetween` e `snapshotRelation` (que mede as **duas** direções).
- `files.constraints` e `start.constraintsHistoryLimit` na configuração;
  `.agents/constraints.yaml` entra na classe `state` por padrão.

### Corrigido

- As leituras de Git que tocam a rede ganharam teto de tempo com `SIGKILL`. Sem
  ele, um remoto que aceita a conexão e não responde pendurava o processo —
  inclusive no `audit`, que já tinha esse buraco.
- `--recorded-at` passa a aparecer no `--help`. Era funcional e nunca esteve
  documentado.
- README e `docs/adoption.md` mandavam instalar `#v0.1.0` desde que a v0.1.0
  saiu.

### Notas

- Um retrato **à frente** do publicado (trabalho local ainda não pushado) não
  bloqueia; só a divergência de verdade bloqueia. Medir uma direção só foi o
  primeiro erro desta regra, e ele apareceu na primeira abertura real.
- Um projeto **sem retrato ainda** também não bloqueia — quem acabou de rodar
  `init` não pode ser reprovado pela ferramenta que está adotando.
- O formato do retrato **não mudou**: continua `version: 3`.

## [0.2.0] — 2026-09-08

### Corrigido

- O cruzamento `run_completed.commit` × retrato aceita **ancestralidade**, e não
  só igualdade. `new` grava o HEAD do momento e `finalize` é idempotente, então
  qualquer commit feito depois de gravar reprovava um retrato honesto. A saída
  praticada era inventar um `run_id` com sufixo. `mainContains` continua
  guardando a honestidade sobre `merged_main`.

## [0.1.3] — 2026-09-01

### Alterado — **quebra compatibilidade**

- `references/` virou `docs/`, e o `SKILL.md` saiu do repositório e da lista
  `files`. A skill não era carregável por nenhum agente: só existia dentro do
  pacote instalado, e nenhum agente descobre skills nesse caminho.
- **Se você linkava `node_modules/vibecora-agent-handoff/references/*`, esses
  caminhos deixaram de existir.** Foi o que aconteceu com o projeto de origem, e
  ninguém percebeu por semanas.

## [0.1.2] — 2026-08-31

### Adicionado

- `new --extra-class <c>` e `classify.recordAlsoTouches`, para o caso em que um
  passo posterior do fechamento toca arquivos que o `new` ainda não viu.

## [0.1.1] — 2026-08-31

### Corrigido

- Ancestralidade bidirecional no `audit`: retrato e deploy que diferem só por
  commits sem runtime deixam de ser reportados como divergência.
- `--help` sai 0. Comando desconhecido continua saindo 1.
- `audit.releaseBaseUrl` aceita valor literal na config, além da variável de
  ambiente.

## [0.1.0] — 2026-08-31

Primeira versão. Contrato de handoff v3 extraído para ferramenta pública: CLI
com seis comandos, schema versionado, verificação offline, reconciliação
conectada, adaptador de plataforma e verificador de termos proibidos.
