-- ============================================================================
-- 0020 — Foto opcional em lançamento do painel — Módulo 2, Bloco 2
-- Aplicar no Supabase APÓS 0019.
-- ============================================================================
-- `foto_path` era NOT NULL porque, no fluxo do motorista, o comprovante é
-- obrigatório: ele está em campo com o celular na mão e a foto é a prova.
--
-- O gestor lançando pelo painel é outro contexto — ele está no desktop com a
-- nota de papel na mesa, e a foto às vezes só chega depois (ou nunca, no caso
-- do abastecimento do carro dele). Exigir arquivo ali faria o lançamento não
-- acontecer, e lançamento que não acontece é pior que lançamento sem foto.
--
-- A obrigatoriedade continua existindo PRA O MOTORISTA — só que na UI, onde
-- ela pertence, e não no banco, que agora atende dois fluxos diferentes.
-- ============================================================================

alter table public.abastecimentos alter column foto_path drop not null;
alter table public.despesas       alter column foto_path drop not null;
