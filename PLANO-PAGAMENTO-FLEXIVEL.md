# Plano — Pagamento flexível e cheques em lote

> Escrito em 15/09/2026, a partir do debate com o Evaner.
> Ler junto com `REGUA-DO-DINHEIRO.md` (as 8 perguntas), `NEGOCIOv3.md`
> (R65–R70, R104) e `CLAUDE.md`.
>
> **Nada aqui foi implementado ainda.** Este documento existe pra ser lido e
> corrigido ANTES de o código ser tocado. O Evaner pediu explicitamente:
> *"não tenho pressa. Faça com calma. À prova de erros. Porque diagnosticar
> erro nesse segmento é muito difícil — vai ver depois de muito tempo."*

---

## Por que isso existe

O dinheiro da empresa não se move em pares limpos. Ele se move assim:

- 3 notas do posto que somam R$ 1.000 são pagas com **1 cheque** de R$ 1.000
- 1 conta de R$ 1.000 é paga com **2 cheques**, de R$ 600 e R$ 400
- das 5 notas do posto, **4 são pagas** e uma fica pra depois
- 4 notas são pagas com **3 cheques + R$ 200 de PIX + R$ 50 em espécie**
- 10 cheques de compradores diferentes são **depositados juntos**, por data
  de "bom para", num maço só

O software hoje só sabe fazer pares limpos: uma conta, uma forma, um cheque.
A única exceção é o **fechamento do posto**, construído em 03/09, que já faz
quase tudo isso — e serve de modelo pro resto.

---

## O que a leitura de produção mostrou (15/09/2026)

Consultas somente leitura, rodadas contra o banco de produção.

### 1. Nenhum estrago no passado

**Zero cheques devolvidos que tinham sido repassados.** O pior cenário
(cheque volta e a reversão pega a conta errada) nunca aconteceu. Não há nada
pra corrigir pra trás.

### 2. O fechamento do posto está correto

O acerto do Texas em 03/09 fecha ao centavo:

```
2 cheques ........ R$ 4.820,20 + R$ 1.257,00 = R$ 6.077,20
17 notas ......... R$ 5.824,75
troco ............ R$   252,45
                   5.824,75 + 252,45 = 6.077,20  ✓
```

O do CENTRO OESTE em 02/09 também (2 cheques + R$ 181,24 em dinheiro, com a
nota da fronteira partida em duas). A peça funciona.

### 3. A amarração cheque↔conta está errada, e dá pra ver

No acerto do Texas, o cheque nº 66 (R$ 1.257,00) tem **zero contas apontando
pra ele** — as 17 notas apontam todas pro cheque 6663. No CENTRO OESTE, o
cheque 1913 (R$ 198,65) idem. É o que o próprio código já assume: *"é
referência, não rateio"*.

### 4. O buraco do valor já disparou uma vez

26/08, `BATERIAS VM 330 — JUNINHO JM BATERIAS`: conta de **R$ 1.360,00**
quitada com um cheque de **R$ 1.355,36**. Pagamento avulso, um cheque só.
**R$ 4,64 de dívida sumiram** e o DRE contou R$ 4,64 a mais.

O valor é ridículo. A mecânica não: o servidor **não compara** o valor do
cheque com o valor da conta. Um cheque de R$ 5.000 pagando uma conta de
R$ 600 marcaria a conta como paga e os R$ 4.400 evaporariam sem uma mensagem.

### 5. O depósito em lote é o que ele está fazendo na mão

Os 10 cheques em `depositado` foram todos depositados em **15/09 — hoje**,
R$ 36.841,69, com "bom para" espalhado de 17/jun a 22/jul. Cheques velhos, de
emitentes diferentes, depositados juntos. Dez cliques, um a um.

E tem outro maço pronto: **37 cheques em carteira (R$ 101.672,25), dos quais
18 já passaram do bom para** — acendendo 18 alertas separados no dashboard.

---

## Mudanças de REGRA decididas neste debate

