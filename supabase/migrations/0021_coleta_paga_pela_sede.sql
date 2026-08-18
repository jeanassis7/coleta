-- ============================================================================
-- 0021 — Coleta paga pela sede (não sai do bolso do motorista)
-- Aplicar no Supabase APÓS 0020.
-- ============================================================================
-- Caso real (Lucimar, agosto/26): 3.000 L negociados a R$ 2,00/L com
-- pagamento pelo escritório no mês seguinte. Ele lançou R$ 2 e R$ 1 — não
-- por preguiça, mas porque **o sistema não deixava outra saída**: o campo
-- exige valor maior que zero, e qualquer valor real seria descontado do
-- saldo dele por `saldos_motoristas()`.
--
-- O estrago disso é silencioso e composto:
--   • o custo médio do óleo ficou 7,5% mais barato do que é
--     (R$ 1,471/L com essas duas coletas, R$ 1,589/L sem elas)
--   • R$ 6.000 de dívida com o fornecedor não existiam em lugar nenhum
--   • e não havia como corrigir sem furar o saldo do motorista
--
-- Este campo separa as duas coisas que estavam grudadas: QUANTO O ÓLEO
-- CUSTOU (sempre entra no estoque) e DE QUEM SAIU O DINHEIRO (só desconta
-- do motorista quando foi dele).
--
-- Quem marca hoje: o gestor, no painel, quando o relatório do motorista
-- chega. Nada muda na tela do motorista — pôr "você pagou agora?" em toda
-- coleta custaria um toque a mais na tela mais usada do app pra atender 2%
-- dos lançamentos.
--
-- Depois da curadoria de locais, o local canônico ganha a mesma marca e a
-- coleta já nasce marcada. Hoje isso não daria: existe 1 local cadastrado
-- no sistema inteiro e 107 das 108 coletas são texto livre.
-- ============================================================================

alter table public.coletas
  add column if not exists pago_pela_sede boolean not null default false;

comment on column public.coletas.pago_pela_sede is
  'true = o escritório paga o fornecedor direto. O valor conta no custo do óleo mas NÃO desconta do saldo do motorista.';

-- ---------------------------------------------------------------------------
-- saldos_motoristas(): coleta paga pela sede não sai do bolso dele
-- ---------------------------------------------------------------------------
-- Única mudança em relação à 0018: o `and not c.pago_pela_sede`. Sem isso,
-- corrigir a coleta do "Ss" de R$ 2 pra R$ 4.000 tiraria R$ 4.000 do saldo
-- do Lucimar — dinheiro que ele nunca teve na mão.
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
          where c.motorista_id = b.motorista_id
            and c.criado_em > b.corte
            and not c.pago_pela_sede   -- escritório pagou: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(d.valor) from public.despesas d
          where d.motorista_id = b.motorista_id and d.criado_em > b.corte
        ), 0)
      - coalesce((
          select sum(ab.valor) from public.abastecimentos ab
          where ab.motorista_id = b.motorista_id
            and ab.criado_em > b.corte
            and ab.pago_na_hora   -- assinou a nota: nao saiu da mao dele
        ), 0)
    , 2) as saldo
  from base b;
$$;

-- NOTA: `movimentos_estoque` NÃO muda. O óleo comprado pela sede custou
-- dinheiro da empresa do mesmo jeito, então continua entrando no custo
-- médio pelo `valor_pago`. O que muda é só de quem o dinheiro saiu.

-- ---------------------------------------------------------------------------
-- Conta a pagar pode nascer de uma coleta
-- ---------------------------------------------------------------------------
-- Marcar "pagamento pela sede" cria a dívida com o fornecedor na hora. Sem
-- 'coleta' na lista de origens, o insert seria recusado pelo CHECK.
alter table public.contas_a_pagar drop constraint if exists contas_a_pagar_origem_tipo_check;
alter table public.contas_a_pagar add constraint contas_a_pagar_origem_tipo_check
  check (origem_tipo in ('abastecimento', 'manutencao', 'compra_direta', 'documento', 'coleta'));
