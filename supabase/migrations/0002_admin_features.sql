-- ============================================================================
-- 0002 — admin features adicionais
-- Aplicar no SQL Editor do Supabase após o 0001 estar ok.
-- ============================================================================

-- Senha em texto plano visível pelo admin (controlled access via RLS).
-- ⚠️ AVISO: armazenar senha em texto plano é fora do padrão de segurança.
-- Aqui é aceitável pelo contexto: 3 motoristas, ambiente controlado,
-- senhas simples intencionalmente, admin precisa recuperar sem fazer reset.
-- Só admin lê esse campo (RLS já protege profiles).
alter table public.profiles
  add column if not exists senha_visivel text;

comment on column public.profiles.senha_visivel is
  'Senha em texto plano que o admin definiu na criação ou no último reset. Visível apenas pra admin.';