Estas contradizem o que está escrito hoje no `NEGOCIOv3.md`. Vão ser
aplicadas lá junto com o código, não em silêncio.

### R68 muda — "cheque devolvido: tudo volta" ganha exceção

**Como está escrito hoje:** cheque devolvido reverte a conta a pagar que ele
quitou, sempre.

**Como passa a ser:**

> O que volta depende de existir **correspondência inequívoca** entre aquele
> papel e aquela conta.
>
> - **Pagamento pontual** (um cheque quitou uma conta específica): a conta
>   volta a ser devida. R68 preservada.
> - **Fornecedor com saldo** (o posto, onde várias notinhas viram um acerto):
>   as notinhas **continuam pagas**, e nasce uma **dívida nova do valor do
>   cheque** com aquele fornecedor. O saldo do posto sobe.

Nas palavras do Evaner: *"se pagou 5 notinhas do posto de R$ 1.000 e um
cheque voltou, as notinhas não voltam, mas o saldo volta. É uma conta que de
fato é um saldo a ser pago, e não uma conta."*

**Por que isso é melhor, e não só mais fácil:**

1. **O valor bate sempre.** A dívida vale exatamente o papel que voltou — não
   depende de saber qual fatia de qual nota aquele cheque cobriu.
2. **A data fica certa.** Reabrir a nota de agosto faz ela voltar já vencida.
   A dívida nova nasce hoje, que é quando ela nasceu de verdade.
3. **O troco fica certo.** Se o acerto teve troco, a dívida do valor cheio do
   cheque já embute isso — reverter a nota deixaria o troco solto.

### A assimetria que precisa estar escrita

A **R67-b** diz que repassar cheque também é **receita** no mesmo dia, e que
*"se o cheque voltar, os dois lados se desfazem sozinhos"*. Com a regra nova,
**só um lado se desfaz**:

```
Set: cheque R$ 300 repassado ao posto
     despesa R$ 300 entra  |  receita R$ 300 entra      → resultado 0

Out: o cheque volta
     receita R$ 300 SAI sozinha (o braço lê status='repassado')
     despesa R$ 300 FICA                                 → resultado −R$ 300

Nov: você paga o posto R$ 300 (dívida nova, fora do DRE)  → resultado 0
     o comprador paga por PIX → receita R$ 300 entra      → resultado 0  ✓
```

**No total, a despesa contou uma vez e a receita contou uma vez.** O desvio é
só **entre meses**, nunca no acumulado, e só quando um cheque volta. Aprovado
pelo Evaner: *"bem barato. Super tranquilo."*

### Alertas de cheque: menos, não mais

Decisão do Evaner: *"os alertas têm que ser poucos pra serem objetivos e
olháveis. Se tiver um monte não adianta."*

- **Não** haverá alerta de "cheque depositado há X dias sem compensar". O
  limbo aparece como **card passivo**, número parado na tela.
- Os N alertas de "cheque passou do bom para" viram **um só**, com contagem e
  soma, linkando pro depósito em lote.

---

## O desenho, item a item

Ordem de execução do mais útil-agora pro mais estrutural.

---

## ITEM 1 — Depósito em lote, card do limbo, compensação por maço

### O problema

Depositar é `PATCH /api/admin/cheques/[id]` um por vez. Hoje foram 10 cliques.
E depois que deposita, o cheque entra num estado que **nenhum card mostra**: o
`chequesAbertos` do patrimônio soma carteira + depositado num número só, e os
três cards da tela de cheques falam de carteira, "pra depositar essa semana" e
devolvidos. O depositado não aparece em lugar nenhum.

Se o gestor esquecer de marcar a compensação, aquele dinheiro **nunca entra no
caixa** — e o saldo do app fica menor que o do banco, calado. É exatamente o
tipo de erro que só se descobre muito depois.

### O desenho

**Depósito.** Tela nova na página de cheques: lista de tudo em `em_carteira`,
**ordenada por "bom para" crescente**, ignorando quem é o comprador (é assim
que ele deposita — por data, não por emitente). Checkbox por linha, soma ao
vivo, atalho "marcar todos que já venceram", escolha da **conta bancária** e da
data. A confirmação mostra o total.

