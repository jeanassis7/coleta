-- ============================================================================
-- 0068 — UM DONO SÓ PRO QUE É DINHEIRO
-- ============================================================================
-- Existiam DUAS leituras do que conta como dinheiro:
--
--   • `saldo_contas()` somava 14 braços por conta própria e cuspia o total da
--     tela do Caixa;
--   • a tela de Lançamentos montava a própria lista — e montava MENOR (só
--     contas a pagar pagas).
--
-- Medido em 03/09/2026: a tela mostrava 1.073 linhas e escondia 242, incluindo
-- R$ 1,9 milhão de ENTRADAS (cheque compensado, recebimento). A tela que se
-- chama "no ritmo do extrato bancário" não tinha como bater com o extrato.
--
-- Aqui a lista vira a fonte: `movimentos_caixa` é o extrato, e o
-- `saldo_contas()` passa a ser a SOMA dele. Um dono só — é impossível o total
-- e a lista discordarem, porque são a mesma coisa.
--
-- Mesmo desenho que já deu certo no estoque: `movimentos_estoque` é a lista,
-- `estoque_atual()` é a soma.
--
-- ⚠️ O QUE NÃO PODE MUDAR: o saldo de cada conta. A troca só sobe com os
-- números idênticos aos de antes, conta por conta.

-- ---------------------------------------------------------------------------
-- movimentos_caixa — toda linha que mexe numa conta financeira
-- ---------------------------------------------------------------------------
-- Convenção de sinal: POSITIVO entra, NEGATIVO sai. Quem soma não precisa
-- saber de que braço veio.
--
-- `conta_no_saldo` carrega o corte: movimento anterior ao `saldo_inicial_em`
-- da conta já está dentro do saldo de partida e não pode ser somado de novo.
-- A coluna existe pra tela poder MOSTRAR a linha sem que ela conte — quem
-- confere o extrato precisa ver o que existe, não só o que soma.
--
-- security_invoker: a RLS das tabelas de origem continua valendo. O
-- `saldo_contas()` é SECURITY DEFINER e continua enxergando tudo, como antes.
create or replace view public.movimentos_caixa
with (security_invoker = true) as

  -- ============================ ENTRADAS ============================

  -- Recebimento de comprador que caiu direto na conta (cheque NÃO entra aqui:
  -- ele só vira dinheiro quando compensa, mais abaixo).
  select
    r.id                                  as origem_id,
    'recebimento'::text                   as tipo,
    r.conta_id,
    r.data,
    r.valor::numeric                      as valor,
    ('Recebimento — ' || coalesce(co.nome, 'comprador'))::text as descricao,
    null::text                            as categoria,
    null::uuid                            as pessoa_id,
    r.criado_em
  from public.recebimentos r
  left join public.compradores co on co.id = r.comprador_id
  where r.conta_id is not null

  union all

  select t.id, 'transferencia_entrada', t.conta_destino_id, t.data, t.valor::numeric,
    ('Transferência recebida de ' || coalesce(o.nome, 'outra conta'))::text,
    null, null, t.criado_em
  from public.transferencias t
  left join public.contas_financeiras o on o.id = t.conta_origem_id

  union all

  -- Troco que o motorista devolveu no acerto.
  select a.id, 'acerto_devolucao', a.conta_id,
    (a.corte_em at time zone 'America/Sao_Paulo')::date,
    a.valor_devolvido::numeric,
    ('Acerto — devolução de ' || coalesce(p.nome, 'motorista'))::text,
    null, a.motorista_id, a.criado_em
  from public.acertos a
  left join public.profiles p on p.id = a.motorista_id
  where a.conta_id is not null and a.valor_devolvido <> 0

  union all

  -- Cheque só é dinheiro quando COMPENSA (0028).
  select ch.id, 'cheque_compensado', ch.conta_id, ch.compensado_em, ch.valor::numeric,
    ('Cheque compensado — banco ' || coalesce(ch.banco, '—')
      || ' nº ' || coalesce(ch.numero, '—'))::text,
    null, null, ch.criado_em
  from public.cheques ch
  where ch.conta_id is not null and ch.status = 'compensado'
    and ch.compensado_em is not null

  union all

  -- Aporte, empréstimo, reembolso, rendimento, venda de ativo (0047).
  select ea.id, 'entrada_avulsa', ea.conta_id, ea.data, ea.valor::numeric,
    ea.descricao::text, null, null, ea.criado_em
  from public.entradas_avulsas ea

  union all

  select dv.id, 'devolucao_motorista', dv.conta_id, dv.data, dv.valor::numeric,
    ('Devolução de troco — ' || coalesce(p.nome, 'motorista'))::text,
    null, dv.motorista_id, dv.criado_em
  from public.devolucoes_motorista dv
  left join public.profiles p on p.id = dv.motorista_id
  where dv.conta_id is not null

  union all

  select aj.id, 'ajuste_caixa', aj.conta_id, aj.data, aj.valor::numeric,
    (case when aj.valor > 0 then 'Sobra na conferência — ' else 'Falta na conferência — ' end
      || aj.motivo)::text,
    null, null, aj.criado_em
  from public.ajustes_caixa aj

  union all

  -- ============================= SAÍDAS =============================

  select cp.id, 'conta_paga', cp.conta_id, cp.pago_em, (-cp.valor)::numeric,
    cp.descricao::text, cp.categoria, cp.pessoa_id, cp.criado_em
  from public.contas_a_pagar cp
  where cp.conta_id is not null and cp.status = 'paga' and cp.pago_em is not null

  union all

  -- Adiantamento pendente TAMBÉM sai: o dinheiro já saiu da conta quando o
  -- gestor mandou; o aceite é do motorista, não do caixa. (Só cancelado fica
  -- de fora — esse não chegou a sair.)
  select ad.id, 'adiantamento', ad.conta_id,
    (ad.data_envio at time zone 'America/Sao_Paulo')::date,
    (-ad.valor)::numeric,
    ('Adiantamento — ' || coalesce(p.nome, 'motorista'))::text,
    null, ad.motorista_id, ad.criado_em
  from public.adiantamentos ad
  left join public.profiles p on p.id = ad.motorista_id
  where ad.conta_id is not null and ad.status <> 'cancelado'

  union all

  select t.id, 'transferencia_saida', t.conta_origem_id, t.data, (-t.valor)::numeric,
    ('Transferência para ' || coalesce(d.nome, 'outra conta'))::text,
    null, null, t.criado_em
  from public.transferencias t
  left join public.contas_financeiras d on d.id = t.conta_destino_id

  union all

  select cd.id, 'compra_direta', cd.conta_id, cd.data, (-cd.valor)::numeric,
    ('Compra direta — ' || coalesce(cd.fornecedor, 'fornecedor'))::text,
    'custo_oleo', null, cd.criado_em
  from public.compras_diretas cd
  where cd.conta_id is not null

  union all

  -- Gasto de campo pago DIRETO pela sede (pix/cartão da empresa).
  select ab.id, 'abastecimento', ab.conta_id,
    (ab.criado_em at time zone 'America/Sao_Paulo')::date,
    (-ab.valor)::numeric,
    ('Combustível — ' || ab.posto_nome)::text,
    'combustivel', null, ab.criado_em
  from public.abastecimentos ab
  where ab.conta_id is not null

  union all

  select d.id, 'despesa', d.conta_id,
    (d.criado_em at time zone 'America/Sao_Paulo')::date,
    (-d.valor)::numeric,
    ('Despesa — ' || d.descricao)::text,
    'custos_viagem', null, d.criado_em
  from public.despesas d
  where d.conta_id is not null;

