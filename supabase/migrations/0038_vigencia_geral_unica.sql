-- ============================================================================
-- 0038 — Duas vigências GERAIS na mesma data não podem coexistir
-- ============================================================================
-- O unique da 0030 — (pessoa_id, tipo, vigente_desde) — não segura o caso
-- geral: com pessoa_id NULL o Postgres trata cada NULL como distinto, então
-- duas vigências gerais de comissão no mesmo dia entravam, e o desempate na
-- leitura era ordem de retorno do banco — ambíguo.
--
-- Índice único PARCIAL cobre exatamente o buraco.

create unique index if not exists uq_vigencia_geral
  on public.vigencias_remuneracao (tipo, vigente_desde)
  where pessoa_id is null;
