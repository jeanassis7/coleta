# DRE — desenho (v2, depois das suas respostas)

> **Isto não é plano de execução.** É o modelo, pra você revisar antes de eu
> escrever qualquer linha. O que ainda depende de você está marcado com ❓.

Base: sua lista de categorias + o print da aba **Lançamentos** da planilha
"2026 - FLUXO TOTAL EMPRESA" (19/08/2026).

---

## Como funciona hoje (o que o print mostra)

Você olha o **extrato do banco** e lança linha a linha:

| Coluna | O que é |
|---|---|
| Ano / Mês / Dia | quando |
| **Fonte** | de onde saiu o dinheiro — `$$` (espécie) ou `BB` (banco) |
| Valor | quanto |
| **Local** | a categoria (é a sua lista de ~30) |
| Obs. | texto livre — "PIX DÉ CAMPINA LAGOA OLEO FUMACA", "ALDO CHAPEADOR ECOSPORT" |
| Forma / Parcela / OBS | complementos |

E as abas: *Controle Geral (só olhar)*, **Lançamentos**, *Entradas*,
*Acompanhamento de caixa*, *Soma de dívidas PF*.

**O modelo que você descreveu está certo:** o **lançamento é mutável**, a
**DRE é painel imutável** calculado em cima dele. É assim que vou construir.

---

## Decisões já fechadas

| # | Decisão |
|---|---|
| 1 | **"Dinheiro em mãos" vira "Óleo comprado por [motorista]"** — e sai automático (ver abaixo) |
| 2 | **DRE por competência** |
| 3 | Não dobrar nem sumir — **comigo**, com teste no E2E provando |
| 4 | **Valdecir** é faz-tudo, sem caminhão, recebe transferência. "Pró-labore" não é o termo técnico: é **transferência pra uma pessoa** (Jean e Valdecir) |
| 5 | **Receita e margem bruta entram** |

---

## Mudança 1 — "Dinheiro em mãos" some, e vira melhor

Hoje você lança **"Lucimar — Dinheiro em mãos, R$ 5.000, $$ ENTREGUE"**. Isso
é a **entrega**, não o gasto — e a planilha nunca soube quanto daqueles
R$ 5.000 virou óleo.

O sistema sabe. Cada coleta do Lucimar tem litros e valor pago, uma a uma.

Então a linha do DRE vira **"Óleo comprado por Lucimar"** e é a **soma real
das coletas dele no período** — não precisa lançar nada. A entrega do dinheiro
continua existindo como **adiantamento**, que é o que ela é: transferência de
caixa, que aparece no acompanhamento de caixa e não no DRE.

**Ganho:** você passa a ver *"o Lucimar comprou R$ 4.200 de óleo e ainda tem
R$ 800 na mão"* em vez de *"entreguei R$ 5.000"*.

---

## Mudança 2 — a **Fonte** entra no modelo

Eu não tinha isso e é o que sustenta seu *Acompanhamento de caixa*: de qual
caixa o dinheiro saiu. Vira uma lista fixa (`especie`, `bb`, e o que mais
existir), em todo lançamento.

❓ **Além de `$$` e `BB`, tem outra conta?** (outro banco, cartão, conta PJ
separada)

---

## Mudança 3 — a tela de Lançamentos é o coração

Uma tela de **lançar despesa** rápida, no ritmo do extrato: data, fonte,
valor, categoria, obs. Com **filtro** por período, categoria, fonte e pessoa —
e é ela que alimenta as abas da DRE.

Tecnicamente ela grava em `contas_a_pagar` **já com status `paga`** (você está
lançando o que já saiu). A mesma tabela continua guardando o que ainda vai
vencer. Uma tabela só pra todo dinheiro que sai é o que torna o DRE possível
sem dobrar.

---

## ❓ A proposta que eu quero que você avalie

Você disse: *"ao criar um novo funcionário criaria uma categoria também"*.

Isso funciona, mas faz a lista de categorias **crescer com as pessoas**. Hoje
já tem 5 linhas que são pessoa e não gasto: *Pro-Labore Jean*, *Pro-Labore
Valdecir*, *Lucimar/Nei/Fumaça — Dinheiro em mãos*. Contratou alguém, mexe na
lista; alguém saiu, a categoria fica órfã pra sempre no histórico.

**Proposta: separar o QUÊ do QUEM.** Todo lançamento tem `categoria` (o quê) e,
opcionalmente, `pessoa` (quem):