comment on view public.movimentos_caixa is
  'O extrato: toda linha que mexe numa conta financeira. Positivo entra, '
  'negativo sai. É a FONTE do saldo_contas() — mexer aqui muda o caixa.';

-- ---------------------------------------------------------------------------
-- saldo_contas() vira a SOMA da view
-- ---------------------------------------------------------------------------
-- O corte (`saldo_inicial_em`) sai daqui: movimento anterior a ele já está
-- dentro do saldo de partida e somá-lo de novo contaria duas vezes.
create or replace function public.saldo_contas()
returns table (
  conta_id      uuid,
  nome          text,
  tipo          text,
  saldo_inicial numeric,
  entradas      numeric,
  saidas        numeric,
  saldo         numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.nome,
    c.tipo,
    round(c.saldo_inicial, 2),
    round(coalesce(sum(m.valor) filter (where m.valor > 0), 0), 2),
    round(coalesce(-sum(m.valor) filter (where m.valor < 0), 0), 2),
    round(c.saldo_inicial + coalesce(sum(m.valor), 0), 2)
  from public.contas_financeiras c
  left join public.movimentos_caixa m
    on m.conta_id = c.id
   and m.data >= c.saldo_inicial_em
  where c.ativa = true
  group by c.id, c.nome, c.tipo, c.saldo_inicial
  order by c.nome;
$$;

revoke all on function public.saldo_contas() from public;
grant execute on function public.saldo_contas() to authenticated;
