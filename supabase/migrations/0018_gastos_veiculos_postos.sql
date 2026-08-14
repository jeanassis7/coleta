-- ============================================================================
-- 0018 — Gastos fora da carga, veículos e postos — Módulo 2, Bloco 2
-- Aplicar no Supabase APÓS 0017.
-- ============================================================================
-- ⚠️ ESTA É A ÚNICA MIGRATION DO MÓDULO QUE MEXE EM TABELA COM DADO REAL
-- EM PRODUÇÃO. Roda inteira em transação (aplicar-migration.mjs) e ABORTA
-- de propósito se o backfill deixar qualquer linha órfã — em vez de tentar
-- o `set not null` e quebrar no meio.
--
-- Três coisas que só juntas fazem sentido:
--
-- 1. Abastecimento e despesa hoje EXIGEM carga e motorista. A entrega que o
--    Jean faz com caminhão próprio não tem nem um nem outro.
--
-- 2. "ASSINEI A NOTA" — o motorista assina no posto e a empresa paga no mês
--    seguinte. ⚠️ Nesse caso ele NÃO GASTOU NADA: saldos_motoristas()
--    descontava todo abastecimento do saldo dele, e isso faria ele receber
--    a MENOS no acerto. Um lançamento, dois efeitos opostos.
--
-- 3. O posto vira local por GPS, igual à coleta — reusando `locais` e
--    `locais_proximos()`, que já existem e já foram debugados.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Veículos: caminhão e carro na mesma tabela
-- ---------------------------------------------------------------------------
-- Jean e Valdecir abastecem carro próprio assinando a mesma nota, e isso é
-- custo operacional legítimo. Como carro não tem tara nem capacidade, essas
-- colunas viram opcionais — mas com CHECK, porque a descarga depende da tara
-- e um caminhão sem ela quebraria o fluxo do motorista.
alter table public.caminhoes
  alter column tara_kg      drop not null,
  alter column capacidade_l drop not null;

alter table public.caminhoes
  add column if not exists tipo text not null default 'caminhao'
    check (tipo in ('caminhao', 'carro')),
  add column if not exists de_quem text;

alter table public.caminhoes
  drop constraint if exists caminhao_precisa_tara_e_capacidade;
alter table public.caminhoes
  add constraint caminhao_precisa_tara_e_capacidade check (
    tipo <> 'caminhao' or (tara_kg is not null and capacidade_l is not null)
  );

-- O motorista escolhe veículo ao iniciar carga. Carro nunca pode aparecer
-- ali — filtrado na RLS além da query, porque errar isso significaria um
-- motorista iniciando carga num Corolla.
drop policy if exists "motorista lê caminhoes ativos" on public.caminhoes;
create policy "motorista lê caminhoes ativos"
  on public.caminhoes for select
  to authenticated
  using (ativo = true and tipo = 'caminhao');

-- ---------------------------------------------------------------------------
-- 2. Postos como local por GPS
-- ---------------------------------------------------------------------------
alter table public.locais
  add column if not exists tipo text not null default 'coleta'
    check (tipo in ('coleta', 'posto'));

create index if not exists idx_locais_tipo on public.locais(tipo);

-- `create or replace` não muda assinatura: com 4 argumentos viraria uma
-- SOBRECARGA, e a chamada de 3 argumentos que já existe em
-- /api/locais/proximos ficaria ambígua. Por isso derruba e recria.
drop function if exists public.locais_proximos(double precision, double precision, integer);

