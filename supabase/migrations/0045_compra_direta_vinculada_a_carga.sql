-- ============================================================================
-- 0045 — Compra direta que foi junto numa carga aponta QUAL carga
-- ============================================================================
-- Quando o caminhão NÃO estava vazio (entra_no_estoque = false), o peso
-- daquele óleo vai ser contado na descarga de uma carga aberta. Sem o
-- vínculo, dali a semanas ninguém lembra em qual — o carga_id é o rastro
-- que fecha a auditoria (a descarga daquela carga contém este óleo).

alter table public.compras_diretas
  add column if not exists carga_id uuid references public.cargas(id);

create index if not exists idx_compras_diretas_carga
  on public.compras_diretas(carga_id);
