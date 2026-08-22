-- 0055 — Quem já apareceu no log, direto no Postgres.
--
-- O dropdown de filtro da tela /admin/log fazia um select cru com
-- limit(2000) — mentira dupla: o Supabase corta em 1000 de qualquer jeito
-- e, sem .order(), as 1000 linhas que vinham eram arbitrárias. Como
-- log_admin é a tabela que MAIS cresce (uma linha por gravação de admin),
-- um admin antigo simplesmente sumia do filtro.
--
-- DISTINCT no banco resolve os dois problemas de uma vez: o resultado é
-- uma linha por ator (meia dúzia, nunca perto de 1000) e o nome que vem é
-- o mais recente registrado (se a pessoa foi renomeada, vale o novo).
--
-- SECURITY INVOKER (o padrão): a RLS da log_admin continua mandando — quem
-- não pode ler o log recebe lista vazia, não o atalho.

create or replace function public.atores_do_log()
returns table (id uuid, nome text)
language sql
stable
as $$
  select distinct on (ator_id) ator_id, ator_nome
  from public.log_admin
  where ator_id is not null
  order by ator_id, criado_em desc;
$$;