create or replace function public.locais_proximos(
  p_lat double precision,
  p_lng double precision,
  p_raio_m integer default 200,
  p_tipo text default 'coleta'
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
    and l.tipo = p_tipo
    and l.latitude between p_lat - limites.delta_lat_grau and p_lat + limites.delta_lat_grau
    and l.longitude between p_lng - limites.delta_lng_grau and p_lng + limites.delta_lng_grau
  order by distancia_m asc;
$$;

-- ---------------------------------------------------------------------------
-- 3. Abastecimentos e despesas fora da carga
-- ---------------------------------------------------------------------------
alter table public.abastecimentos
  alter column carga_id     drop not null,
  alter column motorista_id drop not null,
  add column if not exists caminhao_id uuid references public.caminhoes(id),
  add column if not exists venda_id    uuid references public.vendas(id) on delete set null,
  add column if not exists lancado_por uuid references public.profiles(id),
  add column if not exists local_id    uuid references public.locais(id) on delete set null,
  -- true  = "PAGUEI AGORA"   → sai do saldo do motorista, sem conta a pagar
  -- false = "ASSINEI A NOTA" → não sai do saldo, vira conta a pagar do posto
  add column if not exists pago_na_hora boolean not null default true;

alter table public.despesas
  alter column carga_id     drop not null,
  alter column motorista_id drop not null,
  add column if not exists caminhao_id uuid references public.caminhoes(id),
  add column if not exists venda_id    uuid references public.vendas(id) on delete set null,
  add column if not exists lancado_por uuid references public.profiles(id);

-- ---------------------------------------------------------------------------
-- 4. Trigger que preenche caminhao_id sozinho
-- ---------------------------------------------------------------------------
-- ⚠️ SEM ISTO, TODO MOTORISTA EM CAMPO QUEBRA.
--
-- O PWA fica CACHEADO no celular deles (StaleWhileRevalidate — o app pode
-- rodar a versão antiga por vários usos até atualizar). Se o banco passar a
-- exigir uma coluna que o bundle instalado não manda, cada despesa e cada
-- abastecimento lançado por quem ainda está na versão velha falha no sync —
-- sem sinal nenhum pro motorista, que só veria o lançamento não subir.
--
-- Com o trigger, cliente novo e cliente velho funcionam: quem manda
-- caminhao_id tem o valor respeitado; quem não manda tem ele derivado da
-- carga. É o mesmo motivo pelo qual `carga_id` nasceu nullable na 0007.
create or replace function public.preencher_caminhao_do_lancamento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.caminhao_id is null and new.carga_id is not null then
    select g.caminhao_id into new.caminhao_id
      from public.cargas g
     where g.id = new.carga_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_abastecimento_caminhao on public.abastecimentos;
create trigger trg_abastecimento_caminhao
  before insert or update on public.abastecimentos
  for each row execute function public.preencher_caminhao_do_lancamento();

drop trigger if exists trg_despesa_caminhao on public.despesas;
create trigger trg_despesa_caminhao
  before insert or update on public.despesas
  for each row execute function public.preencher_caminhao_do_lancamento();

-- ---------------------------------------------------------------------------
-- 5. Backfill do caminhao_id — com diagnóstico que aborta
-- ---------------------------------------------------------------------------
do $$
declare
  n_ab integer;
  n_de integer;
begin
  update public.abastecimentos ab
     set caminhao_id = g.caminhao_id
    from public.cargas g
   where g.id = ab.carga_id and ab.caminhao_id is null;

  update public.despesas de
     set caminhao_id = g.caminhao_id
    from public.cargas g
   where g.id = de.carga_id and de.caminhao_id is null;

  select count(*) into n_ab from public.abastecimentos where caminhao_id is null;
  select count(*) into n_de from public.despesas      where caminhao_id is null;

  raise notice 'Backfill: % abastecimento(s) e % despesa(s) sem caminhao.', n_ab, n_de;

  if n_ab > 0 or n_de > 0 then
    raise exception
      'BACKFILL INCOMPLETO — % abastecimento(s) e % despesa(s) ficariam com caminhao_id nulo. Migration abortada de proposito: resolva essas linhas antes de rodar de novo.',
      n_ab, n_de;
  end if;
end $$;

alter table public.abastecimentos alter column caminhao_id set not null;
alter table public.despesas       alter column caminhao_id set not null;

-- Todo lançamento tem dono: ou é de uma carga de motorista, ou foi lançado
-- no painel. Sem isso, uma linha órfã ficaria invisível nos dois lugares.
alter table public.abastecimentos drop constraint if exists abastecimento_tem_origem;
alter table public.abastecimentos add constraint abastecimento_tem_origem
  check (carga_id is not null or lancado_por is not null);

alter table public.despesas drop constraint if exists despesa_tem_origem;
alter table public.despesas add constraint despesa_tem_origem
  check (carga_id is not null or lancado_por is not null);

create index if not exists idx_abastecimentos_caminhao on public.abastecimentos(caminhao_id);
create index if not exists idx_abastecimentos_local on public.abastecimentos(local_id);
create index if not exists idx_abastecimentos_a_pagar
  on public.abastecimentos(pago_na_hora) where pago_na_hora = false;
create index if not exists idx_despesas_caminhao on public.despesas(caminhao_id);

-- ---------------------------------------------------------------------------
-- 5. saldos_motoristas(): abastecimento assinado NÃO desconta do motorista
-- ---------------------------------------------------------------------------
-- A única mudança em relação à 0013 é o `and ab.pago_na_hora` — mas é ela
-- que impede o motorista de receber a menos no acerto por um diesel que
-- ele não pagou.
create or replace function public.saldos_motoristas()
returns table (motorista_id uuid, saldo numeric)
language sql
stable
set search_path = public
as $$
  with ultimo_acerto as (
    select distinct on (a.motorista_id)
      a.motorista_id, a.corte_em, a.valor_saldo
    from public.acertos a
    order by a.motorista_id, a.corte_em desc
  ),
  base as (
    select
      p.id as motorista_id,
      coalesce(ua.corte_em, '1970-01-01'::timestamptz) as corte,
      coalesce(ua.valor_saldo, 0) as carry
    from public.profiles p
    left join ultimo_acerto ua on ua.motorista_id = p.id
    where p.role = 'motorista'
  )
  select
    b.motorista_id,
    round(
      b.carry
      + coalesce((
          select sum(ad.valor) from public.adiantamentos ad
          where ad.motorista_id = b.motorista_id
            and ad.status = 'aceito'
            and ad.aceito_em > b.corte
        ), 0)
      - coalesce((
          select sum(c.valor_pago) from public.coletas c
          where c.motorista_id = b.motorista_id and c.criado_em > b.corte
        ), 0)
      - coalesce((
          select sum(d.valor) from public.despesas d
          where d.motorista_id = b.motorista_id and d.criado_em > b.corte
        ), 0)
      - coalesce((
          select sum(ab.valor) from public.abastecimentos ab
          where ab.motorista_id = b.motorista_id
            and ab.criado_em > b.corte
            and ab.pago_na_hora   -- assinou a nota = dinheiro dele nao saiu
        ), 0)
    , 2) as saldo
  from base b;
$$;