**A conta bancária é gravada já no depósito.** Conferido: `cheques.conta_id` é
lido em **um lugar só** no sistema inteiro — a view `movimentos_caixa` — e esse
lugar filtra `status = 'compensado'`. Gravar a conta no depósito **não move um
centavo** do caixa. O dinheiro continua entrando só quando compensa.

**Tudo-ou-nada.** Via PostgREST não existe transação de vários comandos, e um
lote meio-aplicado (8 depositados, 2 na carteira, ninguém sabendo) é o pior
estado possível. Então o depósito vira uma **RPC no Postgres**:

```
depositar_cheques(ids uuid[], conta uuid, quando date)
```

Ela atualiza filtrando `status = 'em_carteira'` e, se o número de linhas
mexidas for diferente do número de ids, **levanta exceção** — a transação
inteira volta atrás e ninguém fica pela metade. A resposta diz quais ficaram de
fora.

**Desfazer o depósito.** Marcou um cheque a mais no maço? Precisa ter volta.
Ação nova, individual: `depositado → em_carteira`, limpando `depositado_em` e
`conta_id`. Só enquanto não compensou.

**Card do limbo.** Quarto card na tela de cheques: *"Depositado, aguardando —
R$ 36.841,69 · 10 cheques"*. Sem alerta.

**Compensação por maço.** O "maço" não precisa de tabela: é simplesmente *mesma
conta bancária + mesma data de depósito*. A tela mostra:

```
Depositado no Bradesco em 15/09 — 10 cheques — R$ 36.841,69
  [x] 748 nº 1435 · R$ 2.950,00
  [x] 756 nº 112  · R$ 3.297,00
  [ ] 041 nº 548  · R$ 5.000,00     <- esse não caiu
  ...
```

Tica os que caíram, confirma. **A conta não se digita de novo** — vem do
próprio cheque. Cheque depositado antes desta mudança tem `conta_id` nulo;
nesse caso a tela pede a conta, como hoje. O que não caiu se resolve
individualmente (devolver), como tem que ser.

### O alerta agrupado

Os N alertas `cheque_vencido:<id>` viram um: *"18 cheques passaram do bom para,
somando R$ X — hora de depositar"*, com link pro lote.

⚠️ **Detalhe sutil:** `alertas_vistos` guarda a dispensa pela chave. Se a chave
for fixa (`cheques_vencidos`), dispensar hoje esconde o alerta **pra sempre**,
inclusive quando outros 20 cheques vencerem. A chave carrega a quantidade
(`cheques_vencidos:18`) — mudou o conjunto, alerta novo. Erra pro lado de
mostrar, que é o lado certo.

### A régua do dinheiro

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Maior que o limite? | Não há limite. Cheque fora da carteira é recusado pelo filtro de status. |
| 2 | Zero ou negativo? | Lote vazio é recusado. O valor do cheque já tem `check (valor > 0)`. |
| 3 | Dois cliques? | O update filtra `status='em_carteira'`; no reenvio dá 0 linhas e a RPC levanta exceção. Nada é gravado duas vezes. |
| 4 | Apagar depois? | Ação "tirar do maço" devolve o cheque pra carteira e limpa data e conta. Só antes de compensar. |
| 5 | Conta duas vezes? | Depósito não mexe no caixa. Nada a dobrar. A compensação continua sendo a única porta do dinheiro. |
| 6 | A tela esconde? | A soma é soma pura, sem `Math.max` nem `?? 0` em cima de valor. |
| 7 | Guard no servidor? | `exigirAdmin()` + a RPC. A tela só guia. |
| 8 | Teste do caminho errado? | e2e: depositar 3 cheques dos quais 1 já está depositado → espera 409 **e os outros 2 intactos na carteira**. |

---

## ITEM 2 — O cheque tem que bater com a conta

### O problema

Pagar uma conta com cheque não compara valor nenhum. Já custou R$ 4,64; pode
custar R$ 4.400.

