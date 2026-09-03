-- ============================================================================
-- 0070 — CONTA QUITADA COM CHEQUE TAMBÉM É LANÇAMENTO
-- ============================================================================
-- A 0068 só trouxe pro extrato o que mexe numa conta financeira, e com isso
-- 113 contas pagas COM CHEQUE (R$ 284.543,42) sumiriam da tela: elas não saem
-- de conta nenhuma — quitaram com o papel.
--
-- O dinheiro saiu de verdade (o cheque era um ativo nosso e deixou de ser),
-- então elas pertencem ao extrato. Como ficam com `conta_id` NULO, o
-- `saldo_contas()` continua ignorando: o join dele é por conta, e nulo não
-- casa com nenhuma. Zero risco pro saldo — conferido depois de aplicar.
--
-- ⚠️ O QUE NÃO ENTRA, DE PROPÓSITO: recebimento em cheque (289 linhas,
-- R$ 1,5 milhão). O cheque só vira dinheiro quando COMPENSA, e a compensação
-- já é uma linha do extrato. Trazer os dois contaria a mesma entrada duas
-- vezes — é o buraco que a 0028 fechou e não vai ser reaberto aqui.

create or replace view public.movimentos_caixa
with (security_invoker = true) as

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
  select a.id, 'acerto_devolucao', a.conta_id,
    (a.corte_em at time zone 'America/Sao_Paulo')::date,
    a.valor_devolvido::numeric,
    ('Acerto — devolução de ' || coalesce(p.nome, 'motorista'))::text,
    null, a.motorista_id, a.criado_em
  from public.acertos a
  left join public.profiles p on p.id = a.motorista_id
  where a.conta_id is not null and a.valor_devolvido <> 0

  union all
  select ch.id, 'cheque_compensado', ch.conta_id, ch.compensado_em, ch.valor::numeric,
    ('Cheque compensado — banco ' || coalesce(ch.banco, '—')
      || ' nº ' || coalesce(ch.numero, '—'))::text,
    null, null, ch.criado_em
  from public.cheques ch
  where ch.conta_id is not null and ch.status = 'compensado'
    and ch.compensado_em is not null

  union all
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
  -- SAÍDAS. `conta_id` pode ser NULO aqui: conta quitada com cheque não sai
  -- de conta nenhuma, mas é lançamento do mesmo jeito.
  select cp.id, 'conta_paga', cp.conta_id, cp.pago_em, (-cp.valor)::numeric,
    (cp.descricao || case when cp.conta_id is null and cp.forma_pagamento = 'cheque'
                          then ' (pago com cheque)' else '' end)::text,
    cp.categoria, cp.pessoa_id, cp.criado_em
  from public.contas_a_pagar cp
  where cp.status = 'paga' and cp.pago_em is not null

  union all
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
