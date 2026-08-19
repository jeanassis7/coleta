-- 0024 — Fim do `is_teste` e do papel `dev` no banco.
--
-- ---------------------------------------------------------------------------
-- ⚠️ RODAR SÓ DEPOIS DO DEPLOY do código que não usa mais `is_teste`.
-- ---------------------------------------------------------------------------
-- Se a coluna cair antes, o código em produção pede `is_teste` ao PostgREST
-- e toma 400 em todas as telas do admin. A 0023 (papel) veio ANTES do deploy
-- pelo motivo inverso: o código antigo aceitava admin OU dev.
--
-- A ORDEM AQUI DENTRO TAMBÉM IMPORTA: a view `movimentos_estoque` referencia
-- a coluna. Redefinir a view primeiro, derrubar a coluna depois — senão o
-- Postgres recusa por dependência.

-- ---------------------------------------------------------------------------
-- 1) is_admin() para de conhecer o papel `dev`
-- ---------------------------------------------------------------------------
-- Vira STABLE de propósito. Em política RLS, função VOLATILE (o default de
-- `language sql` quando não se diz nada) é reavaliada LINHA A LINHA, e as
-- policies chamam `public.is_admin()` direto em vez de `(select ...)`, então
-- também não há cache de InitPlan. Com o volume de hoje isso é invisível;
-- com carga acumulada seria o gargalo do painel.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $funcao$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and ativo = true
  );
$funcao$;

-- ---------------------------------------------------------------------------
-- 2) A view de estoque para de filtrar motorista de teste
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da 0017, com a linha `where p.is_teste = false` removida.
-- O `join public.profiles` CONTINUA: ele também alimenta `descricao` com o
-- nome do motorista. O `with (security_invoker = true)` também continua —
-- sem ele a view muda de comportamento sob RLS.
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
    coalesce(p.nome, '—')               as descricao
  from public.descargas d
  join public.cargas   g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id

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

  -- Saída de fino e de grosso são linhas separadas: cada estoque tem seu
  -- próprio custo médio, então a mistura precisa sair de cada um.
  select
    v.id, 'venda', 'fino', 'saida',
    v.kg_fino, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_fino > 0

  union all

  select
    v.id, 'venda', 'grosso', 'saida',
    v.kg_grosso, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_grosso > 0

  union all

  select
    aj.id, 'ajuste', aj.tipo_oleo, 'ajuste',
    aj.saldo_novo_kg, aj.custo_medio_kg,
    aj.criado_em, aj.data, 2,
    aj.motivo
  from public.ajustes_estoque aj;

-- ---------------------------------------------------------------------------
-- 3) A coluna sai
-- ---------------------------------------------------------------------------
-- Decisão do Evaner (19/08/2026): o sandbox invisível deixa de existir. Pra
-- testar, cria-se um perfil normal, testa-se de verdade — entrando nos
-- relatórios como qualquer motorista — e apaga-se depois.
drop index if exists public.idx_profiles_is_teste;
alter table public.profiles drop column if exists is_teste;
