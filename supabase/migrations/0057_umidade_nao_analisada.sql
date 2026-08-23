-- ============================================================================
-- 0057 — "análise não feita" vira um LANÇAMENTO, não mais um campo vazio
-- ============================================================================
-- O campo umidade_pct nasceu em branco (0007) e ficou com dois significados
-- ao mesmo tempo:
--
--   (a) "testei e esqueci de registrar"   → alerta faz sentido, cobra o Jean
--   (b) "não testei"                      → alerta é ruído, não há o que fazer
--
-- Na conferência de 23/08/2026 o banco tinha 131 descargas e 131 sem
-- umidade — ou seja, hoje é SEMPRE o caso (b). A análise física ainda não
-- existe na rotina; vai existir mais pra frente, e aí o número volta a
-- valer com consequência ("essa carga tem 7%, logo x, y, z").
--
-- Decisão do Evaner: manter o campo vivo e criar o terceiro estado. Enquanto
-- a análise real não começa, o admin lança "não feita" e o assunto fica
-- registrado — em vez de ficar pendente pra sempre.
--
--   umidade_pct preenchido            → analisada, com número
--   umidade_nao_analisada = true      → não foi analisada (decisão tomada)
--   os dois vazios                    → ainda não se sabe (alerta cobra)
-- ============================================================================

alter table public.descargas
  add column if not exists umidade_nao_analisada boolean not null default false;

comment on column public.descargas.umidade_nao_analisada is
  'true = a análise de umidade NÃO foi feita nessa carga (decisão registrada). '
  'Diferente de umidade_pct null sozinho, que significa "ainda não se sabe".';

-- Coerência: número e "não analisada" são mutuamente exclusivos. Sem isso o
-- banco aceitaria uma descarga com 7% marcada como não analisada, e as telas
-- passariam a discordar entre si dependendo de qual campo cada uma lê.
alter table public.descargas
  drop constraint if exists umidade_coerente;
alter table public.descargas
  add constraint umidade_coerente
  check (not (umidade_nao_analisada and umidade_pct is not null));

-- ---------------------------------------------------------------------------
-- Backfill histórico: tudo que existe até hoje entra marcado como não feita.
-- Data FIXA de propósito — se este arquivo for reaplicado um dia, ele não
-- pode sair marcando descarga nova que o Jean ainda vai conferir.
-- ---------------------------------------------------------------------------
update public.descargas
   set umidade_nao_analisada = true
 where umidade_pct is null
   and umidade_nao_analisada = false
   and criado_em < timestamptz '2026-08-24 00:00:00-03';