### O desenho

No pagamento com `forma = 'cheque'`, o servidor compara:

**Cheque igual à conta** → como hoje.

**Cheque MAIOR que a conta** → exige o troco, igual ao fechamento do posto já
faz. Sem informar quanto voltou e em qual conta entrou, o pagamento é
**recusado** — não avisado. O troco vira `entradas_avulsas` tipo reembolso
(soma no caixa, fica fora do DRE, porque não é resultado).

**Cheque MENOR que a conta** → **passa a ser permitido**. A conta original vira
paga pelo valor do cheque e o resto nasce como conta nova em aberto — o mesmo
mecanismo do pagamento parcial que já existe. Hoje isso é recusado
explicitamente (*"pagamento parcial não funciona com cheque"*); essa linha sai.

**É isto que destrava "1 conta de R$ 1.000 paga com 2 cheques" já:** paga com o
de R$ 600, sobra conta de R$ 400, paga com o de R$ 400. Dois cliques, dinheiro
certo, cheque certo.

O caso "menor" usa o antiburro de duas etapas: o primeiro clique mostra *"esse
cheque cobre R$ 600 dos R$ 1.000 — sobram R$ 400 em aberto"*, o segundo
confirma.

### O perigo de partir a conta, e como ele é fechado

Partir uma conta cria **duas linhas com o mesmo `origem_id`**. Isso já mordeu
uma vez: o comentário do fechamento do posto registra que *"duas contas na
mesma origem obrigaram a blindar três `.maybeSingle()` do editor de
abastecimento"* — o `.maybeSingle()` explode quando volta mais de uma linha.

Levantei o resto: existem **6 consultas** que buscam conta por origem esperando
uma linha só, em `coletas/[id]` (2), `compras/[id]`, `despesas/[id]` (3) e
`manutencoes/[id]`. As de abastecimento já foram blindadas em 03/09.

**Antes de partir qualquer conta de origem nova, as 6 viram `.limit(1)` ou
aprendem a lidar com várias.** É trabalho contável, não caça ao fantasma — mas
se for esquecido, o sintoma aparece meses depois, numa tela de edição que
começa a dar erro sem motivo aparente.

### Um buraco que aparece junto

Hoje o troco do fechamento do posto vira uma entrada avulsa **solta**: nada liga
aquele troco ao acerto que o gerou. Apagar o pagamento deixa o troco lá, e o
caixa fica maior que a realidade.

Então `entradas_avulsas` ganha `origem_tipo` e `origem_id` apontando pro cheque.
Desfazer o pagamento desfaz o troco junto — **o desfazer tem que ser tão
completo quanto o fazer**.

### O caso histórico

O BATERIAS de R$ 4,64 **não será corrigido automaticamente**. Provavelmente foi
desconto negociado na hora. Fica registrado aqui; se o Evaner quiser ajustar, é
uma linha de SQL com intenção.

### A régua do dinheiro

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Maior que o limite? | É exatamente o caso. Cheque maior exige troco declarado; sem isso, recusa. |
| 2 | Zero ou negativo? | Troco tem que ser > 0 e igual ao excedente ao centavo. O resto da conta partida tem que ser > 0. |
| 3 | Dois cliques? | O cheque sai da carteira ANTES de quitar a conta, filtrado por `status='em_carteira'` (padrão que já existe). Reenvio dá 409. |
| 4 | Apagar depois? | O DELETE devolve o cheque, reabre a conta, apaga o troco (novo) e devolve os vales. |
| 5 | Conta duas vezes? | O resto vira conta nova com o mesmo `origem_id` — e `jaTemConta` do DRE é um Set, então a origem continua contando uma vez só. |
| 6 | A tela esconde? | O bloco amarelo mostra os três números: valor do cheque, valor da conta, diferença. |
| 7 | Guard no servidor? | A comparação é no endpoint. A tela só antecipa a mensagem. |
| 8 | Teste do caminho errado? | e2e: cheque maior sem troco → 400; cheque menor → conta paga pelo valor do cheque **e** conta nova com o resto exato. |

