-- ============================================================================
-- 0043 — Troca de óleo também pode marcar a PRÓXIMA por DATA
-- ============================================================================
-- Pedido do Evaner (20/08/2026): "tem que adicionar data OU quilometragem".
-- Caminhão que roda pouco não bate o km da troca nunca — mas o óleo vence
-- pelo tempo do mesmo jeito. O alerta acende pelo que vencer PRIMEIRO.

alter table public.manutencoes
  add column if not exists proxima_data date;
