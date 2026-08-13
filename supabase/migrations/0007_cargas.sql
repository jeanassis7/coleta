-- ============================================================================
-- 0007 — Módulo 1: Cargas, Caminhões, Descargas, Despesas, Abastecimentos
-- Aplicar no Supabase APÓS 0001-0006.
-- ============================================================================

-- CAMINHÕES
create table public.caminhoes (
  id uuid primary key default gen_random_uuid(),
  placa text not null unique,
  marca text not null,
  modelo text,
  cor text not null,
  capacidade_l integer not null check (capacidade_l > 0),
  tara_kg integer not null check (tara_kg > 0),
  ativo boolean not null default true,
  motivo_inativo text,
  criado_em timestamptz not null default now()
);
create index idx_caminhoes_ativo on public.caminhoes(ativo);

-- CARGAS (ciclo do motorista, do início ao descarregamento)
create table public.cargas (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  caminhao_id uuid not null references public.caminhoes(id),
  km_inicial integer not null,
  km_final integer,
  foto_painel_path text,
  status text not null default 'ativa' check (status in ('ativa','encerrada','cancelada')),
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz,
  criado_em timestamptz not null default now()
);
create index idx_cargas_motorista_status on public.cargas(motorista_id, status);
create index idx_cargas_status on public.cargas(status);
-- Só 1 carga ativa por motorista (enforce hard):
create unique index idx_cargas_uma_ativa_por_motorista
  on public.cargas(motorista_id) where status = 'ativa';

-- Vincula coleta à carga (nullable pra backward compat: motoristas sem
-- features.carga continuam salvando com carga_id=null).
alter table public.coletas add column carga_id uuid references public.cargas(id);
create index idx_coletas_carga on public.coletas(carga_id);

-- DESCARGAS (fecha uma carga com peso na balança)
create table public.descargas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  peso_bruto_kg integer not null check (peso_bruto_kg > 0),
  -- Snapshot do caminhoes.tara_kg no momento. Motorista não edita.
  peso_tara_kg integer not null check (peso_tara_kg > 0),
  peso_liquido_kg integer generated always as (peso_bruto_kg - peso_tara_kg) stored,
  litros_estimados integer,
  umidade_pct numeric(4,2),
  foto_papel_path text,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_descargas_carga on public.descargas(carga_id);

-- DESPESAS (motorista lança gasto avulso — almoço, hotel, lavagem etc)
create table public.despesas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  motorista_id uuid not null references public.profiles(id),
  valor integer not null check (valor > 0),
  descricao text not null,
  foto_path text not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_despesas_carga on public.despesas(carga_id);
create index idx_despesas_motorista on public.despesas(motorista_id);

-- ABASTECIMENTOS
create table public.abastecimentos (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  motorista_id uuid not null references public.profiles(id),
  posto_nome text not null,
  litros numeric(10,2) not null check (litros > 0),
  valor integer not null check (valor > 0),
  km_atual integer not null,
  foto_path text not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_abastecimentos_carga on public.abastecimentos(carga_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.caminhoes enable row level security;
alter table public.cargas enable row level security;
alter table public.descargas enable row level security;
alter table public.despesas enable row level security;
alter table public.abastecimentos enable row level security;

-- CAMINHÕES: motorista lê ativos (pra escolher no iniciar carga). Admin acesso total.
create policy "motorista lê caminhoes ativos"
  on public.caminhoes for select
  to authenticated
  using (ativo = true);

create policy "admin acesso total caminhoes"
  on public.caminhoes for all
  using (public.is_admin()) with check (public.is_admin());

-- CARGAS
create policy "motorista lê próprias cargas"
  on public.cargas for select using (motorista_id = auth.uid());

create policy "motorista insere próprias cargas"
  on public.cargas for insert with check (motorista_id = auth.uid());

create policy "motorista atualiza próprias cargas"
  on public.cargas for update using (motorista_id = auth.uid());

create policy "admin acesso total cargas"
  on public.cargas for all
  using (public.is_admin()) with check (public.is_admin());

-- DESCARGAS (motorista acessa via carga própria)
create policy "motorista lê próprias descargas"
  on public.descargas for select using (
    exists (select 1 from public.cargas c
            where c.id = descargas.carga_id and c.motorista_id = auth.uid())
  );

create policy "motorista insere descargas em própria carga"
  on public.descargas for insert with check (
    exists (select 1 from public.cargas c
            where c.id = descargas.carga_id and c.motorista_id = auth.uid())
  );

create policy "admin acesso total descargas"
  on public.descargas for all
  using (public.is_admin()) with check (public.is_admin());

-- DESPESAS
create policy "motorista lê próprias despesas"
  on public.despesas for select using (motorista_id = auth.uid());

create policy "motorista insere próprias despesas"
  on public.despesas for insert with check (motorista_id = auth.uid());

create policy "admin acesso total despesas"
  on public.despesas for all
  using (public.is_admin()) with check (public.is_admin());

-- ABASTECIMENTOS
create policy "motorista lê próprios abastecimentos"
  on public.abastecimentos for select using (motorista_id = auth.uid());

create policy "motorista insere próprios abastecimentos"
  on public.abastecimentos for insert with check (motorista_id = auth.uid());

create policy "admin acesso total abastecimentos"
  on public.abastecimentos for all
  using (public.is_admin()) with check (public.is_admin());
