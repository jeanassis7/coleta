-- ============================================================================
-- 0003 — locais (oficinas/clientes) com sugestão por proximidade
-- Aplicar no SQL Editor após 0001 e 0002.
-- ============================================================================

-- Tabela de locais canônicos. Vai sendo populada via curadoria do admin
-- a partir das coletas com texto livre.
create table public.locais (
  id uuid primary key default gen_random_uuid(),

  -- Nome oficial (mostra pro motorista nas sugestões)
  nome_canonico text not null,

  -- Apelidos / variações que o motorista já digitou — facilita match em busca textual
  apelidos text[] default array[]::text[],

  -- GPS canônico do local
  latitude double precision not null,
  longitude double precision not null,

  -- Raio de tolerância pra match com novas coletas (padrão 50m).
  -- Locais urbanos densos podem usar 30m; rurais soltos podem usar 100-150m.
  raio_match_m integer not null default 50 check (raio_match_m > 0),

  -- Ativo? (admin pode desativar sem deletar)
  ativo boolean not null default true,

  -- Notas internas do admin — telefone do dono, observações, etc. CRM básico.
  notas_internas text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index idx_locais_ativo on public.locais(ativo);
create index idx_locais_latlng on public.locais(latitude, longitude);

-- Vincula coleta a local canônico (nullable: coletas antigas/sem match ficam null)
alter table public.coletas
  add column if not exists local_id uuid references public.locais(id) on delete set null;

create index if not exists idx_coletas_local_id on public.coletas(local_id);

-- ============================================================================
-- Função de busca por proximidade — usa fórmula de Haversine
-- ============================================================================
create or replace function public.locais_proximos(
  p_lat double precision,
  p_lng double precision,
  p_raio_m integer default 200
)
returns table (
  id uuid,
  nome_canonico text,
  latitude double precision,
  longitude double precision,
  distancia_m double precision
)
language sql
stable
as $$
  with limites as (
    select
      p_raio_m / 111000.0 as delta_lat_grau,
      p_raio_m / (111000.0 * cos(radians(p_lat))) as delta_lng_grau
  )
  select
    l.id,
    l.nome_canonico,
    l.latitude,
    l.longitude,
    2 * 6371000 * asin(
      sqrt(
        sin(radians(l.latitude - p_lat) / 2) ^ 2
        + cos(radians(p_lat)) * cos(radians(l.latitude))
        * sin(radians(l.longitude - p_lng) / 2) ^ 2
      )
    )::double precision as distancia_m
  from public.locais l, limites
  where l.ativo
    and l.latitude between p_lat - limites.delta_lat_grau and p_lat + limites.delta_lat_grau
    and l.longitude between p_lng - limites.delta_lng_grau and p_lng + limites.delta_lng_grau
  -- Filtro fino: dentro do raio_match_m do PRÓPRIO local OR do p_raio_m passado
  -- (o menor dos dois — local pode ter raio especial configurado)
  order by distancia_m asc;
$$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.locais enable row level security;

-- Motorista lê locais ativos pra sugestão
create policy "motorista lê locais ativos"
  on public.locais for select
  using (ativo = true);

-- Admin acesso total
create policy "admin acesso locais"
  on public.locais for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- Estatísticas agregadas por local (view simples — sem cache)
-- ============================================================================
create or replace view public.locais_com_stats as
select
  l.*,
  (select count(*) from public.coletas c where c.local_id = l.id) as total_visitas,
  (select coalesce(sum(c.litros), 0) from public.coletas c where c.local_id = l.id) as total_litros,
  (select coalesce(sum(c.valor_pago), 0) from public.coletas c where c.local_id = l.id) as total_pago,
  (select max(c.criado_em) from public.coletas c where c.local_id = l.id) as ultima_visita,
  (select min(c.criado_em) from public.coletas c where c.local_id = l.id) as primeira_visita
from public.locais l;
