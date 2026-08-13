-- ============================================================================
-- 0015 — Certificado na compra direta + coleta lançada pelo admin
-- Aplicar no Supabase APÓS 0014.
-- ============================================================================
-- 1) Compra direta também pode emitir certificado (confirmado pelo Evaner):
--    mesma convenção das coletas — integral / parcial / não.
--
-- 2) Coleta lançada retroativamente pelo gestor (o motorista coletou e
--    esqueceu de registrar; avisou depois). Guardar QUEM lançou é o que
--    diferencia, na auditoria, o que veio do celular em campo do que foi
--    digitado no painel. Null = veio do app, como sempre.
--    O dinheiro dessa coleta saiu da mão do motorista de verdade, então
--    ela desconta do saldo dele igual a qualquer outra.
-- ============================================================================

alter table public.compras_diretas
  add column certificado_tipo text not null default 'nao'
    check (certificado_tipo in ('integral', 'parcial', 'nao')),
  add column litros_certificado numeric(10,2);

alter table public.coletas
  add column lancado_por_admin uuid references public.profiles(id);

create index idx_coletas_lancado_por_admin
  on public.coletas(lancado_por_admin)
  where lancado_por_admin is not null;