| Sua linha de hoje | Vira |
|---|---|
| Lucimar — Dinheiro em mãos | categoria **Óleo comprado** + pessoa **Lucimar** |
| Nei — Dinheiro em mãos | categoria **Óleo comprado** + pessoa **Lucinei** |
| Fumaça — Dinheiro em mãos | categoria **Óleo comprado** + pessoa **❓ quem é Fumaça?** |
| Pro-Labore Jean | categoria **Transferência a sócio** + pessoa **Jean** |
| Pro-Labore Valdecir | categoria **Transferência a sócio** + pessoa **Valdecir** |
| Salário Lucimar | categoria **Salário** + pessoa **Lucimar** |

**O que você ganha:** a lista de categorias para de crescer; contratar alguém
não mexe em nada; o DRE mostra "Salários: R$ X" e você **clica e abre por
pessoa**; e comparar mês a mês não quebra quando o time muda.

**O que você perde:** dois campos no lançamento em vez de um. Mas o segundo só
aparece nas categorias que são de pessoa.

**Topa? Ou prefere uma categoria por pessoa, como hoje?**

---

## O DRE proposto

```
RECEITA
  Venda de óleo                            ← vendas

(−) CUSTO DO ÓLEO
  Óleo comprado pelos motoristas           ← coletas (por motorista)
  Óleo pago pela sede                      ← coletas pago_pela_sede + compras_diretas
  Comissão                                 ← Módulo 3 (por vigência)

= MARGEM BRUTA

(−) CUSTOS OPERACIONAIS
  Combustível                              ← abastecimentos
  Troca de óleo · Pneus · Manutenção       ← manutencoes (por tipo)
  Lavagem · Equipamento veículo            ← lançamento
  Custos de viagem                         ← lançamento + despesas do motorista
  Benfeitorias sede                        ← lançamento

(−) DESPESAS FIXAS
  Transferência a sócio (Jean, Valdecir)   ← lançamento + pessoa
  Salários (Lucimar, Lucinei, Luiz)        ← Módulo 3
  Advogado · Contabilidade · Sistema       ← lançamento
  Luz, Internet e Telefone                 ← lançamento
  Seguro Caminhão · IPVA da frota          ← documentos
  Taxas e Licenças · Custos bancários      ← lançamento

= RESULTADO OPERACIONAL

(−) FINANCEIRO
  Empréstimos e financiamentos · Dívidas PF ← lançamento

(−) IMPOSTOS                                ← lançamento

= RESULTADO DO PERÍODO
```

---

## A regra anti-dobra (decisão 3, minha)

Cada real conta **uma vez**, na fonte natural dele:

> Lançamento **com** `origem_tipo` preenchido é espelho de algo operacional
> (abastecimento "assinei a nota", manutenção a prazo, coleta paga pela sede).
> Conta pro **caixa**, nunca pro DRE — o DRE já contou pela fonte.
> Lançamento **sem** `origem_tipo` é gasto próprio e entra no DRE.

**Como eu provo:** um check no E2E que soma o DRE inteiro e compara com a soma
crua de todas as fontes de dinheiro que sai. Se der diferente, ou dobrou ou
sumiu — e o teste fica vermelho antes de você ver na tela.

---

## O que eu construiria

1. **Plano de contas** (`src/lib/dre.ts`) — categorias e grupos em código
2. **Migration** — `fonte` e `pessoa_id` em `contas_a_pagar`, `categoria` passa
   a usar a lista fixa, e reclassificação das 3 contas que já existem
3. **Tela `/admin/lancamentos`** — lançar rápido no ritmo do extrato + filtros
4. **Função `dre(inicio, fim)`** — cada linha da fonte natural, com a regra
   anti-dobra
5. **Tela `/admin/dre`** — o painel, com comparativo do período anterior e
   clique pra abrir o que compõe cada linha
6. **E2E** — o check de conferência acima

**Fora de escopo agora:** rateio por caminhão, margem por comprador, DRE
gerencial vs contábil. Dá pra fazer em cima disso depois.

## ❓ Aberto

1. Além de `$$` e `BB`, **tem outra fonte de dinheiro?**
2. **Quem é o Fumaça?** (apelido de qual motorista, ou pessoa não cadastrada)
3. **Separar categoria de pessoa** (a proposta acima) ou **uma categoria por
   pessoa** como hoje?
