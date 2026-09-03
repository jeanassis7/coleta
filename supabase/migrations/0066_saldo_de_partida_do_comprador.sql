-- ============================================================================
-- 0066 — SALDO DE PARTIDA DO COMPRADOR
-- ============================================================================
-- O saldo do comprador era 100% calculado (`vendido − recebido`) e não tinha
-- onde receber a verdade da virada. Resultado em 03/09/2026: quatro
-- compradores com saldo NEGATIVO de centenas de milhares — o sistema achando
-- que a EMPRESA devia R$ 600 mil pras fundições.
--
-- O motivo é o backfill: os recebimentos vieram (é o que alimentou o caixa, e
-- o caixa está certo) sem as vendas correspondentes. E parte da diferença é
-- história que o sistema nunca vai ter: a planilha do Jean tem linhas de
-- "ARREDONDAR CONTA", "DESCONTO FESTA FIM ANO" e "VALE DESCONTADO" — acertos
-- comerciais que nunca viraram lançamento e nunca vão virar.
--
-- ⚠️ POR QUE NÃO APAGAR VENDA OU RECEBIMENTO: eles são dinheiro que entrou de
-- verdade e sustentam o caixa e a receita do DRE. Apagar pra "arrumar" o saldo
-- do comprador quebraria os dois. O corte não apaga nada — ele declara onde a
-- contagem começa, exatamente como o saldo de partida das contas bancárias
-- (0027).

alter table public.compradores
  add column if not exists saldo_inicial numeric(12,2) not null default 0,
  add column if not exists saldo_inicial_em date;

comment on column public.compradores.saldo_inicial is
  'Quanto ele devia na data do corte. Só conta junto com saldo_inicial_em.';
comment on column public.compradores.saldo_inicial_em is
  'Data do corte: venda e recebimento ANTERIORES a ela não entram no saldo. '
  'Nulo = sem corte, conta a história inteira (comportamento original).';

-- ---------------------------------------------------------------------------
-- saldo_compradores() com corte
-- ---------------------------------------------------------------------------
-- Cheque entregue conta como PAGO mesmo sem compensar — é assim que o sistema
-- sempre tratou, e é por isso que os cheques em carteira não aparecem como
-- dívida do comprador. Cheque DEVOLVIDO volta a ser dívida (o `and ch.status
-- <> 'devolvido'` faz isso, e é a razão de o recebimento passar pelo join).
create or replace function public.saldo_compradores()
returns table (
  comprador_id uuid,
  vendido      numeric,
  recebido     numeric,
  devolvido    numeric,
  saldo        numeric
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    round(coalesce(v.total, 0), 2)  as vendido,
    round(coalesce(r.total, 0), 2)  as recebido,
    round(coalesce(d.total, 0), 2)  as devolvido,
    round(
      c.saldo_inicial + coalesce(v.total, 0) - coalesce(r.total, 0), 2
    ) as saldo
  from public.compradores c
  left join lateral (
    select sum(vv.valor_total) as total
    from public.vendas vv
    where vv.comprador_id = c.id
      and (c.saldo_inicial_em is null or vv.data >= c.saldo_inicial_em)
  ) v on true
  left join lateral (
    select sum(rr.valor) as total
    from public.recebimentos rr
    left join public.cheques ch on ch.recebimento_id = rr.id
    where rr.comprador_id = c.id
      and (ch.id is null or ch.status <> 'devolvido')
      and (c.saldo_inicial_em is null or rr.data >= c.saldo_inicial_em)
  ) r on true
  left join lateral (
    select sum(ch.valor) as total
    from public.cheques ch
    where ch.comprador_id = c.id and ch.status = 'devolvido'
  ) d on true;
$$;
