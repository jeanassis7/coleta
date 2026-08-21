# Varredura — o sistema fechado de dinheiro

> **PLACAR 21/08/2026 — encerrada.** A rodada de edição fechou os itens
> 12, 15-21, 39, 40, 42; a rodada final (autorização "o restante pode
> implementar") fechou 1-11, 13, 14, 23-30, 32 (versão leve), 33-35, 37,
> 38 (nota), 43-47 — migrations 0047-0050. O **41 virou decisão**: apagar
> forçado leva tudo MESMO (é o erase de perfil simulado), e a blindagem é a
> coluna `profiles.protegido` (0049) nos perfis reais. Ficaram DE FORA, com
> justificativa: **31** (cheque desamarrado de comprador — invasivo, sem
> caso real) e **36** (acerto retroativo — exige recalcular saldo num
> instante passado; o "Desfazer último acerto" cobre o erro comum). O texto
> abaixo fica como registro do diagnóstico.

> **20/08/2026.** Pedido do Evaner antes dos lançamentos reais: *"de algum
> lugar tem que ir pra outro — varredura COMPLETA de que aba e que parte o
> dinheiro pode ir pra outro lugar que falta campos ou formas."*
>
> Método: 4 auditorias em paralelo (coletas · despesas/abastecimentos/
> manutenções · vendas/cheques/compras diretas · caixa/contas/adiantamentos/
> folha/documentos), cada uma lendo migrations, endpoints e telas, com os
> achados mais graves conferidos de novo na mão. Toda afirmação tem
> arquivo:linha.
>
> **Isto é diagnóstico, não conserto.** Nada foi alterado no código.
> Os itens são numerados de 1 a 47 pra você responder item a item.

---

## O que está SÓLIDO (pra dar a régua)

Antes dos buracos, o que a varredura confirmou que está bem construído:

- **Toda saída à vista exige conta** — adiantamento, acerto, compra direta,
  manutenção à vista, lançamento do extrato: todos recusam sem `conta_id`.
- **Cheque com dois relógios** (quita a dívida do comprador na entrega, vira
  dinheiro só na compensação) está certinho, incluindo o tudo-ou-nada da
  devolução (M4) e o repasse como receita (R67-b).
- **Adiantamento retroativo da virada** funciona exatamente como desenhado:
  datado antes do corte não mexe no caixa, e o aceite corrige o saldo.
- **Documento com valor vira conta prevista** (R81) — implementado, com
  sincronização na renovação.
- **Apagar conta paga devolve o dinheiro** pro saldo da conta financeira e
  desfaz cheque repassado e vale quitado, avisando o que desfez.

O problema não é o desenho do fluxo principal. É que (a) **faltam portas de
entrada e formas de pagamento** pra situações reais, e (b) **quase nada pode
ser corrigido depois de lançado** — e o caminho de correção que existe
(apagar) muitas vezes não desfaz o dinheiro amarrado.

---

# GRUPO A — Dinheiro que ENTRA e não tem porta

*(estrutural — o caixa nunca mais fecha com o extrato quando acontecer)*

### 1. Não existe NENHUMA entrada de dinheiro que não seja venda de óleo — CRÍTICO

As entradas do `saldo_contas()` são só 4: recebimento de comprador,
transferência entre contas, acerto devolvido e cheque compensado
(`0042_corte_do_caixa_em_dia_br.sql:33-55`). E recebimento **exige
comprador** (`src/app/api/admin/recebimentos/route.ts:22-24`).

Explicando pra criança: o sistema conhece um jeito só de dinheiro aparecer
na conta — alguém pagou óleo. Qualquer outro dinheiro que cair na conta do
Banco do Brasil deixa o saldo do sistema **menor que o extrato pra sempre**,
porque não tem onde lançar:

| Cenário real | Tem onde lançar? |
|---|---|
| Jean põe R$ 20.000 do bolso na empresa (aporte) | ❌ |
| Empréstimo bancário recebido | ❌ (`emprestimos` no plano é só SAÍDA) |
| Rendimento de aplicação | ❌ |
| Venda de caminhão velho / sucata / tambores | ❌ |
| Reembolso (seguro, fornecedor, imposto pago a maior) | ❌ |
| Estorno de pagamento | ❌ |

Nota: a decisão "SEM outras-receitas, só óleo entra" (debate de 20/08) valia
pro **DRE** — aporte e empréstimo não são receita mesmo, são dinheiro
entrando sem ser resultado. Mas o **caixa** precisa registrá-los, senão não
fecha. São duas perguntas diferentes.

### 2. Não existe "ajuste de caixa" (conferi a gaveta e a conta não bate) — CRÍTICO

O **estoque** tem inventário com motivo obrigatório
(`src/app/api/admin/estoque/ajuste/route.ts:40`, tabela `ajustes_estoque`).
O **caixa não tem nada equivalente**: se o Jean contar a gaveta de espécie e
achar R$ 50 a menos, as três saídas são todas ruins — inventar um lançamento
com categoria errada (polui o DRE), inventar uma transferência (não fecha) ou
mexer no saldo inicial (que nem tela tem — item 21). Num sistema fechado, a
conferência física precisa de contrapartida, igual o estoque já tem.

---

# GRUPO B — Coleta paga pela sede (o exemplo do Evaner)

### 3. Coleta retroativa não pode nascer "paga pela sede" — ALTO

O POST de coleta pelo painel **não aceita** `pago_pela_sede`
(`src/app/api/admin/coletas/route.ts:78-91` — conferido: o campo só existe no
PATCH). Pra lançar uma coleta retroativa que a sede pagou são **dois
passos**: criar (descontando do motorista, errado) e depois abrir o drawer e
marcar. Se o admin esquecer o passo 2, o motorista fica devendo um dinheiro
que a empresa gastou — exatamente o bug que a migration 0021 nasceu pra
matar.

### 4. Coleta da sede com valor R$ 0 → o dinheiro evapora ao corrigir — ALTO

`src/app/api/admin/coletas/[id]/route.ts:125` só cria a conta `if (valor >
0)`. Se marcar "sede" com valor 0 e depois corrigir pra R$ 5.000, o ajuste
(`:201-218`) faz update numa conta **que nunca existiu** — 0 linhas, sem
erro. Resultado: R$ 5.000 que não descontam do motorista, não são conta a
pagar e não entram no DRE. Sumiu.

### 5. Apagar coleta não desfaz a conta amarrada (2 dos 4 caminhos) — ALTO

- Drawer "Excluir coleta": `DrawerDetalhe.tsx:106-121` deleta **direto do
  navegador**, sem passar pela API — não desfaz a conta E não entra no
  `/admin/log` (o trigger da 0022 só grava com service key).
- Bulk-delete: `bulk-delete/route.ts:45` — idem, não desfaz.
- Apagar a **carga** faz certo (`cargas/[id]/route.ts:50-73`) — a lógica boa
  existe e não foi reaproveitada.

Sobra uma conta a pagar órfã: a empresa "deve" por um óleo que não existe
mais. Se pagarem essa conta, sai dinheiro real sem lastro.

### 6. Editar valor de coleta da sede com conta JÁ PAGA: divergência muda — MÉDIO

`coletas/[id]/route.ts:201-218` só ajusta conta `prevista|a_pagar`. Conta
paga: a coleta muda, a conta não, e ninguém avisa (retorna `ok:true` sem
aviso). O estoque passa a usar o valor novo e o DRE o antigo — dois números
pro mesmo óleo.

### 7. "Pago pela sede" é invisível fora do modo edição — MÉDIO

Nem o drawer (`DrawerDetalhe.tsx:215-245`), nem a lista
(`ListaColetas.tsx:162-183`), nem o CSV mostram o flag. Risco direto: marcar
duas vezes, ou pagar o fornecedor duas vezes.

### 8. Coleta que sincroniza DEPOIS do acerto: dinheiro que nunca volta — ALTO

Cenário real com o cronograma da virada: motorista offline no interior,
Jean faz o acerto, a coleta chega depois com `criado_em` anterior ao corte.
Ela cai no ciclo **fechado** — não desconta do saldo atual, e não existe
nenhum mecanismo de reconciliação (nem lançamento de ajuste, nem reabertura).
O motorista pagou do bolso e o sistema nunca devolve; o único jeito é embutir
na mão no próximo acerto, sem rastro. De quebra, a mesma coleta ainda entra
no DRE do mês passado. O mesmo vale pra retroativa lançada pelo painel com
data antiga (a tela avisa, mas não resolve).

### 9. Miúdos do mesmo tema — BAIXO

- Drawer recusa corrigir valor pra R$ 0 (`DrawerDetalhe.tsx:135-138`),
  contrariando a 0031 (doação) — API e banco aceitam, a tela não.
- Sem unique em `(origem_tipo, origem_id)` de `contas_a_pagar`: dois admins
  salvando o mesmo drawer juntos = duas dívidas pro mesmo óleo.
- Cancelar/apagar a conta pelo lado de Contas a pagar não desmarca
  `pago_pela_sede` da coleta → mesma evaporação do item 4.
- A conta gerada não mostra de qual coleta veio (`ContasPainel` não exibe
  origem) e o `fornecedor` não acompanha quando o nome do local é editado.

---

# GRUPO C — Sede pagando gasto de campo (o gêmeo do exemplo)

### 10. Abastecimento pago direto pela sede: DRE conta, caixa NÃO — CRÍTICO

`abastecimentos` **não tem `conta_id`** (conferido nas migrations — compras
diretas ganharam o dele na 0035; abastecimento nunca ganhou o equivalente).
Lançar pelo painel um abastecimento "pagou agora" com motorista nulo
(`src/app/api/admin/lancamentos/route.ts:47-94`):
- não sai do saldo de nenhum motorista (motorista nulo);
- não sai de nenhuma conta (`saldo_contas()` não conhece abastecimentos);
- **entra no DRE como despesa** (`dre.ts:220-222`).

Todo diesel pago no cartão/pix da empresa infla o saldo das contas pra
sempre. O contorno de hoje é mentir ("assinei a nota" + pagar a conta em
seguida), que registra data errada e descrição errada.

### 11. Despesa não tem "assinei a nota" NEM "sede pagou" — ALTO

`despesas` não tem `pago_na_hora`, não tem `conta_id`, e `origem_tipo` de
contas a pagar **nem aceita `'despesa'`** (`0021:105`). Dois efeitos:
- **No campo:** borracharia que fia, hotel faturado — o motorista é obrigado
  a lançar como se tivesse pago do bolso, e o saldo dele fica errado pra
  menos (ele recebe a menos no acerto). A 0018 resolveu isso pro combustível
  e esqueceu a despesa.
- **Na sede:** despesa paga por pix da empresa cai no mesmo buraco do item
  10 (DRE conta, caixa não).

### 12. "PAGUEI AGORA" ↔ "ASSINEI A NOTA" é irreversível — ALTO

O PATCH de abastecimento não aceita `pago_na_hora`
(`abastecimentos/[id]/route.ts:19-47`) e o trigger 0034 é **só INSERT**
(`0034:58-63`). Motorista que aperta o botão errado — vai acontecer — não
tem correção: só apagar e relançar com a data errada. E um flip direto no
banco produziria gasto contado zero vezes.

### 13. Lançamento avulso do painel é INVISÍVEL na tela que o cria — ALTO

As queries de `/admin/abastecimentos` e `/admin/despesas` usam
`!inner(nome)` com motorista/carga (`queries.ts:404-408, 476-481`) — e o
avulso tem os dois nulos, então o INNER JOIN o descarta. O botão "+ Lançar
pelo painel" cria uma linha que **nunca aparece ali** — e portanto não pode
ser editada nem apagada por tela nenhuma. Combinado com o item 10: dinheiro
que sai do DRE, não sai do caixa, e não tem como corrigir.

### 14. Dobra em "Custos de viagem" — MÉDIO

`dre.ts:302-305` soma as contas pagas da categoria **e** todas as despesas
do período, sem anti-dobra (despesa não pode ter `origem_id`). Se o Jean
lançar a despesa no painel E o pagamento no extrato, conta duas vezes.

---

# GRUPO D — Lançado é pedra (o que não pode ser corrigido depois)

*O padrão que atravessa o sistema inteiro: quase todo registro de dinheiro é
write-only. Errou → SQL na mão. Com Jean começando a lançar de verdade,
errar é questão de quando.*

### 15. RECEBIMENTO: sem editar, sem apagar — CRÍTICO

Não existe `recebimentos/[id]` (conferido). Um recebimento de R$ 20.000
digitado como R$ 200.000, ou na conta errada, ou no comprador errado, mente
no saldo do comprador, no caixa e na receita do DRE **pra sempre**. Agrava:
a ficha do comprador nem mostra em qual conta o dinheiro caiu — o erro é
invisível.

### 16. CHEQUE: só o status anda; os dados são pedra — CRÍTICO

`cheques/[id]/route.ts` só troca status. Valor, banco, emitente, "bom para"
e a conta da compensação **não são editáveis**, e não há DELETE. O maço vem
de OCR — valor lido errado corrompe o saldo do comprador sem porta de saída
(o recebimento amarrado também não pode ser apagado, item 15).

### 17. ACERTO: sem editar, sem apagar — e é o único ponto de reconciliação — ALTO

`acertos/` só tem POST (conferido). Acerto com valor trocado move o corte de
tudo, o caixa e o carry do próximo ciclo — irreversível pela tela. É o furo
mais caro do módulo do motorista, e acerto é justamente o que o Jean vai
fazer nas próximas semanas na virada.

### 18. VENDA: sem editar (e o delete deixa crédito solto) — ALTO

Só existe DELETE. Errou peso/preço/data/comprador → apagar e relançar. Ao
apagar venda já recebida, os recebimentos sobrevivem (FK `set null`) e o
comprador fica com crédito eterno — sem aviso de que isso precisa virar
alguma coisa.

### 19. CONTA FINANCEIRA: o PATCH existe, a tela NÃO — ALTO ⚠️ *urgente pra largada*

Nenhum componente chama o PATCH/DELETE de `contas-financeiras` (a única
referência na UI é o POST de criação, `CaixaPainel.tsx:105`). Ou seja:
- **errou o saldo inicial no cadastro → não tem como corrigir pela tela** —
  e o cadastro das contas é literalmente o próximo passo da largada;
- conta encerrada não pode ser desativada — fica no dropdown pra sempre.

### 20. CONTA PAGA é imutável — e a que veio de origem nem apagar dá — ALTO

Categoria, pessoa, data de pagamento e conta de uma conta paga não são
editáveis em lugar nenhum. O caminho é apagar e refazer — mas a tela de
Lançamentos **esconde o Apagar quando a conta tem origem**
(`LancamentosPainel.tsx:433,465`). Pagamento de abastecimento/manutenção/
coleta/compra/documento com categoria ou data errada = só SQL.

### 21. MANUTENÇÃO: o PATCH existe e nenhuma tela chama — MÉDIO

`HistoricoManutencao.tsx` só tem criar e apagar. E o insert é em duas etapas
sem transação: se a conta falhar depois da manutenção, fica manutenção sem
contrapartida financeira (a API avisa, mas fica assim).

### 22. Miúdos do tema — BAIXO

- Transferência: sem editar (apagar e refazer funciona e o saldo recalcula —
  aceitável, só quebra a continuidade do log).
- Data e motorista de coleta imutáveis: corrigir exige apagar/recriar, que
  cai no item 5.
- Os avisos de dessincronização que as APIs devolvem (`{ok:true, aviso}`)
  **nunca são exibidos** — `TabelaAbastecimentos` e afins só tratam `!res.ok`.
  Toda a rede de proteção escrita nos comentários é invisível na prática.

---

# GRUPO E — Formas de pagar/receber que a vida real tem e o sistema não

### 23. Pagamento PARCIAL de conta a pagar — ALTO

A máquina é binária (`a_pagar → paga`), pelo valor cheio. "Paguei metade
hoje, metade mês que vem" não existe — os contornos (editar o valor e criar
outra conta na mão) perdem o vínculo da dívida.

