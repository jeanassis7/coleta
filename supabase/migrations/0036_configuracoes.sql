-- ============================================================================
-- 0036 — Tabela de configurações (nasce pro preço de referência do óleo)
-- ============================================================================
-- O painel do patrimônio (R87) precisa de um preço de referência em R$/litro:
-- uma CONTA DE CABEÇA editável, um valor só pra fino e grosso. Não é custo
-- médio — a ideia é usar SEMPRE o mesmo preço pra saber se o patrimônio sobe
-- ou desce mês a mês, sem misturar variação de preço com variação de volume.
--
-- Chave/valor genérico de propósito: a próxima configuração avulsa não
-- precisa de tabela nova. Valor em texto; quem valida o formato é o endpoint.
--
-- (O log entra sozinho: o event trigger da 0022 pendura trg_log_admin em
-- toda create table de public.)

create table public.configuracoes (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id)
);

alter table public.configuracoes enable row level security;

create policy "admin gerencia configuracoes"
  on public.configuracoes for all
  using (public.is_admin())
  with check (public.is_admin());
