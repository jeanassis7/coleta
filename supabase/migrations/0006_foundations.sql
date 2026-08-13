-- ============================================================================
-- 0006 — Fundações do Módulo 1 (feature flags, is_teste, mostra_saldo_app)
-- Aplicar no Supabase APÓS 0001-0005.
-- ============================================================================
-- Contexto:
--   Prepara o schema pras próximas features com gate por motorista:
--
--   - features (jsonb): feature flags per user, ex: {"carga": true}
--     Fluxo: dev liga em motorista de teste → valida → admin liga nos reais
--
--   - is_teste (bool): marca motorista sandbox. Não aparece em dashboards,
--     KPIs, curadoria, exports. Aparece só nas telas de gerência (motoristas,
--     eventos, dev/features).
--
--   - mostra_saldo_app (bool): toggle pra exibir "R$ na mão" pro motorista
--     no PWA. Default false — Jean liga por motorista conforme adota.
-- ============================================================================

alter table public.profiles
  add column features jsonb not null default '{}'::jsonb,
  add column is_teste boolean not null default false,
  add column mostra_saldo_app boolean not null default false;

create index idx_profiles_is_teste on public.profiles(is_teste);

-- Backfill não necessário — defaults cobrem todos os perfis existentes.
