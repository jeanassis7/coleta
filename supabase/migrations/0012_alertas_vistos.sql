-- ============================================================================
-- 0012 — Alertas do dashboard: marcar como visto ("OK, VI")
-- Aplicar no Supabase APÓS 0011.
-- ============================================================================
-- Contexto:
--   Os alertas do dashboard são CALCULADOS na hora (não existem como linha
--   no banco). Esta tabela guarda só quais o gestor já viu e dispensou.
--
--   A `chave` identifica a OCORRÊNCIA específica, não o tipo:
--     peso_divergente:<descarga_id>   umidade_pendente:<descarga_id>
--     carga_esquecida:<carga_id>      caminhao_cheio:<carga_id>
--     coleta_suspeita:<coleta_id>     pular_repetido:<adiantamento_id>
--     vale_alto:<motorista_id>:<aaaa-mm-dd>  (re-alerta a cada dia)
--     foto_faltando:<motorista_id>:<aaaa-mm-dd>
--     gps_falhando:<motorista_id>:<aaaa-mm-dd>
--
--   Efeito: apertar "OK, VI" some com aquele alerta pra sempre; se a
--   condição voltar em OUTRO registro (nova descarga divergente), a chave
--   é diferente e o alerta aparece de novo. É o comportamento que o
--   Evaner pediu.
-- ============================================================================

create table public.alertas_vistos (
  chave text primary key,
  visto_por uuid not null references public.profiles(id),
  visto_em timestamptz not null default now()
);

alter table public.alertas_vistos enable row level security;

-- Só admin/dev (is_admin() cobre os dois) lê e escreve
create policy "admin acesso total alertas_vistos"
  on public.alertas_vistos for all
  using (public.is_admin()) with check (public.is_admin());
