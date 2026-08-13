-- ============================================================================
-- 0013 — Função saldos_motoristas(): saldo de todos num round trip só
-- Aplicar no Supabase APÓS 0012.
-- ============================================================================
-- Problema (reclamação de campo do Evaner: "o painel demora 3-4s"):
--   buscarMotoristasComSaldo fazia ~7 consultas POR MOTORISTA, em fila.
--   Com 6 motoristas = ~42 idas ao banco, uma esperando a outra (~2s).
--   O dashboard chamava isso DUAS vezes (card de cargas + motor de
--   alertas) = ~4s. Era o N+1 clássico.
--
-- Solução: a mesma conta, feita uma vez dentro do Postgres.
--   saldo = carry do último acerto
--         + adiantamentos aceitos após o corte
--         − coletas − despesas − abastecimentos após o corte
--
-- SECURITY INVOKER de propósito (sem SECURITY DEFINER): as políticas de
-- RLS continuam valendo — admin/dev vê todos, motorista veria só o
-- próprio. Nada de bypass.
-- ============================================================================

create or replace function public.saldos_motoristas()
returns table (motorista_id uuid, saldo numeric)
language sql
stable
set search_path = public
as $$
  with ultimo_acerto as (
    select distinct on (a.motorista_id)
      a.motorista_id, a.corte_em, a.valor_saldo
    from public.acertos a
    order by a.motorista_id, a.corte_em desc
  ),
  base as (
    select
      p.id as motorista_id,
      coalesce(ua.corte_em, '1970-01-01'::timestamptz) as corte,
      coalesce(ua.valor_saldo, 0) as carry
    from public.profiles p
    left join ultimo_acerto ua on ua.motorista_id = p.id
    where p.role = 'motorista'
  )
  select
    b.motorista_id,
    round(
      b.carry
      + coalesce((
          select sum(ad.valor) from public.adiantamentos ad
          where ad.motorista_id = b.motorista_id
            and ad.status = 'aceito'
            and ad.aceito_em > b.corte
        ), 0)
      - coalesce((
          select sum(c.valor_pago) from public.coletas c
          where c.motorista_id = b.motorista_id and c.criado_em > b.corte
        ), 0)
      - coalesce((
          select sum(d.valor) from public.despesas d
          where d.motorista_id = b.motorista_id and d.criado_em > b.corte
        ), 0)
      - coalesce((
          select sum(ab.valor) from public.abastecimentos ab
          where ab.motorista_id = b.motorista_id and ab.criado_em > b.corte
        ), 0)
    , 2) as saldo
  from base b;
$$;
