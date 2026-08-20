-- ============================================================================
-- 0046 — Quais placas cada motorista pode dirigir
-- ============================================================================
-- Pedido do Evaner (20/08/2026): o iniciar-carga do motorista deve mostrar
-- SÓ os caminhões dele — nada de carro particular ou caminhão dos outros.
--
-- Regra de leitura: lista VAZIA = pode todos os caminhões ativos (é o
-- comportamento de sempre; a restrição é opt-in, um motorista de cada vez).

create table public.motorista_caminhoes (
  motorista_id uuid not null references public.profiles(id) on delete cascade,
  caminhao_id uuid not null references public.caminhoes(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (motorista_id, caminhao_id)
);

alter table public.motorista_caminhoes enable row level security;

-- Motorista lê as PRÓPRIAS atribuições (o app filtra a lista com isso);
-- quem gerencia é o admin.
create policy "motorista le as proprias placas"
  on public.motorista_caminhoes for select
  using (motorista_id = auth.uid() or public.is_admin());

create policy "admin gerencia placas"
  on public.motorista_caminhoes for all
  using (public.is_admin())
  with check (public.is_admin());
