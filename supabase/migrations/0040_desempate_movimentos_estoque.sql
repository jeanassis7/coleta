-- ============================================================================
-- 0040 — A ordem dos movimentos do estoque fica 100% determinística
-- ============================================================================
-- Dois problemas na ordenação `dia, prioridade, momento`:
--
--  1. Compra direta e venda do MESMO DIA empatavam nos três campos (as duas
--     usam data::timestamptz = meia-noite): a ordem virava detalhe do plano
--     de execução do Postgres, e o custo médio podia MUDAR entre duas
--     consultas iguais. Cenário: saldo zero, entra compra de 1.000 kg a
--     R$ 2,00 e sai venda de 500 kg no mesmo dia — numa ordem o valor final
--     é R$ 1.000; na outra, a saída usa o custo antigo e dá outro número.
--
--  2. A venda de meia-noite processava ANTES da descarga das 10h do mesmo
--     dia — a saída usava o custo médio de ontem mesmo com óleo novo já
--     dentro.
--
-- Correção: DENTRO do mesmo dia, ENTRADA processa antes de SAÍDA
-- (sub_prioridade), e o id da linha desempata o resto. O inventário
-- continua fechando o dia (prioridade 2), como sempre.

create or replace view public.movimentos_estoque
with (security_invoker = true) as

  select
    d.id                                as referencia_id,
    'descarga'::text                    as origem,
    'fino'::text                        as tipo_oleo,
    'entrada'::text                     as especie,
    d.peso_liquido_kg::numeric          as kg,
    coalesce((
      select sum(c.valor_pago) from public.coletas c
      where c.carga_id = d.carga_id
    ), 0)::numeric                      as custo,
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

-- estoque_atual() passa a usar o desempate novo. Corpo idêntico ao da 0016
-- fora o ORDER BY.
create or replace function public.estoque_atual()
returns table (
  tipo_oleo      text,
  saldo_kg       numeric,
  custo_medio_kg numeric,
  valor_total    numeric
)
language plpgsql
stable
set search_path = public
as $$
declare
  t       text;
  m       record;
  v_saldo numeric;
  v_valor numeric;
  v_cm    numeric;   -- último custo médio VÁLIDO (sobrevive a saldo <= 0)
begin
  foreach t in array array['fino', 'grosso'] loop
    v_saldo := 0;
    v_valor := 0;
    v_cm    := 0;

    for m in
      select mv.especie, mv.kg, mv.custo
      from public.movimentos_estoque mv
      where mv.tipo_oleo = t
      order by mv.dia, mv.prioridade, mv.sub_prioridade, mv.momento, mv.referencia_id
    loop
      if m.especie = 'entrada' then
        v_saldo := v_saldo + m.kg;
        v_valor := v_valor + m.custo;
        if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;

      elsif m.especie = 'saida' then
        -- Sai pelo custo médio vigente. Se o saldo já estava zerado ou
        -- negativo, usa o último válido — não inventa número novo.
        if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;
        v_saldo := v_saldo - m.kg;
        v_valor := v_valor - (m.kg * v_cm);

      else -- 'ajuste' — rebase de quantidade E de valor
        v_cm    := m.custo;
        v_saldo := m.kg;
        v_valor := m.kg * m.custo;
      end if;
    end loop;

    if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;

    tipo_oleo      := t;
    saldo_kg       := round(v_saldo, 2);
    custo_medio_kg := round(coalesce(v_cm, 0), 4);
    valor_total    := round(v_valor, 2);
    return next;
  end loop;
end;
$$;
