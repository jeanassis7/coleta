-- ============================================================================
-- 0035 — Compra direta diz DE QUAL CONTA o dinheiro saiu
-- ============================================================================
-- A compra direta era invisível pro caixa: o DRE via o gasto (oleo_sede),
-- mas nenhuma conta financeira via a saída — R$ 5.000 pagos em espécie e o
-- card "Em espécie" continuava igual, silenciosamente acima da gaveta real.
--
-- Decisão do Evaner (20/08/2026): "lançar qualquer coisa que SAIA dinheiro
-- não é possível digitar manualmente, mas sim selecionar uma conta pré
-- existente". A coluna é NULLABLE por causa das compras antigas (lançadas
-- antes desta migration) e do caso entra_no_estoque=false já lançado; a
-- interface passa a EXIGIR a conta em compra nova.

alter table public.compras_diretas
  add column if not exists conta_id uuid references public.contas_financeiras(id);

create index if not exists idx_compras_diretas_conta
  on public.compras_diretas(conta_id);

-- ---------------------------------------------------------------------------
-- saldo_contas() ganha o braço da compra direta (saída)
-- ---------------------------------------------------------------------------
-- Mesma estrutura da 0028, com uma saída a mais. Compra sem conta (antiga)
-- simplesmente não soma — igual a qualquer movimento sem conta.
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
          and ad.data_envio >= b.saldo_inicial_em
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
