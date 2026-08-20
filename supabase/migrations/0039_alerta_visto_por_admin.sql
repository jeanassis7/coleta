-- ============================================================================
-- 0039 — "OK, VI" passa a valer só pra quem clicou
-- ============================================================================
-- A chave era PK sozinha: o Evaner dispensava um alerta e ele sumia do
-- dashboard do Jean também — dispensa global, sem ninguém ter decidido isso.
-- Decisão do Evaner (20/08/2026): cada admin tem a sua.
--
-- A PK vira (chave, visto_por). As dispensas existentes ficam valendo pra
-- quem as fez.

alter table public.alertas_vistos
  drop constraint alertas_vistos_pkey;

alter table public.alertas_vistos
  add primary key (chave, visto_por);
