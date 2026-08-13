-- ============================================================================
-- 0008 — Módulo 1: Adiantamentos e Acertos
-- Aplicar no Supabase APÓS 0007.
-- ============================================================================

-- ADIANTAMENTOS
-- Jean envia dinheiro pro motorista (pix ou espécie).
-- Motorista aceita ou pula na tela BLOCKING do PWA.
-- Só count no saldo quando status='aceito'.
create table public.adiantamentos (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  valor integer not null check (valor > 0),
  data_envio timestamptz not null default now(),
  forma_pagamento text not null check (forma_pagamento in ('dinheiro','pix')),
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  status text not null default 'pendente' check (status in ('pendente','aceito','cancelado')),
  aceito_em timestamptz,
  gps_aceite_lat double precision,
  gps_aceite_lng double precision,
  pular_contador integer not null default 0,
  criado_em timestamptz not null default now()
);
create index idx_adiantamentos_motorista_status
  on public.adiantamentos(motorista_id, status);

-- ACERTOS (fecha um ciclo de saldo)
-- corte_em: timestamptz do momento do acerto. Todas as queries de saldo
-- comparam eventos (adiantamentos.aceito_em, coletas/despesas/abast.criado_em)
-- contra este valor. Usar timestamptz elimina bug de coleta às 14h antes de
-- acerto às 16h cair no ciclo errado.
create table public.acertos (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  corte_em timestamptz not null default now(),
  valor_devolvido integer not null default 0 check (valor_devolvido >= 0),
  valor_vale integer not null default 0 check (valor_vale >= 0),
  valor_saldo integer not null default 0 check (valor_saldo >= 0),
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index idx_acertos_motorista_corte on public.acertos(motorista_id, corte_em desc);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.adiantamentos enable row level security;
alter table public.acertos enable row level security;

-- Motorista lê próprios adiantamentos + atualiza próprio aceite
create policy "motorista lê próprios adiantamentos"
  on public.adiantamentos for select using (motorista_id = auth.uid());

create policy "motorista atualiza próprio aceite"
  on public.adiantamentos for update
  using (motorista_id = auth.uid())
  with check (motorista_id = auth.uid());

-- Motorista lê próprios acertos (só leitura)
create policy "motorista lê próprios acertos"
  on public.acertos for select using (motorista_id = auth.uid());

-- Admin acesso total (via is_admin() que cobre dev)
create policy "admin acesso total adiantamentos"
  on public.adiantamentos for all
  using (public.is_admin()) with check (public.is_admin());

create policy "admin acesso total acertos"
  on public.acertos for all
  using (public.is_admin()) with check (public.is_admin());