---

## ITEM 3 — Cheque devolvido vira dívida (ou reverte)

### O desenho

Quando um cheque `repassado` é devolvido, o servidor decide entre dois caminhos:

**Correspondência inequívoca** — o cheque faz parte de um pagamento que quitou
**uma conta só**, e os valores batem → a conta volta a `a_pagar`, como hoje.
R68 preservada.

**Qualquer outro caso** — o cheque fez parte de um maço → nasce uma **conta a
pagar nova**, valor = valor do cheque, com quem recebeu o papel. As notinhas
continuam pagas.

O teste de "faz parte de um maço" é o **`pagamento_id`**: um carimbo (uuid) que
todas as contas e todos os cheques de um mesmo acerto recebem. Cheque carimbado
com um acerto que tem mais de uma conta ou mais de um meio é maço.

⚠️ **O `pagamento_id` nasce AQUI, no ITEM 3, não no ITEM 4.** O ITEM 4 é quem
mais usa, mas ele vem depois — e o ITEM 3 não pode depender de código que ainda
não existe. Então a coluna é criada neste item, e o **fechamento do posto**
(que já existe e já produz maços hoje) passa a carimbar imediatamente. Quando o
ITEM 4 chegar, o mecanismo já está rodando e testado.

Para os pagamentos **antigos**, que nunca receberão carimbo, o teste de reserva
é o que já dá pra ver hoje: **uma conta apontando, com o mesmo valor** →
reverte; qualquer outra combinação → dívida nova.

### O que muda no banco

| Mudança | Por quê |
|---|---|
| `contas_a_pagar.pagamento_id` e `cheques.pagamento_id` | O carimbo do acerto. Não é tabela nem FK — é um uuid que agrupa. Resolve o teste do maço aqui e o desfazer no ITEM 4. |
| `cheques.repassado_local_id` | Hoje `repassado_para` é texto livre ("Texas", "TEXAS RODOVIA", "Posto texas" — as três grafias existem em produção). Dívida precisa ir pro posto certo, não pro nome certo. |
| `contas_a_pagar.local_id` | Pra dívida aparecer no saldo do posto. |
| `saldo_postos()` ganha um terceiro braço | Ela só soma dívida vinda de abastecimento ou despesa com `local_id`. Sem isso a dívida nasceria e **não apareceria na tela do posto** — ou seja, o "o saldo volta" não aconteceria de verdade. |
| Categoria `cheque_devolvido`, grupo `neutro` | O gasto já contou quando o cheque foi repassado. Se a dívida nova entrar como combustível, o mesmo litro conta duas vezes. O grupo `neutro` fica **fora do DRE**, como as transferências. |
| `origem_tipo='cheque_devolvido'`, `origem_id=<id do cheque>` | Idempotência: devolver duas vezes não cria duas dívidas. |

⚠️ `origem_id` é um espaço de nomes compartilhado entre tipos, e o `jaTemConta`
do DRE junta todos num Set só. Um id de cheque nunca vai colidir com um id de
abastecimento (são uuids), mas fica registrado que a mistura existe.

### A régua do dinheiro

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Maior que o limite? | A dívida vale exatamente o papel. Não há como passar. |
| 2 | Zero ou negativo? | Valor do cheque já é `> 0` por CHECK. |
| 3 | Dois cliques? | `origem_id` único por cheque impede a segunda dívida. A transição já filtra o status de origem. |
| 4 | Apagar depois? | **Desfazer uma devolução não existe hoje** e continua não existindo. Fica registrado como limitação conhecida, não como coisa esquecida. |
| 5 | Conta duas vezes? | É o risco central. Resolvido pelo grupo `neutro` fora do DRE. **O e2e mede o DRE antes e depois de uma devolução e exige que o resultado não mude por causa da dívida nova.** |
| 6 | A tela esconde? | A resposta diz, em português, o que foi feito: "a nota continua paga; nasceu uma dívida de R$ X com o Posto Y". Desfazer calado é pior que não desfazer. |
| 7 | Guard no servidor? | Tudo no endpoint da transição. |
| 8 | Teste do caminho errado? | e2e nos dois ramos: devolver cheque de pagamento pontual (espera conta reaberta) e de maço (espera dívida nova com o valor do cheque, e nenhuma nota reaberta). |

