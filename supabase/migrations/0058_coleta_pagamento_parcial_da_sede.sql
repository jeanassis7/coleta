-- ============================================================================
-- 0058 — a sede pode pagar SÓ UMA PARTE da coleta
-- ============================================================================
-- Caso real (Luiz, 13/08/2026, "De campina da alagoa"): 2.225 L negociados a
-- R$ 1,80/L = R$ 4.005. O motorista tirou R$ 900 do bolso na hora e a
-- empresa pixou os R$ 3.105 restantes direto pro fornecedor.
--
-- O modelo da 0021 não tinha onde pôr isso: `pago_pela_sede` é sim/não. Ou
-- tudo do motorista, ou tudo da sede. O gestor fez o que dava — lançou
-- R$ 900 na coleta e o pix como um lançamento solto — e o resultado é o
-- mesmo estrago da 0021 de novo:
--   • 2.225 L entraram no estoque custando R$ 900 (R$ 0,40/L em vez de 1,80)
--   • o pix de R$ 3.105 vira dinheiro sem lastro no óleo que ele comprou
--   • e o alerta de "número estranho" acende todo dia, com razão
--
-- A separação certa tem TRÊS números, não dois:
--   valor_pago  = quanto o ÓLEO custou (é o que entra no estoque)   4.005
--   valor_sede  = quanto DISSO a empresa bancou                     3.105
--   a diferença = quanto saiu do bolso do motorista                   900
--
-- `pago_pela_sede` continua existindo e passa a significar "a sede entrou
-- nessa coleta" (parcial ou total). O CHECK amarra os dois: não existe
-- estado em que eles discordem.
-- ============================================================================

alter table public.coletas
  add column if not exists valor_sede integer not null default 0;

comment on column public.coletas.valor_sede is
  'Quanto DESTA coleta a empresa pagou direto ao fornecedor. O resto '
  '(valor_pago - valor_sede) saiu do bolso do motorista e desconta do saldo dele. '
  'valor_pago continua sendo o custo TOTAL do óleo — é ele que entra no estoque.';

-- Backfill: quem estava marcado 100% sede vira valor_sede = valor cheio.
update public.coletas
   set valor_sede = valor_pago
 where pago_pela_sede
   and valor_sede = 0;

-- Coerência: os dois campos não podem discordar, e a sede nunca paga mais do
-- que o óleo custou. Sem isso o saldo do motorista poderia ficar negativo por
-- digitação — dinheiro que ele nunca teve na mão virando crédito.
alter table public.coletas drop constraint if exists coleta_valor_sede_coerente;
alter table public.coletas add constraint coleta_valor_sede_coerente
  check (
    valor_sede >= 0
    and valor_sede <= valor_pago
    and (pago_pela_sede = (valor_sede > 0))
  );

-- ---------------------------------------------------------------------------
-- saldos_motoristas() — desconta só a PARTE DELE
-- ---------------------------------------------------------------------------
-- Corpo da 0047 inteiro; muda uma linha só. Antes era "some tudo, menos as
-- coletas marcadas como sede" — o que joga fora a coleta inteira. Agora é
-- "some a diferença", que dá o mesmo resultado nos dois extremos (sede zero
-- → desconta tudo; sede cheia → desconta nada) e acerta o meio do caminho.
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
          select sum(c.valor_pago - c.valor_sede) from public.coletas c
          where c.motorista_id = b.motorista_id
            and c.criado_em > b.corte
            -- o que a sede bancou nao saiu da mao dele (0058)
        ), 0)
      - coalesce((
          select sum(d.valor) from public.despesas d
          where d.motorista_id = b.motorista_id
            and d.criado_em > b.corte
            and d.pago_na_hora   -- assinou a nota: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(ab.valor) from public.abastecimentos ab
          where ab.motorista_id = b.motorista_id
            and ab.criado_em > b.corte
            and ab.pago_na_hora   -- assinou a nota: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(dv.valor) from public.devolucoes_motorista dv
          where dv.motorista_id = b.motorista_id
            and dv.criado_em > b.corte   -- devolveu troco: saiu da mao dele
        ), 0)
    , 2) as saldo
  from base b;
$$;

-- meu_saldo() (0033) delega pra esta função — o card do celular acompanha
-- sozinho, sem segunda cópia da fórmula.
