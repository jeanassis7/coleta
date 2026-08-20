-- ============================================================================
-- 0044 — Abastecimento sabe se foi DIESEL ou ARLA
-- ============================================================================
-- ARLA 32 é insumo obrigatório do caminhão, abastece no mesmo posto — mas
-- não é combustível: entrar no km/L derrubaria o consumo calculado sem
-- ninguém entender por quê. O tipo separa; o dinheiro continua saindo do
-- bolso do motorista (ou da nota assinada) do mesmo jeito.

alter table public.abastecimentos
  add column if not exists tipo text not null default 'diesel'
  check (tipo in ('diesel', 'arla'));
