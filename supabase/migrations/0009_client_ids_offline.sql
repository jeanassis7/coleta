-- ============================================================================
-- 0009 — client_id em despesas/abastecimentos/descargas (offline-first)
-- Aplicar no Supabase APÓS 0008.
-- ============================================================================
-- Contexto:
--   Despesa, abastecimento e descarga viram offline-first (decisão do Evaner:
--   "não quero a desculpa de que tava sem internet"). Igual coletas:
--   salvam no IndexedDB do celular e sincronizam quando há sinal.
--
--   client_id (uuid gerado no celular) garante idempotência do sync:
--   se o INSERT sobe mas a confirmação se perde (rede caiu no meio),
--   o retry recebe unique_violation (23505) e trata como sucesso —
--   nunca duplica o registro. Mesmo mecanismo de coletas.client_id.
--
--   Nullable porque registros antigos (pré-offline) não têm. Postgres
--   permite múltiplos NULL em coluna unique.
-- ============================================================================

alter table public.despesas add column client_id uuid unique;
alter table public.abastecimentos add column client_id uuid unique;
alter table public.descargas add column client_id uuid unique;
