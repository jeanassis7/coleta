-- ============================================================================
-- JJHS Coleta OLUC — Schema inicial
-- Aplicar em ordem em um projeto Supabase novo, vazio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — extende auth.users com role, nome, exige_foto
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role text not null check (role in ('motorista', 'admin')),
  ativo boolean not null default true,
  exige_foto boolean not null default false,
  criado_em timestamptz not null default now()
);

create index idx_profiles_role on public.profiles(role);

-- ---------------------------------------------------------------------------
-- coletas
-- ---------------------------------------------------------------------------
create table public.coletas (
  id uuid primary key default gen_random_uuid(),

  motorista_id uuid not null references public.profiles(id),

  -- dados principais
  litros numeric(10,2) not null check (litros > 0),
  local_nome text not null,
  valor_pago integer not null check (valor_pago > 0),

  -- certificado
  certificado_tipo text not null check (certificado_tipo in ('integral','parcial','nao')),
  litros_certificado numeric(10,2),

  -- observação livre
  observacao text,

  -- localização
  latitude double precision,
  longitude double precision,
  gps_accuracy double precision,
  gps_capturado boolean not null default false,

  -- foto
  foto_path text,
  foto_url_cached text,

  -- captura automática
  device_id text,
  session_id text,
  app_version text,

  -- timestamps
  criado_em timestamptz not null,
  sincronizado_em timestamptz default now(),

  -- idempotência
  client_id uuid not null unique
);

create index idx_coletas_motorista on public.coletas(motorista_id);
create index idx_coletas_criado_em on public.coletas(criado_em desc);
create index idx_coletas_client_id on public.coletas(client_id);

-- ---------------------------------------------------------------------------
-- app_events — log estruturado de eventos do cliente
-- ---------------------------------------------------------------------------
create table public.app_events (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid references public.profiles(id),
  session_id text,
  device_id text,
  event_type text not null,
  payload jsonb,
  app_version text,
  criado_em timestamptz not null default now()
);

create index idx_app_events_motorista on public.app_events(motorista_id);
create index idx_app_events_type on public.app_events(event_type);
create index idx_app_events_criado_em on public.app_events(criado_em desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.coletas enable row level security;
alter table public.app_events enable row level security;

-- Helper: verifica se o usuário atual é admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and ativo = true
  );
$$;

-- ---------------------------------------------------------------------------
-- Políticas: profiles
-- ---------------------------------------------------------------------------
create policy "motorista lê próprio profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "admin lê todos profiles"
  on public.profiles for select
  using (public.is_admin());

create policy "admin gerencia profiles"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Políticas: coletas
-- ---------------------------------------------------------------------------
create policy "motorista lê próprias coletas"
  on public.coletas for select
  using (motorista_id = auth.uid());

create policy "motorista insere próprias coletas"
  on public.coletas for insert
  with check (motorista_id = auth.uid());

create policy "admin acesso total coletas"
  on public.coletas for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Políticas: app_events
-- ---------------------------------------------------------------------------
create policy "motorista insere próprios eventos"
  on public.app_events for insert
  with check (motorista_id = auth.uid() or motorista_id is null);

create policy "motorista lê próprios eventos"
  on public.app_events for select
  using (motorista_id = auth.uid());

create policy "admin acesso total eventos"
  on public.app_events for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- Storage bucket: fotos-coletas (criar via API/UI Supabase também)
-- ============================================================================

-- Cria bucket se não existir
insert into storage.buckets (id, name, public)
values ('fotos-coletas', 'fotos-coletas', false)
on conflict (id) do nothing;

-- Política: motorista escreve/lê apenas no próprio prefixo
create policy "motorista upload em próprio prefixo"
  on storage.objects for insert
  with check (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "motorista lê próprias fotos"
  on storage.objects for select
  using (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admin acesso total fotos"
  on storage.objects for all
  using (
    bucket_id = 'fotos-coletas'
    and public.is_admin()
  )
  with check (
    bucket_id = 'fotos-coletas'
    and public.is_admin()
  );
