-- ============================================================================
-- 0042 — O corte do caixa compara TODOS os braços pelo dia BRASILEIRO
-- ============================================================================
-- O braço dos adiantamentos comparava `data_envio` (timestamptz) direto com
-- a data do corte — em UTC. Um adiantamento enviado 31/07 às 22h BR é
-- 01/08 01:00 UTC: com corte em 01/08, ele era contado como saída pós-corte
-- mesmo já estando embutido no saldo informado. Janela de 3h na véspera de
-- todo corte, sempre na mesma direção (saldo do caixa pra baixo).
--
-- O braço dos acertos já fazia a conversão certa; agora os dois falam a
-- mesma língua. Corpo idêntico ao da 0035 fora essa linha.

create or replace function public.saldo_contas()
returns table (
  conta_id uuid,
  nome text,
  tipo text,
  saldo_inicial numeric,
  entradas numeric,
  saidas numeric,
  saldo numeric
)
language sql
stable
security definer
set search_path = public
as $funcao$
  with base as (
    select c.id, c.nome, c.tipo, c.saldo_inicial, c.saldo_inicial_em
    from public.contas_financeiras c
    where c.ativa = true
  ),
  ent as (
    select b.id,
      coalesce((
        select sum(r.valor) from public.recebimentos r
        where r.conta_id = b.id and r.data >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(t.valor) from public.transferencias t
        where t.conta_destino_id = b.id and t.data >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(a.valor_devolvido) from public.acertos a
        where a.conta_id = b.id
          and (a.corte_em at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0)
      -- Cheque só entra no caixa quando COMPENSA. A data que vale é a da
      -- compensação, não a do "bom para" nem a do recebimento.
      + coalesce((
        select sum(ch.valor) from public.cheques ch
        where ch.conta_id = b.id and ch.status = 'compensado'
          and ch.compensado_em >= b.saldo_inicial_em
      ), 0) as total
    from base b
  ),
  sai as (
    select b.id,
      coalesce((
        select sum(cp.valor) from public.contas_a_pagar cp
        where cp.conta_id = b.id and cp.status = 'paga'
          and cp.pago_em >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(ad.valor) from public.adiantamentos ad
        where ad.conta_id = b.id and ad.status <> 'cancelado'
          and (ad.data_envio at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(t.valor) from public.transferencias t
        where t.conta_origem_id = b.id and t.data >= b.saldo_inicial_em
      ), 0)
      -- Compra direta à vista: o dinheiro saiu da conta no dia da compra.
      + coalesce((
        select sum(cd.valor) from public.compras_diretas cd
        where cd.conta_id = b.id and cd.data >= b.saldo_inicial_em
      ), 0) as total
    from base b
  )
  select
    b.id, b.nome, b.tipo,
    round(b.saldo_inicial, 2),
    round(ent.total, 2),
    round(sai.total, 2),
    round(b.saldo_inicial + ent.total - sai.total, 2)
  from base b
  join ent on ent.id = b.id
  join sai on sai.id = b.id
  order by b.nome;
$funcao$;
