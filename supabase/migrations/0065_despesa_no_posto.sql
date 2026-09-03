-- ============================================================================
-- 0065 — NO POSTO TAMBÉM SE ASSINA NOTA DE DESPESA
-- ============================================================================
-- A conta do posto nunca foi só combustível: palheta, óleo de motor, uma
-- borracha — tudo sai na mesma nota assinada e entra no mesmo acerto do fim
-- do mês (Evaner, 03/09/2026).
--
-- A despesa não tinha como apontar pro posto (`local_id` nunca existiu nela),
-- então essas notas ficavam fora do saldo do posto e o acerto fechava por um
-- valor menor que o real — o gestor pagaria olhando um número incompleto.

-- ---------------------------------------------------------------------------
-- 1. A despesa aprende onde foi e de quem é
-- ---------------------------------------------------------------------------
alter table public.despesas
  add column if not exists local_id uuid references public.locais(id) on delete set null,
  add column if not exists socio_id uuid references public.profiles(id);

comment on column public.despesas.socio_id is
  'Preenchido = despesa particular do sócio na nota da empresa. Vira '
  'transferência a sócio no DRE, não custo de viagem. Mesma regra da 0061 '
  'para abastecimento.';

alter table public.despesas drop constraint if exists despesa_socio_sem_motorista;
alter table public.despesas
  add constraint despesa_socio_sem_motorista
  check (socio_id is null or motorista_id is null);

create index if not exists idx_despesas_local on public.despesas(local_id);

-- ---------------------------------------------------------------------------
-- 2. O gatilho da despesa assinada passa a nomear o fornecedor e rotear
-- ---------------------------------------------------------------------------
-- Espelho fiel do que a 0061 fez no abastecimento. Antes o fornecedor nascia
-- NULO: a conta existia, mas não dizia com quem era a dívida.
create or replace function public.criar_conta_da_despesa_assinada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local text;
  v_socio text;
begin
  if exists (
    select 1 from public.contas_a_pagar
    where origem_tipo = 'despesa' and origem_id = new.id
  ) then
    return new;
  end if;

  if new.local_id is not null then
    select nome_canonico into v_local from public.locais where id = new.local_id;
  end if;
  if new.socio_id is not null then
    select nome into v_socio from public.profiles where id = new.socio_id;
  end if;

  insert into public.contas_a_pagar (
    descricao, fornecedor, categoria, pessoa_id, valor, vencimento, status,
    origem_tipo, origem_id, registrado_por
  ) values (
    case
      when new.socio_id is not null then
        'Particular — ' || coalesce(v_socio, 'sócio') || ': ' || left(new.descricao, 60)
      else 'Despesa (nota assinada) — ' || left(new.descricao, 80)
    end,
    v_local,
    case when new.socio_id is not null then 'transferencia_socio'
         else 'custos_viagem' end,
    new.socio_id,
    new.valor,
    (date_trunc('month', (new.criado_em at time zone 'America/Sao_Paulo')::date)
      + interval '1 month')::date,
    'a_pagar',
    'despesa',
    new.id,
    coalesce(new.motorista_id, new.socio_id, new.lancado_por)
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. saldo_postos() passa a somar as duas origens
-- ---------------------------------------------------------------------------
-- Sem isto o saldo mostraria só o combustível, e o Jean pagaria o posto
-- olhando um número menor do que deve.
create or replace function public.saldo_postos()
returns table (
  local_id      uuid,
  nome          text,
  notas_abertas bigint,
  saldo         numeric
)
language sql
stable
set search_path = public
as $$
  with notas as (
    select ab.local_id, cp.id, cp.valor
    from public.abastecimentos ab
    join public.contas_a_pagar cp
      on cp.origem_tipo = 'abastecimento' and cp.origem_id = ab.id
    where cp.status = 'a_pagar' and ab.local_id is not null

    union all

    select d.local_id, cp.id, cp.valor
    from public.despesas d
    join public.contas_a_pagar cp
      on cp.origem_tipo = 'despesa' and cp.origem_id = d.id
    where cp.status = 'a_pagar' and d.local_id is not null
  )
  select
    l.id,
    l.nome_canonico,
    count(n.id),
    round(coalesce(sum(n.valor), 0), 2)
  from public.locais l
  left join notas n on n.local_id = l.id
  where l.tipo = 'posto'
  group by l.id, l.nome_canonico;
$$;

revoke all on function public.saldo_postos() from public;
grant execute on function public.saldo_postos() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A despesa também ensina o posto onde ele fica
-- ---------------------------------------------------------------------------
create or replace function public.posto_aprende_gps_despesa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.local_id is not null
     and new.latitude is not null
     and new.longitude is not null then
    update public.locais
       set latitude = new.latitude,
           longitude = new.longitude
     where id = new.local_id
       and tipo = 'posto'
       and latitude is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posto_aprende_gps_despesa on public.despesas;
create trigger trg_posto_aprende_gps_despesa
  after insert on public.despesas
  for each row execute function public.posto_aprende_gps_despesa();
