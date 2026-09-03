-- ============================================================================
-- 0061 — POSTO É UM LUGAR, E NEM TODA NOTA ASSINADA É CUSTO DA OPERAÇÃO
-- ============================================================================
-- Duas coisas que nasceram do primeiro mês de abastecimento real (03/09/2026):
--
-- 1) O posto era texto livre. Em 3 lançamentos já apareceram "Texas" e
--    "Posto texas" (a 20 m um do outro, mesmo posto) e um terceiro "Texas"
--    a 4,3 km — outro posto, mesmo nome. Agrupar por texto juntaria dívidas
--    de lugares diferentes; agrupar por GPS acerta os dois casos.
--
-- 2) Toda nota assinada virava `combustivel` no DRE. Quando o sócio abastece
--    o carro particular na mesma nota, o custo operacional infla e a retirada
--    dele desaparece — distorção silenciosa, que ninguém percebe até o número
--    já ter mentido por meses.
--
-- ⚠️ REVOGA UMA PREMISSA DA 0018. Lá está escrito que "Jean e Valdecir
--    abastecem carro próprio assinando a mesma nota, e isso é custo
--    operacional legítimo". Decisão do Evaner em 03/09/2026: para fins do
--    software, os dois são SÓCIOS — o abastecimento particular deles é
--    transferência a sócio, não custo.

-- ---------------------------------------------------------------------------
-- 1. De quem é o abastecimento que não é da operação
-- ---------------------------------------------------------------------------
alter table public.abastecimentos
  add column if not exists socio_id uuid references public.profiles(id);

comment on column public.abastecimentos.socio_id is
  'Preenchido = abastecimento particular do sócio, na nota da empresa. Vira '
  'transferência a sócio no DRE (não combustível) e fica FORA do km/L e do '
  'custo da frota. Nulo = abastecimento da operação.';

-- O do motorista vem do celular; o do sócio é lançado no painel. Os dois
-- juntos não existem — e se existissem, o mesmo litro seria custo da
-- operação e retirada do sócio ao mesmo tempo.
alter table public.abastecimentos
  drop constraint if exists abastecimento_socio_sem_motorista;
alter table public.abastecimentos
  add constraint abastecimento_socio_sem_motorista
  check (socio_id is null or motorista_id is null);

create index if not exists idx_abastecimentos_socio
  on public.abastecimentos(socio_id) where socio_id is not null;

-- ---------------------------------------------------------------------------
-- 2. O gatilho da nota assinada passa a ROTEAR a categoria
-- ---------------------------------------------------------------------------
-- Mesmo desenho da 0034 (trigger no banco cobre celular, painel e script;
-- security definer porque quem dispara é o motorista e contas_a_pagar é
-- admin-only). A única mudança é o destino contábil.
create or replace function public.criar_conta_da_nota_assinada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_socio_nome text;
begin
  -- Idempotente: se a conta dessa origem já existe (retry do sync, painel
  -- que criou por fora), não duplica.
  if exists (
    select 1 from public.contas_a_pagar
    where origem_tipo = 'abastecimento' and origem_id = new.id
  ) then
    return new;
  end if;

  if new.socio_id is not null then
    select nome into v_socio_nome from public.profiles where id = new.socio_id;
  end if;

  insert into public.contas_a_pagar (
    descricao, fornecedor, categoria, pessoa_id, valor, vencimento, status,
    origem_tipo, origem_id, registrado_por
  ) values (
    case
      when new.socio_id is not null then
        'Combustível particular — ' || coalesce(v_socio_nome, 'sócio')
        || ' (' || new.posto_nome || ')'
      else 'Diesel (nota assinada) — ' || new.posto_nome
    end,
    new.posto_nome,
    -- É AQUI que o DRE deixa de mentir: sem sócio, custo de combustível;
    -- com sócio, retirada. A categoria existe no plano de contas desde
    -- sempre, com pedePessoa — só faltava alguém apontar pra ela.
    case when new.socio_id is not null then 'transferencia_socio'
         else 'combustivel' end,
    new.socio_id,
    new.valor,
    -- Sem vencimento combinado, dia 1 do mês seguinte — mesma convenção da
    -- coleta paga pela sede ("pago início do mês que vem").
    (date_trunc('month', (new.criado_em at time zone 'America/Sao_Paulo')::date)
      + interval '1 month')::date,
    'a_pagar',
    'abastecimento',
    new.id,
    coalesce(new.motorista_id, new.socio_id, new.lancado_por)
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill: os postos nascem do GPS dos abastecimentos que já existem
-- ---------------------------------------------------------------------------
-- Por GPS, não por nome, pelo motivo do cabeçalho. O raio de 100 m é o mesmo
-- número que o projeto já usa pra casar coleta com local canônico.
--
-- Reusa `locais_proximos()` em vez de repetir a fórmula de distância: ela já
-- existe, já filtra por tipo e já foi debugada em campo.
do $$
declare
  a       record;
  v_local uuid;
begin
  for a in
    select id, posto_nome, latitude, longitude
    from public.abastecimentos
    where local_id is null
      and latitude is not null
      and longitude is not null
    order by criado_em
  loop
    select lp.id into v_local
    from public.locais_proximos(a.latitude, a.longitude, 100, 'posto') lp
    limit 1;

    if v_local is null then
      insert into public.locais (nome_canonico, latitude, longitude, tipo, raio_match_m)
      values (trim(a.posto_nome), a.latitude, a.longitude, 'posto', 100)
      returning id into v_local;
    else
      -- Grafia diferente do mesmo posto vira apelido — é o que a curadoria
      -- usa depois pra reconhecer o que o motorista digitou.
      update public.locais
         set apelidos = (
               select array_agg(distinct x)
               from unnest(coalesce(apelidos, '{}'::text[]) || trim(a.posto_nome)) x
               where x is not null and x <> nome_canonico
             )
       where id = v_local;
    end if;

    update public.abastecimentos set local_id = v_local where id = a.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. saldo_postos() — quanto se deve em cada posto
-- ---------------------------------------------------------------------------
-- A dívida mora em contas_a_pagar; o posto vem do abastecimento que a
-- originou. Não copio o posto pra dentro da conta de propósito: duas donas
-- da mesma verdade discordam um dia.
--
-- Só conta o que está EM ABERTO ('a_pagar'): prevista é palpite e paga é
-- história. Mesma régua do resto do sistema.
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
  select
    l.id,
    l.nome_canonico,
    count(cp.id),
    round(coalesce(sum(cp.valor), 0), 2)
  from public.locais l
  left join public.abastecimentos ab on ab.local_id = l.id
  left join public.contas_a_pagar cp
         on cp.origem_tipo = 'abastecimento'
        and cp.origem_id = ab.id
        and cp.status = 'a_pagar'
  where l.tipo = 'posto'
  group by l.id, l.nome_canonico;
$$;

revoke all on function public.saldo_postos() from public;
grant execute on function public.saldo_postos() to authenticated;