---

## ITEM 4 — Pagamento em lote de contas a pagar

O grosso. **N contas pagas por M meios**, onde meio é um cheque ou um valor
saindo de uma conta financeira (dinheiro, PIX, depósito, boleto).

### A escolha de desenho: o banco parte, a tela junta

Duas saídas foram consideradas.

**Tabela de pagamentos** (`pagamentos` + `pagamento_itens` + `pagamento_meios`)
é a modelagem academicamente correta: as contas ficam inteiras, os cheques ficam
inteiros, cada real tem endereço. Mas obriga a reescrever `movimentos_caixa`,
que é **a fonte do dinheiro** — e ela só subiu, em 0068, porque os saldos das
três contas ficaram idênticos ao centavo. Mais o backfill de todo o histórico.
Semanas de risco em cima do coração financeiro.

**O banco parte, a tela junta** chega no mesmo resultado visível: cada pedaço de
conta carrega **exatamente um meio**, então `forma_pagamento`, `conta_id` e
`cheque_id` continuam 1:1 e **nada** muda na `movimentos_caixa`, na
`saldo_contas()` nem no DRE. A tela reagrupa os pedaços numa linha só.

E tem um ganho que não é cosmético: **partir por meio faz o `cheque_id` parar de
mentir.** Hoje o fechamento do posto joga todas as notas-de-cheque no primeiro
cheque. Com um meio por pedaço, a amarração vira verdade.

É esta a escolhida.

### Como fica na tela

```
Contador — R$ 1.000,00                     pago em 15/09
  +- R$ 600,00  dinheiro (Banco do Brasil)
  +- R$ 400,00  cheque BB nº 1234
```

Uma coluna nova, `contas_a_pagar.conta_pai_id`, liga o pedaço à conta original.
A tela agrupa por ela.

### Como fica no fluxo

1. Seleciona N contas (checkbox, como o bulk delete de coletas já faz)
2. Monta os meios: marca M cheques da carteira, acrescenta quantas linhas de
   dinheiro/PIX/depósito quiser, cada uma com sua conta financeira
3. A tela mostra os dois lados somados e a diferença, **antes** de confirmar
4. Falta pagamento → recusa, dizendo quanto falta
5. Sobra pagamento → exige o troco declarado, com a conta em que entrou
6. O servidor aloca por ordem de vencimento; onde a fronteira cai no meio de uma
   conta, ela é partida e o pedaço ganha `conta_pai_id`

### Desfazer

Uma coluna `pagamento_id uuid` em `contas_a_pagar` **e** em `cheques` carimba
tudo que nasceu do mesmo acerto. Não é tabela, não é FK — é um carimbo. Com ele:

- desfazer o acerto inteiro devolve todos os cheques, reabre todas as contas,
  junta os pedaços de volta e apaga o troco
- "esse cheque pagou o quê?" passa a ter resposta
- o ITEM 3 sabe distinguir pagamento pontual de maço

O `pagamento_id` é gerado **no navegador** e mandado junto: se a resposta se
perder e o gestor clicar de novo, o servidor vê que aquele acerto já existe e
não paga duas vezes. Mesmo mecanismo do `client_id` do celular.

