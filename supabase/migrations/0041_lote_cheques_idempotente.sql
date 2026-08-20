-- ============================================================================
-- 0041 — Maço de cheques idempotente (client_id no recebimento)
-- ============================================================================
-- Mesmo remédio da 0009 (sync do motorista): a tela gera um client_id por
-- linha do maço; se a internet piscar depois do servidor gravar e o gestor
-- clicar de novo, o reenvio bate no unique (23505) e é tratado como "já
-- entrou" — o maço não duplica.
--
-- Nullable de propósito: recebimento avulso (ficha do comprador, venda) não
-- precisa — o botão desabilitado cobre o duplo-clique ali.

alter table public.recebimentos
  add column if not exists client_id uuid unique;
