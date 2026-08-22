# Varredura adversarial de 21/08/2026 — o "engolir calado"

> Nasceu de um buraco real: o pagamento de dívida aceitava valor MAIOR que o
> saldo devedor sem avisar. Três auditorias independentes varreram o
> financeiro atrás da MESMA classe de bug — **valor ou estado fora de faixa
> aceito em silêncio**. Resultado: **30 achados, 8 graves**.
>
> O padrão é sempre o mesmo: **o guard existe num lugar e falta no irmão.**
> (POST valida, PATCH não. DELETE checa ciclo fechado, POST não. A tela de
> Venda avisa, a ficha do Comprador não. A tela de Contas avisa do troco, a
> de Lançamentos não.) Ver `REGUA-DO-DINHEIRO.md`.

## Corrigidos em 21/08 ✅

| # | Achado | Como estava | Como ficou |
|---|---|---|---|
| 1 | **Custo sumia do DRE PARA SEMPRE** | conta CANCELADA continuava escondendo o fato de origem (anti-dobra não filtrava status) — e era o caminho que a própria tela ensina | `.neq("status","cancelada")` na lista de origens |
| 2 | **DRE truncava em 1.000 linhas** | 5 das 6 consultas sem paginação: 3 motoristas a 12 coletas/dia estouram num mês e o custo do óleo cai calado | todas via `selectTudo` |
| 3 | **Devolução > saldo do motorista** | sem nenhum guard; digitar 500000 achando R$ 500,00 punha R$ 5.000 numa conta que nunca recebeu | compara com `saldos_motoristas()`, explica e pede 2º clique |
| 4 | **Devolução retroativa em ciclo fechado** | o DELETE tinha o guard; o POST não | avisa quando a data é anterior ao último acerto |
| 5 | **Recebimento > dívida do comprador** | errar um zero virava crédito invisível de R$ 45 mil | compara com `saldo_compradores()`, 2º clique |
| 6 | **Cheque repassado > despesa** | pagar R$ 500 com cheque de R$ 3.000 inflava o resultado do mês em R$ 2.500 e o troco sumia | avisa o troco (e o caso inverso), 2º clique |
| 7 | **Conta PREVISTA paga pelo chute** | energia prevista 800, fatura 940 → gravava 800; banco e caixa divergiam calados | pagar prevista exige o valor real da fatura |
| 8 | **Editar venda comia o arredondamento** | mexer no nº da nota recalculava total = peso × preço e sumia R$ 40-150 da dívida | só recalcula se o preço mudou; total explícito manda |
| 9 | **Maço de cheques engolia correção** | reenvio com valor corrigido/cheque novo respondia ok e não aplicava nada | grava os novos de verdade e o aviso aparece na tela |
| 10 | **Desativar motorista sumia com o dinheiro** | o valor caía do patrimônio sem linha nenhuma, e a foto do caixa continuava contando (telas divergiam) | avisa e pede acerto; o card passa a mostrar inativo com saldo |
| 11 | **Editar dívida não revalidava parcelas** | (buraco no código escrito 1h antes) 8× R$ 1.200 com total R$ 96.000 passava calado | mesma conferência do POST |
| 12 | **Credor vazio no editar** | apagar o nome devolvia ok com o nome antigo | recusa com mensagem |

**Nenhuma dessas correções mexeu em dado existente** — todas são preventivas.
Conferido no banco em 21/08: 0 contas canceladas com origem, 0 vendas com
total divergente, maior mês tem 140 coletas (teto era 1.000), só o Lucimar
com saldo e ele está ativo.

## Pendentes — a próxima leva

### Prioridade alta
- **Acerto sem idempotência (TOCTOU)**: dois POSTs simultâneos leem o mesmo
  saldo e os dois passam; clique duplo grava dois acertos e a conta recebe o
  dobro. Falta `client_id` unique (como cheques 0041 e vendas 0048).
- **Vale maior que o pagamento some inteiro**: vale de R$ 3.000 marcado num
  salário de R$ 2.000 sai da lista por inteiro; R$ 1.000 de desconto deixam
  de existir. Precisa de aviso ou quitação parcial.
- **Custo médio corrompido fica invisível**: venda a descoberto deixa
  `v_valor` negativo; quando o estoque volta a positivo o custo sai errado e
  o alerta some junto. A 0016 já previa; falta o sinal na tela.

### Prioridade média
- Saldo inicial / data de corte da conta financeira editáveis sem checagem —
  apagar os dígitos zera o saldo inicial calado (`CaixaPainel` manda `0`).
- Transferência (saque) maior que o saldo da origem passa sem aviso.
- Editar valor de conta que veio de um fato não sincroniza o fato
  (abastecimento fica R$ 800, conta vira R$ 680; ficha do caminhão erra).
- Apagar conta com origem: guard só no cliente, servidor aceita.
- Recorrente é a terceira porta da `contas_a_pagar` e não exige pessoa —
  "Salário Valdecir todo dia 5" gera conta sem dono todo mês.
- Adiantamento sem teto nenhum (R$ 50.000 no lugar de R$ 500 sai calado).
- Ficha do comprador esconde o cheque devolvido quando o saldo dá zero.
- Antiburro da venda a prazo dispara no caminho feliz (ensina clique
  automático — contraria "alerta ruidoso ensina a ignorar alerta").
- `buscarLancamentos` tem teto de 500 e a tela soma só o que veio.

### Prioridade baixa
- Corrigir data de pagamento move `repassado_em` do cheque mas não
  `vale_quitado_em`.
- `origem_tipo`/`origem_id` entram crus no POST de contas.
- Apagar comprador só checa vendas (maço de cheques estoura FK crua).
- Guard de ciclo fechado descarta o `error` da própria consulta.

## O que fica de método

`REGUA-DO-DINHEIRO.md` — as 8 perguntas obrigatórias. E a regra nova de
prestação de contas: ao entregar algo de dinheiro, dizer **quais das 8
foram verificadas e o que se achou**. "Testei" sem dizer o quê foi
exatamente como o primeiro buraco passou.
