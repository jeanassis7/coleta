# DRE — desenho pra aprovação

> **Isto não é plano de execução.** É o modelo, pra você revisar antes de eu
> escrever qualquer linha. As decisões em aberto estão marcadas com ❓.

Base: a lista que você mandou em 19/08/2026, com as 4 seções separadas por
linha em branco.

---

## A descoberta que muda o trabalho

**Você não precisa lançar quase nada disso de novo.** Metade das suas linhas
já existe como dado estruturado no sistema:

| Sua linha | De onde já sai hoje |
|---|---|
| Óleo pago pela sede | `coletas.pago_pela_sede` (0021) + `compras_diretas` |
| Lucimar / Nei / Fumaça — Dinheiro em mãos | `adiantamentos` aceitos |
| Combustível | `abastecimentos` |
| Troca de óleo | `manutencoes` tipo `troca_oleo` |
| Pneus | `manutencoes` tipo `pneu` |
| Manutenção | `manutencoes` tipo `revisao`/`corretiva`/`outro` |
| Seguro Caminhão | `documentos` tipo `seguro` → conta prevista |
| IPVA da frota | `documentos` tipo `ipva` → conta prevista |
| Salários Lucimar/Lucinei/Luiz | Módulo 3 (a construir) |

O resto — pró-labore, advogado, contabilidade, luz/internet/telefone, taxas,
banco, sistema, lavagem, equipamento, benfeitorias, viagem, empréstimos,
dívidas PF, impostos — **é conta a pagar lançada na mão**, que já existe.

Então o DRE **não é tabela nova**. É:

1. um **plano de contas** (a sua lista virando uma lista fixa no código), e
2. uma **função que soma cada linha da fonte natural dela**.

---

## ❓ Decisão 1 — "Dinheiro em mãos" não é despesa

Sua lista tem *Lucimar / Nei / Fumaça — Dinheiro em mãos* como custo. **Em DRE
isso não é gasto: é transferência de caixa.** O dinheiro sai do seu bolso e
entra no bolso dele, mas o **gasto** só acontece quando ele usa — pagando uma
coleta, abastecendo, ou numa despesa.

Se o DRE contar o adiantamento **e** as coletas que ele pagou com aquele
dinheiro, **o mesmo real é contado duas vezes** e o resultado fica pior do que
é.

Minha proposta: **adiantamento sai do DRE e fica só no fluxo de caixa**. O que
entra no DRE é o que ele efetivamente gastou (coletas, combustível, despesas),
que o sistema já sabe uma a uma.

Se hoje a sua planilha conta o adiantamento e **não** conta as coletas, os dois
jeitos dão o mesmo total — mas o meu mostra **em que** o dinheiro foi.

**Você concorda em tirar do DRE?**

---

## ❓ Decisão 2 — competência ou caixa?

- **Caixa:** a conta entra no mês em que foi **paga**. É como sua planilha
  parece funcionar hoje.
- **Competência:** entra no mês em que o gasto **aconteceu**. O IPVA de 2027
  pesa em 2027 mesmo que você pague em janeiro; a manutenção de março pesa em
  março mesmo pagando em abril.

Competência é o que faz o DRE responder *"esse mês foi bom?"* sem o resultado
pular por causa de quando o boleto venceu. Caixa responde *"sobrou dinheiro?"*
— que é a pergunta do **fluxo de caixa**, e essa você já tem em Contas a pagar.

Minha proposta: **DRE por competência**, fluxo de caixa por caixa. Os dois
convivem e respondem coisas diferentes.

**Qual você quer?**

---

## ❓ Decisão 3 — a regra anti-dobra

Um mesmo gasto pode aparecer em dois lugares por desenho: abastecimento com
*"assinei a nota"* vira `abastecimento` **e** `conta_a_pagar`; manutenção a
prazo idem; coleta paga pela sede idem.

A boa notícia é que a ligação já existe: essas contas têm `origem_tipo`
preenchido. Hoje há 2 contas assim, ambas de coleta.

**Regra proposta, uma linha:**

> Conta a pagar **com** `origem_tipo` é espelho de um lançamento operacional —
> conta pro **fluxo de caixa**, nunca pro DRE. Conta **sem** `origem_tipo` é
> gasto próprio e entra no DRE.

