-- ============================================================================
-- 0072 — O TROCO DO CHEQUE TEM DONO
-- ============================================================================
-- Cheque de R$ 3.000 pagando uma conta de R$ 600 deixa R$ 600... não: deixa
-- R$ 2.400 que voltam do fornecedor. Esse troco vira uma entrada avulsa
-- (dinheiro que entra e não é venda de óleo — 0047), e até hoje ela nascia
-- SOLTA: nada ligava o troco ao pagamento que o gerou.
--
-- Duas consequências, as duas caladas:
--
--   1. Apagar o pagamento devolvia o cheque pra carteira e reabria a conta,
--      mas o troco FICAVA — o caixa continuava com um dinheiro que tinha
--      entrado por um pagamento que não existe mais.
--   2. Não dava pra saber se o troco de um acerto já tinha sido lançado, e
--      lançar duas vezes era indistinguível de lançar uma.
--
-- A régua do dinheiro #4 é literal: "o desfazer tem que ser tão completo
-- quanto o fazer — meio desfazer deixa número órfão".
--
-- ---------------------------------------------------------------------------
-- POR QUE A ORIGEM É O CHEQUE, E NÃO A CONTA
-- ---------------------------------------------------------------------------
-- Troco só existe porque um PAPEL valia mais do que pagou. Um cheque pode
-- quitar uma conta (pagamento avulso) ou dezessete notas (fechamento do
-- posto) — mas em qualquer desenho ele gera NO MÁXIMO UM troco. Amarrar no
-- cheque dá uma regra só pras duas portas, e o índice único abaixo transforma
-- "no máximo um" em garantia do banco, não em promessa do código.
--
-- ⚠️ Isto NÃO entra no DRE nem na anti-dobra. `entradas_avulsas` é caixa puro
-- (fora do resultado, de propósito — 0047), e o `jaTemConta` do DRE se monta
-- só a partir de `contas_a_pagar`. Origem aqui é rastro, não competência.
-- ============================================================================

alter table public.entradas_avulsas
  add column if not exists origem_tipo text
    check (origem_tipo is null or origem_tipo in ('cheque')),
  add column if not exists origem_id uuid;

comment on column public.entradas_avulsas.origem_tipo is
  'De onde essa entrada nasceu sozinha. Hoje só ''cheque'' (troco de cheque maior que o que ele pagou). Nulo = lançada na mão pelo gestor.';

-- Um cheque gera no máximo um troco. Se um dia dois nascerem, o banco recusa
-- o segundo em vez de deixar o caixa maior que a realidade.
create unique index if not exists idx_entradas_avulsas_origem_unica
  on public.entradas_avulsas(origem_tipo, origem_id)
  where origem_tipo is not null and origem_id is not null;

create index if not exists idx_entradas_avulsas_origem
  on public.entradas_avulsas(origem_id);
