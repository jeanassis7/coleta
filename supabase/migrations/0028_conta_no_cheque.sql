-- 0028 — O cheque também precisa dizer em qual conta compensou.
--
-- ---------------------------------------------------------------------------
-- CHEQUE NÃO É DINHEIRO NA CONTA
-- ---------------------------------------------------------------------------
-- Quando o comprador paga em cheque, a dívida dele quita mas o dinheiro NÃO
-- entra em conta nenhuma — está no papel, na sua gaveta. Ele só vira saldo
-- quando COMPENSA.
--
-- Por isso:
--   - recebimento com forma='cheque'      → conta_id NULO (nada entrou ainda)
--   - cheque compensado                   → conta_id AQUI (entrou agora)
--   - cheque repassado a um fornecedor    → conta_id NULO (o papel foi embora,
--                                           não passou pela sua conta)
--   - conta paga COM cheque               → conta_id NULO (quitou com o papel)
--
-- Sem esta coluna, todo cheque que compensasse sumiria do caixa — e o saldo
-- ficaria menor que a realidade sem ninguém achar o furo.
alter table public.cheques
  add column if not exists conta_id uuid references public.contas_financeiras(id);

create index if not exists idx_cheques_conta on public.cheques(conta_id);

-- ---------------------------------------------------------------------------
-- saldo_contas() ganha o braço dos cheques compensados
-- ---------------------------------------------------------------------------
-- Mesma estrutura da 0027, com uma entrada a mais. Só conta cheque
-- `compensado`: em carteira ou depositado o dinheiro ainda não é seu.
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
