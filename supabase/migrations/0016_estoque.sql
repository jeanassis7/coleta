-- ============================================================================
-- 0016 — Estoque de óleo (fino e grosso) — Módulo 2, Bloco 1
-- Aplicar no Supabase APÓS 0015.
-- ============================================================================
-- O estoque NÃO ganha tabela própria de movimentos. Descargas, compras
-- diretas e (a partir da 0017) vendas já são as entradas e saídas — copiar
-- isso pra uma tabela paralela criaria dois lugares com a mesma verdade e
-- uma hora eles discordariam. Aqui o estoque é uma LEITURA do que existe.
--
-- A única tabela nova é a de ajustes, porque inventário não tem outra origem.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA FUNÇÃO E NÃO UM SUM()
-- ---------------------------------------------------------------------------
-- Custo médio ponderado móvel é uma SEQUÊNCIA, não uma soma: cada saída sai
-- pelo custo médio DAQUELE instante, que depende de tudo que veio antes.
-- SUM() não expressa isso.
--
-- Regra (fechada com o Evaner):
--   entrada  → saldo += kg ; valor += custo
--   saída    → valor -= kg × custo_médio_vigente ; saldo -= kg
--   ajuste   → saldo = contado ; valor = contado × custo_médio CONGELADO na linha
--
-- O ajuste é o que segura o custo. Sem ele, "vendeu mais do que tinha"
-- (que é normal aqui — o aviso é amarelo e passa) deixa o saldo negativo, e
-- a próxima entrada entra numa base torta. Dois ou três ciclos assim e o
-- custo por kg vira ficção sem nenhum sinal na tela.
--
-- ABERTURA é o único ajuste que informa o custo por kg. Sem isso o primeiro
-- custo médio nasce zero — e custo baixo demais faz a margem parecer ótima
-- por meses sem ninguém desconfiar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipo de óleo na compra direta
-- ---------------------------------------------------------------------------
-- Fino é 95% da operação e é tudo que vem de motorista. Grosso (óleo de
-- navio e afins) só entra por compra direta, negociado pelo gestor.
alter table public.compras_diretas
  add column if not exists tipo_oleo text not null default 'fino'
    check (tipo_oleo in ('fino', 'grosso'));

-- ---------------------------------------------------------------------------
-- 2. Ajustes de estoque (inventário e abertura)
-- ---------------------------------------------------------------------------
create table if not exists public.ajustes_estoque (
  id uuid primary key default gen_random_uuid(),
  tipo_oleo text not null check (tipo_oleo in ('fino', 'grosso')),
  motivo_tipo text not null check (motivo_tipo in ('abertura', 'inventario')),

  -- O que o sistema dizia na hora. Guardado pra auditoria ficar legível
  -- daqui a dois anos: "em março dizia 14.000 e ele contou 11.500".
  saldo_antes_kg numeric(12,2) not null,
  -- O que ele contou de verdade. Vira o novo saldo.
  saldo_novo_kg numeric(12,2) not null check (saldo_novo_kg >= 0),
  diferenca_kg numeric(12,2)
    generated always as (saldo_novo_kg - saldo_antes_kg) stored,

  -- CONGELADO no momento do ajuste. Na abertura é digitado pelo gestor;
  -- no inventário é o custo médio vigente copiado pra cá. É esta coluna
  -- que impede o custo de derreter depois de vender mais do que tinha.
  custo_medio_kg numeric(12,4) not null check (custo_medio_kg >= 0),
  perda_valor numeric(12,2)
    generated always as (
      round((saldo_novo_kg - saldo_antes_kg) * custo_medio_kg, 2)
    ) stored,

  motivo text not null,
  data date not null,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_ajustes_estoque_tipo_data
  on public.ajustes_estoque(tipo_oleo, data desc);

alter table public.ajustes_estoque enable row level security;

drop policy if exists "admin acesso total ajustes_estoque" on public.ajustes_estoque;
create policy "admin acesso total ajustes_estoque"
  on public.ajustes_estoque for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. View de movimentos — a única fonte, sem cópia
-- ---------------------------------------------------------------------------
-- security_invoker: a RLS das tabelas de origem continua valendo. Sem
-- bypass, mesmo critério da saldos_motoristas() da 0013.
--
-- `dia` existe porque a ordenação precisa ser (dia, prioridade, momento):
-- o inventário do dia X vale pro FIM do dia X, então ele tem que ser
-- aplicado depois das descargas daquele mesmo dia. Ordenar só por
-- timestamp colocaria o ajuste (00:00) antes da descarga (14:00) e daria
-- um resultado silenciosamente errado.
--
-- O `momento` do ajuste é o criado_em (quando ele clicou), NÃO a data
-- escolhida: `dia` + `prioridade` já garantem que o ajuste venha por
-- último no dia, e o criado_em é o desempate quando há DOIS inventários
-- do mesmo tipo na mesma data — sem ele a ordem seria arbitrária e o
-- resultado mudaria sozinho entre duas execuções da mesma consulta.
create or replace view public.movimentos_estoque
with (security_invoker = true) as

  -- DESCARGA → entrada de FINO. Custo = o que o motorista pagou nas coletas
  -- daquela carga. Motorista de teste fica de fora, mesmo critério do resto
  -- do painel — senão o sandbox do Evaner poluiria o estoque real.
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
    coalesce(p.nome, '—')               as descricao
  from public.descargas d
  join public.cargas   g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id
  where p.is_teste = false

  union all

  -- COMPRA DIRETA → entrada do tipo escolhido. entra_no_estoque = false é o
  -- caso raro de o óleo ter ido junto numa carga que ainda vai pesar: ali o
  -- peso conta na descarga e aqui contaria duas vezes.
  select
    cd.id, 'compra_direta', cd.tipo_oleo, 'entrada',
    cd.peso_kg, cd.valor,
    cd.data::timestamptz, cd.data, 1,
    cd.fornecedor
  from public.compras_diretas cd
  where cd.entra_no_estoque = true

  union all

  -- AJUSTE → não soma nem subtrai: REDEFINE. `kg` carrega o saldo contado e
  -- `custo` carrega o custo médio congelado (a função sabe ler assim).
  select
    aj.id, 'ajuste', aj.tipo_oleo, 'ajuste',
    aj.saldo_novo_kg, aj.custo_medio_kg,
    aj.criado_em, aj.data, 2,
    aj.motivo
  from public.ajustes_estoque aj;

-- NOTA: a 0017 (vendas) faz `create or replace view` incluindo o braço de
-- saída. A função abaixo já trata 'saida' — não precisa ser recriada.

-- ---------------------------------------------------------------------------
-- 4. estoque_atual() — percorre os movimentos em ordem
-- ---------------------------------------------------------------------------
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
      order by mv.dia, mv.prioridade, mv.momento
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
