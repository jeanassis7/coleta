-- ============================================================================
-- 0050 — O custo da compra "no caminhão" entra na descarga que pesou o óleo
-- ============================================================================
-- Compra direta com `entra_no_estoque = false` é o óleo que subiu num
-- caminhão NÃO-vazio: os kg entram pela DESCARGA (a balança pesa tudo
-- junto), então a compra não entra na view — senão o mesmo óleo contava
-- duas vezes. Só que o filtro excluía os kg E OS REAIS: o custo daquela
-- compra não entrava em lugar nenhum, o custo médio do tanque caía
-- artificialmente e a margem aparecia melhor do que é.
--
-- A 0045 amarrou a compra à carga (`carga_id`) exatamente pra isto — e
-- nenhuma query usava. Agora o custo da descarga soma: coletas da carga
-- + compras diretas fora-do-estoque daquela carga. Os kg continuam vindo
-- só da balança; o dinheiro fecha.
--
-- Resto da view e a estoque_atual(): idênticos à 0040.

create or replace view public.movimentos_estoque
with (security_invoker = true) as

  select
    d.id                                as referencia_id,
    'descarga'::text                    as origem,
    'fino'::text                        as tipo_oleo,
    'entrada'::text                     as especie,
    d.peso_liquido_kg::numeric          as kg,
    (
      coalesce((
        select sum(c.valor_pago) from public.coletas c
        where c.carga_id = d.carga_id
      ), 0)
      + coalesce((
        select sum(cd.valor) from public.compras_diretas cd
        where cd.carga_id = d.carga_id and cd.entra_no_estoque = false
      ), 0)
    )::numeric                          as custo,
    d.criado_em                         as momento,
    (d.criado_em at time zone 'America/Sao_Paulo')::date as dia,
    1                                   as prioridade,
    coalesce(p.nome, '—')               as descricao,
    0                                   as sub_prioridade
  from public.descargas d
  join public.cargas   g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id

  union all

  select
    cd.id, 'compra_direta', cd.tipo_oleo, 'entrada',
    cd.peso_kg, cd.valor,
    cd.data::timestamptz, cd.data, 1,
    cd.fornecedor,
    0
  from public.compras_diretas cd
  where cd.entra_no_estoque = true

  union all

  select
    v.id, 'venda', 'fino', 'saida',
    v.kg_fino, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome,
    1
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_fino > 0

  union all

  select
    v.id, 'venda', 'grosso', 'saida',
    v.kg_grosso, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome,
    1
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_grosso > 0

  union all

  select
    aj.id, 'ajuste', aj.tipo_oleo, 'ajuste',
    aj.saldo_novo_kg, aj.custo_medio_kg,
    aj.criado_em, aj.data, 2,
    aj.motivo,
    0
  from public.ajustes_estoque aj;