### 24. Juros e multa de conta atrasada — ALTO

Zero ocorrências no código. Boleto de R$ 1.000 pago com R$ 1.043,20: ou o
caixa não fecha, ou os R$ 43,20 entram disfarçados na categoria original.
Não há categoria "Juros e multas" no plano.

### 25. Desconto na venda / perdão de dívida do comprador — ALTO

Venda não tem campo de desconto (dar desconto = falsificar o preço/kg). E
comprador que pagou R$ 49.700 numa dívida de R$ 50.000 "e tá quitado" não
tem como ser zerado sem **mentir pro caixa** (recebimento falso de R$ 300
infla a conta financeira e a receita — e recebimento não pode ser apagado,
item 15). Falta um "abatimento": baixa o saldo do comprador sem passar por
conta financeira, com motivo.

### 26. Compra direta A PRAZO — ALTO

"Devo R$ 8.000 de óleo ao Zé, pago sexta" é **impossível de registrar**: o
POST exige conta ou cheque, e criar a conta na mão é bloqueado porque
`oleo_sede` é categoria automática. As colunas de parcelamento existem desde
a 0019 e um comentário no plano-contas afirma que funciona — não funciona.

### 27. Motorista devolvendo troco no meio do ciclo — MÉDIO

A única entrada de dinheiro vindo de motorista é o acerto, que é
tudo-ou-nada e reseta o corte do ciclo inteiro. Devolução parcial ("toma
R$ 500 de volta, continuo rodando") obriga a fechar um acerto falso.

### 28. Estornar adiantamento ACEITO — MÉDIO

Impossível pelo sistema (a API manda "ajusta no próximo acerto", que
contamina o histórico). Mandou errado e o motorista aceitou = sem volta.

### 29. Cheque de valor ≠ conta: o troco evapora e vira lucro fantasma — ALTO

A tela assume: *"a diferença você acerta com o fornecedor por fora"*
(`ContasPainel.tsx:682-687`). Cheque de R$ 10.000 pagando conta de R$ 8.000:
o DRE registra R$ 10.000 de receita (repasse) contra R$ 8.000 de despesa —
**+R$ 2.000 de lucro que não existe** — e o troco real fica fora do sistema.
Na compra direta nem aviso tem.

### 30. Cheque COMPENSADO não pode voltar — MÉDIO

Devolução tardia/estorno depois da compensação não tem caminho — o dinheiro
fica no saldo e na receita pra sempre. (E a conta de compensação errada não
pode ser corrigida — item 16.)

### 31. Todo cheque que entra PRECISA creditar um comprador — BAIXO

`comprador_id` é NOT NULL e todo cheque nasce de recebimento. Cheque
recebido de quem não é comprador (devolução de fornecedor, venda de sucata)
só entra criando comprador falso com crédito falso.

---

# GRUPO F — Folha e o dinheiro do motorista

### 32. Comissão calculada não tem NENHUMA amarração com a paga — ALTO

A tela de Remuneração calcula R$ X; o Jean digita R$ Y em Lançamentos; nada
compara, nada marca o período como pago, nada avisa pagamento em dobro ou
esquecido. Reabrir o período recalcula o mesmo valor de novo, sem sinal de
"já foi pago". (O "sistema lembra" só existe pro vale.)

### 33. Duas portas pra `contas_a_pagar` com regras diferentes — ALTO

`/api/admin/contas` **não pede pessoa** (salário/comissão nascem "sem
pessoa" no DRE) e **não quita vale**; `/api/admin/caixa/lancamentos` faz os
dois. Se o Jean lançar a folha pelo caminho errado — e nada o impede — o
vale fica pendente pra sempre e o DRE não abre por pessoa.

### 34. Adiantamento pendente evapora do patrimônio — ALTO

O caixa desconta o adiantamento no envio (`status <> 'cancelado'`), mas a
mão do motorista só soma no **aceite**. Entre um e outro — e o motorista
pode pular o aceite indefinidamente — o dinheiro não está em lugar nenhum, e
o card Patrimônio subestima por esse valor.

### 35. "Empresa deve pro motorista" não vira conta a pagar — MÉDIO

Vale negativo ("soma no próximo salário") e saldo negativo são promessas que
só existem dentro do saldo do motorista — o total de "a pagar" do dashboard
não enxerga essa dívida.

### 36. Acerto não tem "quando foi" — MÉDIO

O adiantamento ganhou data retroativa; o acerto não (`corte_em = now()`,
sempre). Acertou na sexta e lançou na segunda → as coletas do fim de semana
caem no ciclo fechado (vira o item 8).

### 37. Marcar o vale não confere o valor — BAIXO

Quitar vale no lançamento de salário só grava a marca; o Jean ainda faz a
conta de cabeça e nada valida que o valor pago é salário − vale.

### 38. Vigências de salário/bônus/sócio são dado morto — BAIXO

Só a de comissão é lida por alguém. Cadastrar salário em /remuneracao não
gera conta, não alimenta DRE, não alerta folha esquecida. (E apagar uma
vigência antiga recalcula o passado silenciosamente.)

---

# GRUPO G — Apagar que deixa buraco

### 39. Apagar compra direta paga com CHEQUE não desfaz nada — ALTO

`compras/[id]/route.ts:114-136` é um delete seco. Ficam: cheque preso em
"repassado" pra sempre (fora do patrimônio, ainda contando como receita),
conta a pagar paga órfã (ainda contando como despesa), óleo fora do estoque.
O DELETE de conta a pagar faz a reversão certa — a compra direta não copiou.

### 40. Editar compra direta não propaga pro financeiro — MÉDIO

Editar valor/data de compra paga com cheque não toca na conta amarrada (o
DRE fica com o número velho). E a API aceita PATCH com `conta_id` numa
compra já paga com cheque → a mesma compra sai **duas vezes** do caixa (a UI
protege por acidente; a API está aberta).

### 41. Apagar motorista (forçado) apaga contas PAGAS — MÉDIO

`motoristas/[id]/route.ts:198-214` não filtra status — reescreve caixa e DRE
de meses fechados. Os caminhos irmãos (carga, abastecimento) filtram certo.

### 42. Manutenção a prazo apagada deixa dívida-fantasma — MÉDIO

O delete de manutenção **nunca** apaga a conta — nem a `a_pagar` de uma
manutenção que não existe mais. Comportamento oposto ao do abastecimento.

### 43. Renovar documento pode DUPLICAR a dívida — MÉDIO

Se a previsão já virou `a_pagar` (confirmou o valor), editar o documento cria
uma **segunda** conta prevista da mesma coisa (`documentos/[id]/route.ts:
85-91` só procura `prevista`; e o `maybeSingle()` sem tratamento de erro
faz a duplicação se auto-alimentar).

---

# GRUPO H — Rede de proteção e números gerenciais

*(pela régua do Evaner: os 44-45 influenciam número gerencial; 46-47 são
proteção)*

### 44. Compra direta com `entra_no_estoque=false` perde o CUSTO — MÉDIO

Os kg entram pela descarga, mas os reais da compra não entram em lugar
nenhum do estoque — custo médio subavaliado, margem inflada. O `carga_id`
da 0045 existe justamente pra permitir somar esse custo na descarga da
carga, e nenhuma query o usa.

### 45. Venda pode duplicar em falha parcial — MÉDIO

Venda grava sem transação e sem `client_id`; se a segunda etapa falha, o
formulário fica aberto com os dados e o segundo clique cria venda dobrada
(estoque sai 2×, dívida do comprador dobra). Recebimento tem idempotência
(0041); venda não.

### 46. Data FUTURA aceita em quase toda saída de caixa — BAIXO

Conta paga, lançamento e transferência só validam formato. Dedo errado no
ano tira dinheiro do saldo de hoje. O adiantamento bloqueia futuro — a regra
existe, só não foi propagada.

### 47. `buscarContas` com `limit(500)` sem filtro — BAIXO (bomba de tempo)

`queries.ts:1427-1439` pega TODAS as contas (inclusive todo lançamento pago
vive nessa tabela) ordenadas por vencimento, limit 500. Quando a tabela
crescer, as contas em aberto de vencimento futuro **somem da lista** enquanto
o card de resumo (RPC sem limite) mostra o total certo. Padrão da casa:
`selectTudo()`.

---

# Leitura recomendada por urgência

**Antes de cadastrar as contas financeiras e começar a virada (esta semana):**
itens **19** (sem tela pra corrigir saldo inicial — e é o próximo clique do
Jean), **17** (acerto irreversível — a virada é uma sequência de acertos),
**8/36** (coleta/acerto retroativos × corte), **1** (o aporte inicial de
dinheiro na empresa não tem onde ser lançado).

**Pro dia a dia que começa agora:** **10-13** (sede pagando gasto de campo),
**3-5** (coleta da sede), **15-16** (recebimento/cheque write-only — o
primeiro erro de digitação vai acontecer), **23-26** (parcial, juros,
abatimento, compra a prazo).

**Padrões que resolveriam vários itens de uma vez** (pra quando decidir
corrigir — cada um fecha uma família inteira):
1. **"Entrada avulsa" + "Ajuste de caixa"** → fecha 1, 2, 27, 29 (troco do
   cheque), 31.
2. **PATCH/DELETE com reversão da contrapartida em TODO fato de dinheiro**
   (o padrão do DELETE de conta paga, aplicado a recebimento, cheque,
   acerto, venda, compra direta) → fecha 15-18, 39-42.
3. **`conta_id` + `pago_na_hora`/"sede pagou" em despesas e abastecimentos**
   (o padrão da compra direta 0035/0042) → fecha 10-13.
4. **Tabela de pagamentos parciais + categoria "Juros e multas" +
   "abatimento" no comprador** → fecha 23-25.
