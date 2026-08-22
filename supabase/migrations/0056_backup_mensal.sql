-- 0056 — Fundação do backup mensal em CSV.
--
-- POR QUÊ: o plano grátis do Supabase só guarda backup de 7 dias. Se um bug
-- gravar errado e ninguém notar por 3 semanas, não existe mais versão boa
-- pra voltar. O snapshot mensal é a foto de segurança: todo dia 1º o cron
-- da Vercel (/api/cron/backup) despeja TODAS as tabelas em CSV no bucket
-- `backups`, uma pasta por mês (aaaa-mm), regravável (rodar de novo no
-- mesmo mês só atualiza o snapshot).
--
-- Duas peças:
--   1. bucket `backups` privado — só admin LÊ; quem escreve é o
--      service_role do cron (que ignora RLS, então não precisa de policy
--      de escrita — e a ausência dela é proposital: ninguém mais grava).
--   2. RPC `listar_tabelas_backup()` — a lista de tabelas vem do catálogo,
--      não de uma lista fixa no código: tabela nova entra no backup
--      SOZINHA, do mesmo jeito que ganha log sozinha (0022). Uma lista
--      hardcoded esqueceria a próxima tabela em silêncio — exatamente o
--      tipo de buraco que o backup existe pra cobrir.
--
-- A RPC devolve também as colunas da PRIMARY KEY: o dump pagina com
-- selectTudo e paginação sem ordem estável embaralha/duplica linha.
-- Tabela sem PK (não existe nenhuma hoje) volta colunas_ordem NULL e o
-- cron a marca como "não copiada" no manifesto — visível, nunca calado.

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists "admin le backups storage" on storage.objects;
create policy "admin le backups storage"
  on storage.objects for select
  using (bucket_id = 'backups' and public.is_admin());

create or replace function public.listar_tabelas_backup()
returns table (tabela text, colunas_ordem text[])
language sql
stable
as $$
  select
    c.relname::text,
    (
      select array_agg(a.attname::text order by k.n)
      from unnest(i.indkey) with ordinality as k(attnum, n)
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_index i on i.indrelid = c.oid and i.indisprimary
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname;
$$;

-- Só o service_role do cron precisa disso — listar o schema não é assunto
-- de app logado (nem de anônimo).
revoke execute on function public.listar_tabelas_backup() from public;
revoke execute on function public.listar_tabelas_backup() from anon;
revoke execute on function public.listar_tabelas_backup() from authenticated;
grant execute on function public.listar_tabelas_backup() to service_role;
