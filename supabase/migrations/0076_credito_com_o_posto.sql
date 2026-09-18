-- ============================================================================
-- 0076 — QUANDO O POSTO FICA DEVENDO PRA GENTE
-- ============================================================================
-- Caso real, 14-15/09/2026. O Jean transcreveu 10 notas assinadas do CENTRO
-- OESTE (R$ 3.882,79) e pagou o acerto inteiro com um cheque de R$ 4.055,56.
-- O posto abateu tudo e ficou devendo R$ 172,77.
--
-- O sistema não tinha onde guardar isso. O `saldo_postos()` só sabe SOMAR o
-- que a gente deve — nota em aberto nunca é negativa. Então o vale sumia, e
-- a única lembrança que restava era a cabeça do Jean.
--
-- Eu tinha escrito no PLANO-PAGAMENTO-FLEXIVEL que "sobra é troco, e troco
-- volta em dinheiro", e isso foi aprovado. O caso real mostrou que está
-- errado: o Evaner confirmou que **é recorrente** — "esse saldo que o posto
-- deve sempre é residual, 100, 200 reais".
--
-- ---------------------------------------------------------------------------
-- O CRÉDITO SE COMPORTA COMO UM CHEQUE SEM PAPEL
-- ---------------------------------------------------------------------------
-- É de propósito: o motor de pagamento (`src/lib/admin/pagar-contas.ts`) já
-- sabe consumir meios, e o crédito entra como mais um. Ele nasce inteiro,
-- é gasto inteiro, e se sobrar no próximo acerto nasce um crédito novo com o
-- resto — exatamente o ciclo do cheque. Nada de consumo parcial, que exigiria
-- um saldo por linha e um lugar a mais pra errar.
--
-- ⚠️ CRÉDITO NÃO É CAIXA. Ele não entra na `movimentos_caixa` nem no
-- `saldo_contas()` — o dinheiro não está em conta nenhuma, está com o posto.
-- É o mesmo tratamento do cheque na carteira: existe, vale, e não é saldo
-- bancário.
--
-- ⚠️ E NÃO ENTRA NO DRE, nem quando nasce nem quando é usado. A conta já
-- fecha sozinha: o cheque repassado contou como receita pelo valor cheio
-- (R67-b) e as notas contaram como despesa; a diferença vira despesa quando
-- o crédito for gasto nas próximas notas. Somando os dois momentos, receita
-- e despesa batem. Lançar o crédito no resultado contaria a mesma coisa duas
-- vezes.
-- ============================================================================

create table if not exists public.creditos_fornecedor (
  id uuid primary key default gen_random_uuid(),

  -- Hoje só posto: é onde a conta corrente com fornecedor existe de verdade
  -- (`saldo_postos()`), e é onde o Evaner pediu a lembrança.
  local_id uuid not null references public.locais(id),

  valor numeric(12,2) not null check (valor > 0),
  data date not null,

  -- De onde nasceu: o acerto (carimbo da 0073) e o papel que sobrou.
  pagamento_id uuid,
  cheque_id uuid references public.cheques(id) on delete set null,

  -- Gasto inteiro num acerto seguinte. `consumido_por` é o `pagamento_id`
  -- que usou — é o que permite desfazer aquele acerto e o crédito voltar.
  consumido_em date,
  consumido_por uuid,

  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),

  constraint consumido_tem_data check (
    (consumido_em is null) = (consumido_por is null)
  )
);

create index if not exists idx_creditos_local_aberto
  on public.creditos_fornecedor(local_id) where consumido_em is null;
create index if not exists idx_creditos_consumido_por
  on public.creditos_fornecedor(consumido_por);

-- Um cheque gera no máximo UM crédito, pelo mesmo motivo que gera no máximo
-- um troco (0072): dois seriam dinheiro inventado.
create unique index if not exists idx_creditos_cheque_unico
  on public.creditos_fornecedor(cheque_id) where cheque_id is not null;

comment on table public.creditos_fornecedor is
  'O posto ficou devendo pra gente (pagamos a mais num acerto). Não é caixa e não é DRE — é o espelho da nota em aberto. Nasce inteiro e é gasto inteiro, como um cheque.';

alter table public.creditos_fornecedor enable row level security;
drop policy if exists creditos_fornecedor_admin on public.creditos_fornecedor;
create policy creditos_fornecedor_admin on public.creditos_fornecedor
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- saldo_postos() PASSA A PODER FICAR NEGATIVO
-- ---------------------------------------------------------------------------
-- Negativo = eles devem pra gente. Era isso que o Evaner queria ver ao clicar
-- no posto: "a questão é clicar no posto ali e ficar o saldo pra nós, essa
-- lembrança".
--
-- `notas_abertas` continua contando SÓ nota — o crédito não é nota, e inflar
-- essa contagem faria a tela dizer "10 notas" onde há 9 notas e um vale.
-- A coluna nova (`credito_aberto`) muda a assinatura, e o Postgres não deixa
-- `create or replace` trocar o tipo de retorno. Drop antes — a função é lida
-- por RPC, não referenciada por view, então derrubar é seguro.
drop function if exists public.saldo_postos();

create or replace function public.saldo_postos()
returns table (
  local_id       uuid,
  nome           text,
  notas_abertas  bigint,
  saldo          numeric,
  credito_aberto numeric
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

    union all

    -- Dívida apontada direto pro posto (cheque devolvido, 0073).
    select cp.local_id, cp.id, cp.valor
    from public.contas_a_pagar cp
    where cp.status = 'a_pagar'
      and cp.local_id is not null
      and (cp.origem_tipo is null
           or cp.origem_tipo not in ('abastecimento', 'despesa'))
  ),
  creditos as (
    select c.local_id, sum(c.valor) as total
    from public.creditos_fornecedor c
    where c.consumido_em is null
    group by c.local_id
  )
  select
    l.id,
    l.nome_canonico,
    count(n.id),
    round(coalesce(sum(n.valor), 0) - coalesce(max(cr.total), 0), 2),
    round(coalesce(max(cr.total), 0), 2)
  from public.locais l
  left join notas n on n.local_id = l.id
  left join creditos cr on cr.local_id = l.id
  where l.tipo = 'posto'
  group by l.id, l.nome_canonico;
$$;

revoke all on function public.saldo_postos() from public;
grant execute on function public.saldo_postos() to authenticated;
