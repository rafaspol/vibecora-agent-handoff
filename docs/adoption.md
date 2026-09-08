# Adoção num projeto

Dois caminhos: **começar do zero** (a maioria) ou **migrar de scripts próprios**
(quem já tinha um mecanismo caseiro). Comece pelo primeiro.

## Instalação

Sem npm. Instala-se direto de uma tag do GitHub, fixada no lockfile:

```
npm i -D github:rafaspol/vibecora-agent-handoff#v0.3.0
```

Confira a tag mais recente em
[releases](https://github.com/rafaspol/vibecora-agent-handoff/releases).
Atualizações são deliberadas: mude a tag e rode os testes.

## Começando do zero

```
npx vibecora-handoff init
git add .agents && git commit -m "adota o handoff"
```

O `init` cria três arquivos e **não sobrescreve** nada que já exista:

| Arquivo | O quê | Versionar? |
|---|---|---|
| `.agents/handoff.config.json` | a configuração | **sim** |
| `.agents/handoff.input.yaml` | a entrada que você edita a cada fechamento | opcional¹ |
| `.agents/constraints.yaml` | as travas | **sim, e é obrigatório** |

¹ O retrato é superconjunto da entrada, então versionar os dois duplica a
narrativa a cada entrega. Muitos projetos põem a entrada no `.gitignore`.

**Commitar o `constraints.yaml` não é opcional.** O detector
`constraint_dropped` compara os ids do arquivo com os que já existiram *no
histórico Git dele*. Enquanto ele não estiver commitado, não há com o que
comparar — e o detector fica inerte sem avisar, que é pior que não existir.

Depois disso, o ciclo de cada sessão:

```
npx vibecora-handoff start      # abre: mede, dá o veredito, mostra o retrato
# ... trabalho ...
# ... edite .agents/handoff.input.yaml com a narrativa ...
npx vibecora-handoff new        # gera o retrato
npx vibecora-handoff finalize   # grava o evento
npx vibecora-handoff check      # verifica
```

## Configuração

A config é mesclada em profundidade sobre os defaults; **listas substituem**, não
se somam. O que a maioria dos projetos ajusta:

- `classify.rules` — o mapeamento caminho → classe. É o que mais varia entre
  projetos: os defaults assumem `src/`, `app/`, `lib/`, `client/`, `server/`,
  `public/`. Regras são **ordenadas**: a primeira que casar decide.
- `classify.unknownClass` — onde cai um caminho que nenhuma regra pegou.
- `git.mainRef` — se sua branch principal não é `main`.
- `files.*` — se você não quer os arquivos em `.agents/`.
- `audit.releaseBaseUrl` (ou `releaseBaseUrlEnv`) — a base de onde o `start` e o
  `audit` leem `GET /api/release`. Sem ela, os dois reportam o estado publicado
  como não consultado, o que **não** bloqueia.

**Se você mudar `files.*`, mude também `classify.rules`.** Os dois lados
precisam concordar: com `files` apontando para um lugar e as regras para outro,
os arquivos do handoff passam a ser classificados por `unknownClass` — em geral
`runtime` — e o `check` começa a reclamar de classe não declarada.

Três chaves são **declarativas**: nenhum comando as lê hoje. `files.friction`,
`files.roadmap` e `platform` existem para o projeto apontar seus arquivos e para
as regras de classificação ficarem coerentes.

## Os scripts no `package.json`

```json
"scripts": {
  "handoff:start": "vibecora-handoff start",
  "handoff:new": "vibecora-handoff new",
  "handoff:brief": "vibecora-handoff brief",
  "handoff:check": "vibecora-handoff check",
  "handoff:finalize": "vibecora-handoff finalize",
  "handoff:audit": "vibecora-handoff audit"
}
```

Se o seu fechamento tem um passo que reescreve um arquivo **depois** do `new`
(um sincronizador de roadmap, por exemplo), o `new` não sabe disso e o `check`
seguinte reclama da classe não declarada. Declare com `--extra-class`, ou em
`classify.recordAlsoTouches` na config:

```json
"scripts": {
  "handoff:record": "vibecora-handoff new --extra-class product_docs && vibecora-handoff finalize && npm run roadmap-sync"
}
```

## Escrevendo boas travas

Uma trava é uma decisão que um agente futuro tentaria "consertar". O formato tem
quatro campos, e o terceiro é o que faz ela sobreviver:

```yaml
constraints:
  - id: polaridade-invertida
    resumo: >
      O contraste invertido nesta tela é intencional.
    porque: >
      Foi medido contra as referências e escolhido assim mesmo.
    fonte: "ADR 0007"
```

`resumo` diz o que é. **`porque` diz por que não é bug** — sem ele, a trava não
resiste ao primeiro agente que discordar. `fonte` diz onde verificar.

**Diga na polaridade certa.** Uma trava escrita como "não está armado" vira, na
leitura seguinte, a afirmação de que algo está desarmado — mesmo que ela exista
justamente para dizer o contrário.

O que **não** entra: tarefa. Tarefa vive no `remaining` do retrato e morre
quando é feita. Trava não morre; é aposentada:

```yaml
retired:
  - id: polaridade-invertida
    motivo: "as referências mudaram; a inversão deixou de fazer sentido"
    em: 2026-09-08
```

Apagar sem aposentar bloqueia a próxima abertura. É o ponto.

## O arquivo de contexto do projeto

O handoff cobre a abertura e o fechamento da sessão. O que o agente precisa
saber *durante* ela continua no arquivo de contexto do seu projeto —
`AGENTS.md`, `CLAUDE.md`, o equivalente do seu agente. Este pacote não escreve
nem edita esse arquivo: ele é seu.

O que muda ao adotar o handoff é **quanto** esse arquivo precisa carregar. O
estado do projeto sai dele (passa a ser medido pelo `start`), e as decisões que
não podem sumir saem também (vão para o `constraints.yaml`). Sobra a regra que
não se deduz de lugar nenhum — que é bem menos do que costuma estar ali.

- [`docs/context.md`](context.md) — por que enxugar, com a evidência que
  sustenta a decisão, e como cortar sem perder guardrail.
- [`docs/AGENTS.example.md`](AGENTS.example.md) — um modelo para copiar e
  adaptar.

Nada disso é obrigatório para usar a CLI. Os sete comandos funcionam igual com
um arquivo de contexto de mil linhas.

## Fica no seu projeto (não vem no núcleo)

- sincronização de ROADMAP e o formato de qualquer bloco gerado;
- deploy, smoke, rollback, gates de CI;
- classes de arquivo específicas do repositório (vão na config, não no núcleo).

Um handoff não autoriza deploy, publicação nem qualquer ação externa.

## Migrando de scripts próprios

Se você já tinha um mecanismo caseiro, **não apague nada antes de comparar**.
Para o mesmo estado de repositório:

- `vibecora-handoff check` × a checagem local — mesmos erros, mesma aprovação;
- `vibecora-handoff brief --json` × o resumo local — mesmos campos;
- `vibecora-handoff start --json` × a abertura local — mesmo veredito e mesmos
  detectores disparados.

Depois produza um handoff real com a CLI e retome-o numa sessão nova. **Só
então** remova os scripts duplicados. Se a comparação divergir, o certo é
corrigir na CLI e sair uma versão nova — não remendar no seu projeto, porque aí
a duplicação volta por outro caminho.
