-- ============================================================================
-- 0048 — Venda com client_id: o clique duplo não duplica
-- ============================================================================
-- A venda gravava sem idempotência: se a segunda etapa falhava (entrada à
-- vista sem conta), o formulário ficava aberto com os dados e o segundo
-- clique criava a venda DE NOVO — óleo saindo do estoque duas vezes e a
-- dívida do comprador dobrada. Recebimentos já tinham client_id (0041);
-- a venda nunca ganhou o dela.
alter table public.vendas
  add column if not exists client_id text;
create unique index if not exists idx_vendas_client_id
  on public.vendas(client_id) where client_id is not null;
