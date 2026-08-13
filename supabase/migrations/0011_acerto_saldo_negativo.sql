-- ============================================================================
-- 0011 — Acerto com saldo NEGATIVO (empresa devendo pro motorista)
-- Aplicar no Supabase APÓS 0010.
-- ============================================================================
-- Contexto (buraco achado pelo Evaner no teste de campo):
--   Saldo negativo = motorista gastou mais do que recebeu (dinheiro do
--   próprio bolso). O acerto original só aceitava valores >= 0 e a soma
--   nunca fechava. Agora os 3 campos aceitam NEGATIVO com o significado
--   espelhado:
--
--     valor_devolvido < 0  → empresa PAGOU o motorista em dinheiro na hora
--     valor_vale      < 0  → empresa SOMA no próximo salário dele
--     valor_saldo     < 0  → dívida levada pro próximo ciclo
--                            (o próximo adiantamento compensa)
--
--   A conferência continua a mesma: devolvido + vale + saldo = saldo_atual.
-- ============================================================================

alter table public.acertos
  drop constraint if exists acertos_valor_devolvido_check,
  drop constraint if exists acertos_valor_vale_check,
  drop constraint if exists acertos_valor_saldo_check;
