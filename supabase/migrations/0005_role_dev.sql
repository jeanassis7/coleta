-- ============================================================================
-- 0005 — Role 'dev' (superadmin) para Evaner
-- Aplicar no SQL Editor do Supabase APÓS 0001-0004.
-- ============================================================================
-- Contexto:
--   Evaner (dev) usa produção como staging: features novas ficam gated
--   por role='dev' no frontend; quando validadas, viram admin (Jean vê).
--   No backend: dev HERDA todas as permissões de admin (is_admin() = true
--   pra ambos). Se precisar de RLS específica só pra dev no futuro, criar
--   função is_dev() separada.
-- ============================================================================

-- 1) Aceitar 'dev' como valor válido no check constraint
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('motorista', 'admin', 'dev'));

-- 2) is_admin() passa a retornar true também pra role='dev'
--    Isso reaproveita TODAS as policies existentes sem alterá-las.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'dev')
      and ativo = true
  );
$$;
