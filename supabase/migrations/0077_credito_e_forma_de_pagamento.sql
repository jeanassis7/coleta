-- ============================================================================
-- 0077 — "CRÉDITO" É UMA FORMA DE PAGAMENTO
-- ============================================================================
-- O crédito com o posto (0076) paga nota de verdade: no acerto seguinte ele
-- entra como meio, do lado do cheque e do PIX. Então `forma_pagamento`
-- precisa aceitá-lo — senão o pedaço pago com crédito não teria como ser
-- gravado, e o motor recusaria o acerto inteiro.
--
-- Fica junto dos outros de propósito. A alternativa era gravar
-- `forma_pagamento = null`, e aí a coluna "Como pagou" mostraria um traço
-- onde houve pagamento — a tela mentindo por omissão.
--
-- ⚠️ Como o cheque, crédito NÃO tem `conta_id`: o dinheiro não saiu de conta
-- nenhuma, saiu de um saldo que o posto já devia. A `movimentos_caixa` ignora
-- linha sem conta, então o caixa continua certo sozinho.
-- ============================================================================

alter table public.contas_a_pagar drop constraint if exists contas_a_pagar_forma_pagamento_check;
alter table public.contas_a_pagar add constraint contas_a_pagar_forma_pagamento_check
  check (forma_pagamento in ('dinheiro', 'pix', 'deposito', 'boleto', 'cheque', 'credito'));
