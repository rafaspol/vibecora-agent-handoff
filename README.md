# vibecora-agent-handoff

[![CI](https://github.com/rafaspol/vibecora-agent-handoff/actions/workflows/ci.yml/badge.svg)](https://github.com/rafaspol/vibecora-agent-handoff/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-informational)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

Um contrato de passagem de bastão entre agentes de código — e uma camada que
**mede o estado do repositório antes de a sessão começar**, em vez de acreditar
no que a sessão anterior escreveu.

---

## Por que isto existe

Vou ser direto: isto foi construído por um vibecoder que queria manter a
consistência do vibedesenvolvimento entre agentes diferentes. Não saiu de uma
pesquisa sobre orquestração multiagente. Saiu de cansaço.

O problema é conhecido de quem trabalha assim. Você fecha a sessão com um
agente. Amanhã abre com outro — ou com o mesmo, sem memória. Ele precisa saber
o que já foi feito, o que está no ar, o que ficou decidido e o que **não** deve
ser "consertado". A saída natural é pedir ao agente que escreva um resumo no
fim, e ao próximo que leia esse resumo no começo.

Funciona por um tempo. Depois começa a falhar de um jeito específico e chato:
**o resumo continua correto, e mesmo assim engana.**

## Três coisas que aconteceram de verdade

**1. O fim da sessão tinha trava; o começo era só um pedido.**
Havia uma verificação automática que reprovava um resumo inconsistente no
fechamento. Para abrir, existia uma frase num arquivo de instruções pedindo
para ler o resumo antes de começar. Uma verificação de um lado, boa vontade do
outro. Adivinhe qual lado quebrou.

**2. Um resumo correto foi lido como se fosse o estado atual.**
Numa retomada, o resumo dizia "não há fila". Estava correto — era um registro
imutável, e correto sobre o instante em que foi gravado. Ao lado esperavam
**vinte commits numa branch e uma PR aberta**, todos posteriores. A sessão
seguinte quase começou por cima da linha principal. Nenhuma verificação pegaria:
o resumo não estava errado; a **fonte** é que estava. Foi a terceira vez que o
mesmo padrão apareceu.

**3. Sete decisões caras quase sumiram num merge.**
Coisas do tipo "este contraste invertido é intencional, foi medido", "este
componente parece morto e não está". Moravam na lista de pendências do resumo,
misturadas com tarefas de verdade. Um merge trocou o arquivo inteiro e levou
junto o que não era tarefa — decisões que custaram sessões para chegar ali.

Nenhum desses três é resolvido pedindo ao agente que escreva melhor.

## Como funciona, em 30 segundos

A ideia toda cabe numa frase:

> **O retrato é intenção. A medição é estado. Onde os dois discordarem, vale a
> medição.**

O ciclo tem dois momentos.

**Ao abrir** (`start`) — o comando **mede** antes de você acreditar em qualquer
coisa: o que existe no remoto e não está no seu clone, se o commit do retrato
ainda está na linha publicada, se alguma trava sumiu do arquivo sem ser
aposentada, o que está no ar. Dá um veredito. **Só então** imprime o retrato da
sessão anterior — por último, de propósito, porque é a fonte mais fraca.

**Ao fechar** (`new` → `finalize` → `check`) — você escreve a narrativa num
arquivo de entrada; o comando gera o retrato derivando do Git o que é derivável
(commit, branch, estado do código, classes de arquivo tocadas), grava um evento
append-only, e verifica offline se tudo é coerente.

O retrato nunca é editado à mão. Ele é gerado, e o que você escreve é a entrada.

### Os detectores da abertura

Cinco. **Três bloqueiam**, dois só informam:

| Detector | Bloqueia | Quando |
|---|---|---|
| `queue_hidden` | **sim** | há PR aberta, ou branch no remoto que seu clone nunca viu |
| `snapshot_stale` | **sim** | o commit do retrato divergiu da linha publicada |
| `constraint_dropped` | **sim** | uma trava sumiu do arquivo sem ir para `retired` |
| `production_unverified` | não | o estado publicado não foi consultado |
| `remote_ahead` | não | o remoto está à frente do seu clone |

Os dois de baixo não bloqueiam por escolha. O remoto estar à frente é o estado
normal de quem ainda não deu `pull` — **alarme que grita sempre é alarme
desligado**, e aí você perde o caso que importa.

E existe uma regra de desligamento que faz parte do desenho: **se um bloqueio
atrapalhar duas vezes seguidas sem ter razão, desligue-o e deixe só o
relatório** — não "ajuste o limiar". Um detector que vira ritual de contorno já
não está medindo nada.

## Começando

Precisa de **Node ≥ 20** e **Git**. O `gh` é opcional: sem ele, PRs abertas não
são lidas, e a saída diz isso em vez de fingir que olhou.

```bash
npm i -D github:rafaspol/vibecora-agent-handoff#v0.3.0
```

Distribuído por tag do GitHub, sem npm. Confira a tag mais recente em
[releases](https://github.com/rafaspol/vibecora-agent-handoff/releases).

```bash
npx vibecora-handoff init
```

Cria três arquivos em `.agents/`: a configuração, o modelo de entrada e o
arquivo de travas.

```bash
git add .agents && git commit -m "adota o handoff"
```

**Este passo importa.** O detector de travas compara o arquivo com os ids que já
existiram *no histórico Git dele*. Enquanto ele não estiver commitado, não há
com o que comparar e o detector fica inerte — sem avisar.

Agora abra a sessão:

```bash
npx vibecora-handoff start
```

```
── medido ──
  clone        ad1d7eb (main)
  retrato      ainda não existe
  publicado    —
  remoto       não consultado
  travas       nenhuma

LIVRE — o estado medido não contradiz o retrato.
  (aviso) ainda não há retrato neste projeto — rode `vibecora-handoff new` para gravar o primeiro.

Ainda não há retrato. Ao fechar a sessão, `new` + `finalize` gravam o
primeiro, e a partir daí ele aparece aqui embaixo.
```

Ao terminar, escreva a narrativa em `.agents/handoff.input.yaml` e feche:

```bash
npx vibecora-handoff new       # gera o retrato a partir do Git + entrada
npx vibecora-handoff finalize  # grava o evento append-only
npx vibecora-handoff check     # verifica; sai 1 se algo não bate
```

Na próxima abertura, o `start` mostra o que mediu **e** o retrato — nessa ordem.

## Os sete comandos

| Comando | O que faz | Rede | Escreve | Sai 1 quando |
|---|---|---|---|---|
| `init` | cria config, entrada e travas (não sobrescreve) | não | sim | — |
| `start` | mede o estado da abertura, dá o veredito, chama o `brief` | sim¹ | **não** | bloqueado |
| `new` | regenera o retrato inteiro do Git + entrada | não | sim | entrada inconsistente |
| `brief` | visão compacta do retrato | não | não | retrato ilegível |
| `finalize` | acrescenta um `run_completed` (idempotente) | não | sim | retrato inválido |
| `check` | valida schema, Git, histórico e cruzamentos | não | não | inconsistente |
| `audit` | reconcilia com GitHub, release e plataforma | sim | não | — ² |

¹ Só leitura, e tudo com teto de tempo. Sem rede, degrada e diz o que não mediu.
² `audit` é relatório, não trava: sai 0 mesmo apontando divergência.

## O que você ganha

Sendo honesto sobre o que é garantia e o que é expectativa:

- **Uma sessão que abre sabendo o que existe fora do seu clone.** Isso é
  medição, não promessa: ou a branch está lá, ou não está.
- **Um retrato que não consegue mentir sobre o commit.** O `check` cruza o que
  foi escrito com o que o Git diz.
- **Travas que não somem numa troca de arquivo.** Remover exige um ato
  explícito, e o apagamento silencioso vira bloqueio na próxima abertura.
- **Um formato só** — que qualquer agente lê, e você também.

O que **não** é garantido: que o agente escreva um bom retrato. Nada aqui
inspeciona a qualidade da narrativa. O mecanismo protege o que é *verificável* —
commits, branches, ids, ancestralidade — e deixa a prosa por sua conta. Foi
escolha: tudo que só funcionaria se alguém policiasse o preenchimento de campo
ficou de fora, porque isso não se sustenta.

**O custo:** um comando ao abrir, três ao fechar, e dois arquivos versionados a
mais. Se isso já parece muito para o seu projeto, provavelmente é — e tudo bem.

## Limites honestos

- **Um handoff não autoriza nada.** Não é permissão para deploy, publicação ou
  qualquer ação externa. Deploy, rollback e smoke ficam no seu projeto.
- **Seis comandos rodam em qualquer projeto. O `audit` não.** Ele assume a
  plataforma Quave One e um `GET /api/release`, que vêm do projeto onde isto
  nasceu. Em outra plataforma ele vai reportar a fonte como indisponível para
  sempre, e adaptá-lo significa trocar `src/quave/adapter.mjs`. Não há mecanismo
  de plugin. É a parte menos reaproveitável, e preferi dizer a fingir.
- **Sem npm.** Instalação por tag do GitHub; atualizar é mudar a tag de
  propósito.
- **Tudo em português** — documentação, mensagens de erro, modelos.
- **Sem promessa de suporte.** É uma ferramenta que uso todo dia, publicada
  porque pode servir a outra pessoa. Issues são bem-vindas; SLA não existe.

## Configuração

O `init` escreve defaults genéricos em `.agents/handoff.config.json`. O que a
maioria dos projetos ajusta é a classificação de caminhos — quais arquivos são
runtime, quais são processo, quais são estado:

```jsonc
{
  "git": { "mainRef": "main" },
  "files": { "constraints": ".agents/constraints.yaml" },
  "classify": {
    "rules": [{ "class": "runtime", "match": ["app/**", "package.json"] }],
    "unknownClass": "runtime"
  }
}
```

Detalhes e o roteiro completo em [`docs/adoption.md`](docs/adoption.md).

## Proteção de informação

Há um verificador de termos proibidos (`npm run check:forbidden`) que varre
arquivos **e histórico de commits**. Ele serve a quem **extrai** uma ferramenta
de um projeto privado — não a quem adota esta aqui.

A lista vem da variável `HANDOFF_FORBIDDEN_TERMS` e **não é versionada**. Ela
existe para proteger produtos que ainda não foram lançados: nome, domínio,
identificadores de ambiente, exemplos reais. Termos entram quando um produto
começa e saem quando ele vai ao ar. O nome desta ferramenta e o do projeto que a
originou não são segredo e nunca entram na lista — por isso aparecem à vontade
aqui.

## Documentação

Lida conforme a tarefa, não de entrada:

| Arquivo | Para quê |
|---|---|
| [`docs/schema.md`](docs/schema.md) | o contrato completo do retrato — criar, revisar ou fechar um |
| [`docs/adoption.md`](docs/adoption.md) | adotar num projeto novo ou migrar de scripts próprios |
| [`docs/diagnostics.md`](docs/diagnostics.md) | um comando reprovou e você quer saber por quê |
| [`docs/quave-one.md`](docs/quave-one.md) | o adaptador de plataforma do `audit` |
| [`CHANGELOG.md`](CHANGELOG.md) | o que mudou entre as tags |

## Testes

```bash
npm test
```

86 testes, `node --test` puro, sem framework. Uma dependência de runtime
(`js-yaml`) e **zero** de desenvolvimento. Os testes de comando rodam a CLI de
verdade contra repositórios Git temporários — inclusive um remoto local, para
exercer os casos de branch ausente e de histórico divergente sem tocar a rede.

## Licença

[MIT](LICENSE).

---

Feito com erva-mate por Vibecora.