### A régua do dinheiro

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Maior que o limite? | Pagamento acima do total exige troco declarado, com conta. Recusa sem isso. |
| 2 | Zero ou negativo? | Nenhum pedaço pode nascer com valor ≤ 0. Lote sem conta ou sem meio é recusado. |
| 3 | Dois cliques? | `pagamento_id` único, gerado no cliente. Mais o filtro `status='a_pagar'` em cada conta e `status='em_carteira'` em cada cheque. |
| 4 | Apagar depois? | Desfazer por `pagamento_id`: cheques voltam, contas reabrem, pedaços se juntam, troco some. |
| 5 | Conta duas vezes? | Os pedaços somam o valor original e cada um conta uma vez. **O e2e soma os pedaços e exige igualdade exata com a conta-mãe.** |
| 6 | A tela esconde? | A diferença entre o que se deve e o que se paga é mostrada com sinal, sempre — inclusive quando é zero. |
| 7 | Guard no servidor? | O servidor **relê as contas e os cheques** e refaz a conta. Não confia em nenhum total vindo da tela (é o que o fechamento do posto já faz). |
| 8 | Teste do caminho errado? | e2e: lote que não cobre o total → 400; lote que sobra sem troco → 400; lote com um cheque já usado → 409 **e nenhuma conta marcada como paga**. |

---

## ITEM 5 — Vários meios no fechamento do posto

Hoje o fechamento aceita **um** pagamento não-cheque por acerto. O caso "3
cheques + R$ 200 PIX + R$ 50 espécie" não passa.

Depois do ITEM 4 isso deixa de ser código novo: o fechamento passa a usar o
mesmo motor, com as notas do posto no lugar das contas. A tela do posto guarda o
que é dela — a curadoria de grafias, o extrato, o saldo.

---

## O que NÃO vai ser feito, e por quê

| Descartado | Motivo |
|---|---|
| Tabela `pagamentos` / `pagamento_itens` / `pagamento_meios` | Obriga a reescrever `movimentos_caixa`. Mesmo resultado visível por um preço muito maior. |
| Amarrar recebimento a venda (N:M) | Decisão do Evaner: o comprador é **conta corrente**. Venda aumenta o saldo, pagamento diminui. Não existe "essa venda foi paga" porque a pergunta não é essa. |
| Alerta de cheque depositado parado | R130 — o Evaner já cortou dois alertas de cheque. O limbo vira card passivo. |
| Cheque pagando parte de uma conta e sobrando "crédito" com o fornecedor | Não existe na prática. Sobra é troco, e troco tem que voltar em dinheiro. |
| Desfazer uma devolução de cheque | Não existe hoje e não entra agora. Registrado como limitação conhecida. |
| Mexer no acerto com motorista | O acerto é corte no tempo, não seleção de itens. Nada a fazer. |
| Corrigir o BATERIAS de R$ 4,64 automaticamente | Provável desconto negociado. Se for pra mexer, é SQL com intenção. |

---

## Ordem de execução

| # | Item | Por que nesta posição |
|---|---|---|
| 1 | Depósito em lote + card do limbo + compensação por maço + alerta agrupado | É o que ele faz na mão esta semana, com R$ 138 mil passando pela carteira. Não toca no caixa. |
| 2 | Cheque × valor da conta | Buraco aberto que já disparou. Pequeno, isolado, e destrava "1 conta, 2 cheques". |
| 3 | Cheque devolvido vira dívida | Regra nova. Precisa da R68 reescrita no `NEGOCIOv3.md`. |
| 4 | Pagamento em lote de contas a pagar | O grosso. Reusa o `pagamento_id` criado no ITEM 3, já rodando no fechamento do posto. Exige as 6 `.maybeSingle()` blindadas antes. |
| 5 | Vários meios no fechamento do posto | Cai quase de graça depois do 4. |

Cada item sobe sozinho, com seus casos no `scripts/e2e-modulo1.mjs`, e é testado
em produção pelo Evaner antes do próximo começar.

As migrations começam na **0071** (a última aplicada é a 0070).

---

## Documentos que mudam junto

- `NEGOCIOv3.md` — R68 reescrita; R67-b ganha a nota da assimetria; a Parte XII
  perde o item 5 ("o cheque, nos dois sentidos") e o item 6 (alertas de cheque)
  conforme forem fechando.
- `CLAUDE.md` — as migrations novas na lista, e a nota de que `cheques.conta_id`
  passa a ser gravado no depósito (e por que isso é seguro).
- `ESTADO.md` — onde parou.