Assim cada real é contado exatamente uma vez, e a máquina que faz isso já está
no banco.

**Ok?**

---

## ❓ Decisão 4 — quem são Valdecir e Fumaça?

*Pro-Labore Valdecir* e *Fumaça — Dinheiro em mãos* aparecem na sua lista mas
**não existem no sistema**. Os perfis cadastrados são Jean, Evaner, Luis,
Lucimar, Lucinei, Suzana, Evanerteste e Teste 1.

- **Fumaça** é apelido de um dos motoristas? De qual?
- **Valdecir** é sócio? Precisa de perfil, ou é só uma linha de despesa?

Isso muda se a linha é "salário de um motorista cadastrado" (vem do Módulo 3)
ou "conta a pagar recorrente" (vem de Contas a pagar).

---

## O DRE proposto

Sua lista mais a receita, que faltava (sua planilha parece ser só de custo).

```
RECEITA
  Venda de óleo                            ← vendas.valor_total

(−) CUSTO DO ÓLEO VENDIDO
  Óleo pago pelo motorista                 ← coletas.valor_pago (não sede)
  Óleo pago pela sede                      ← coletas pago_pela_sede + compras_diretas
  Comissão dos motoristas                  ← Módulo 3

= MARGEM BRUTA                             ← quanto sobra do óleo em si

(−) CUSTOS OPERACIONAIS
  Combustível                              ← abastecimentos
  Troca de óleo                            ← manutencoes tipo troca_oleo
  Pneus                                    ← manutencoes tipo pneu
  Manutenção                               ← manutencoes (revisao/corretiva/outro)
  Lavagem de caminhão                      ← conta a pagar
  Equipamento veículo                      ← conta a pagar
  Custos de viagem                         ← conta a pagar / despesas
  Benfeitorias sede                        ← conta a pagar

(−) DESPESAS FIXAS
  Pró-labore Jean                          ← conta a pagar (recorrente)
  Pró-labore Valdecir                      ← ❓ decisão 4
  Salários (Lucimar, Lucinei, Luiz)        ← Módulo 3
  Custo César advogado                     ← conta a pagar
  Contabilidade                            ← conta a pagar (recorrente)
  Luz, Internet e Telefone                 ← conta a pagar (recorrente)
  Seguro Caminhão                          ← documentos tipo seguro
  IPVA da frota                            ← documentos tipo ipva
  Taxas e Licenças                         ← conta a pagar
  Custos de contas bancárias               ← conta a pagar (recorrente)
  Sistema                                  ← conta a pagar (recorrente)

= RESULTADO OPERACIONAL

(−) FINANCEIRO
  Empréstimos e financiamentos             ← conta a pagar
  Dívidas PF                               ← conta a pagar

(−) IMPOSTOS
  Impostos                                 ← conta a pagar

= RESULTADO DO PERÍODO
```

**O que acrescentei ao seu:** a receita, a **margem bruta** e o **resultado
operacional**. São duas linhas de corte que respondem perguntas diferentes:
*"o óleo em si dá lucro?"* e *"a operação se paga antes de banco e imposto?"*.
Se você achar que polui, tiro.

---

## O que eu construiria

1. **Plano de contas** (`src/lib/dre.ts`) — a lista acima virando código, cada
   linha com seu grupo e sua fonte. Fixa, como os tipos de documento — nova
   linha é deploy, não migration.
2. **`contas_a_pagar.categoria` passa a usar essa lista** — hoje é texto livre
   com uma convenção de 6 valores em comentário, o que não sustenta 30 linhas.
   Precisa de migration pra reclassificar as contas que já existem (são 3).
3. **Função `dre(inicio, fim)`** — soma cada linha da fonte natural, aplicando
   a regra anti-dobra.
4. **Tela `/admin/dre`** — as linhas acima, com o comparativo do período
   anterior (mesma convenção do dashboard) e clique pra ver o que compõe.

**Fora de escopo:** rateio por caminhão, custo fixo vs variável por kg, margem
por comprador. Dá pra fazer depois em cima disso; agora seria adivinhar.
