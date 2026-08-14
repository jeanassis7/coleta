-- ============================================================================
-- 0019 — Contas a pagar e despesas recorrentes — Módulo 2, Bloco 2
-- Aplicar no Supabase APÓS 0018.
-- ============================================================================
-- Nasceu de dois pedidos pequenos (forma de pagamento na manutenção, tique
-- de "assinei a nota" no abastecimento) que, olhados juntos, são a mesma
-- coisa: a empresa deve pra alguém e precisa saber quanto e quando.
--
-- POR QUE TABELA CENTRAL, se no estoque eu argumentei o contrário:
--   estoque é um NÚMERO DERIVADO — dá pra ler das origens.
--   conta a pagar é um FLUXO COM ESTADO (prevista → a pagar → paga).
-- Espalhar essa máquina de estado por quatro tabelas é implementá-la
-- quatro vezes e errar numa. E metade das contas (aluguel, imposto,
-- contador) não tem lançamento de origem — precisa da tabela de qualquer
-- jeito.
--
-- PREVISTA × REAL é a ideia do Evaner e responde a dúvida do IPVA: não
-- adianta virar dívida de valor chutado, porque é justamente o "quanto eu
-- devo hoje" que precisa ser confiável. Previsão aparece no fluxo
-- projetado, não conta como dívida, não entra no DRE — e vira real quando
-- o boleto chega e ele confirma o número.
-- ============================================================================

create table if not exists public.despesas_recorrentes (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,              -- Aluguel, Energia, Contador, IPVA do Iveco
  categoria text not null,
  fornecedor text,
  valor numeric(12,2) not null check (valor > 0),   -- editável quando reajustar
  dia_vencimento integer not null check (dia_vencimento between 1 and 31),
  periodicidade text not null default 'mensal'
    check (periodicidade in ('mensal', 'anual')),
  mes_vencimento integer check (mes_vencimento between 1 and 12),  -- só anual
  -- true = o valor é chute (energia, IPVA do ano que vem). Gera a conta
  -- como 'prevista', que precisa da conferência dele pra virar real.
  aproximada boolean not null default false,
  ativa boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  constraint anual_precisa_de_mes check (
    periodicidade <> 'anual' or mes_vencimento is not null
  )
);

create table if not exists public.contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  fornecedor text,
  categoria text not null,   -- combustivel, manutencao, oleo, imposto, fixa, outra
  valor numeric(12,2) not null check (valor > 0),
  vencimento date not null,

  status text not null default 'a_pagar'
    check (status in ('prevista', 'a_pagar', 'paga', 'cancelada')),

  forma_pagamento text
    check (forma_pagamento in ('dinheiro', 'pix', 'deposito', 'boleto', 'cheque')),
  pago_em date,
  -- Pagou repassando um cheque que entrou numa venda. É o elo entre os dois
  -- módulos: o mesmo papel some da carteira e quita a conta, sem ninguém
  -- digitar duas vezes.
  cheque_id uuid references public.cheques(id) on delete set null,

  -- De onde veio. Null = conta avulsa (aluguel, imposto, contador).
  origem_tipo text check (
    origem_tipo in ('abastecimento', 'manutencao', 'compra_direta', 'documento')
  ),
  origem_id uuid,
  recorrente_id uuid references public.despesas_recorrentes(id) on delete set null,
  -- Competência da parcela gerada por recorrente (aaaa-mm). Junto com
  -- recorrente_id forma o único que torna "Gerar contas do mês" idempotente:
  -- clicar duas vezes não duplica o aluguel.
  competencia text check (competencia ~ '^\d{4}-\d{2}$'),

  -- Parcelamento (compra direta a prazo): 2/5, 3/5...
  parcela integer check (parcela > 0),
  parcelas_total integer check (parcelas_total > 0),

  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),

  constraint paga_precisa_de_data check (status <> 'paga' or pago_em is not null)
);

create unique index if not exists idx_contas_recorrente_competencia
  on public.contas_a_pagar(recorrente_id, competencia)
  where recorrente_id is not null;

create index if not exists idx_contas_status_vencimento
  on public.contas_a_pagar(status, vencimento);
create index if not exists idx_contas_origem
  on public.contas_a_pagar(origem_tipo, origem_id);

alter table public.despesas_recorrentes enable row level security;
alter table public.contas_a_pagar        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['despesas_recorrentes','contas_a_pagar'] loop
    execute format('drop policy if exists "admin acesso total %1$s" on public.%1$I', t);
    execute format(
      'create policy "admin acesso total %1$s" on public.%1$I for all
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ============================================================================
-- resumo_contas_a_pagar() — o que o dashboard precisa, num round trip
-- ============================================================================
-- `prevista` fica FORA de tudo que é dívida. Ela só existe pro fluxo
-- projetado — misturar chute com dívida real destrói a confiança no número
-- que mais importa.
create or replace function public.resumo_contas_a_pagar()
returns table (
  a_pagar_total   numeric,
  vencidas_total  numeric,
  vencidas_qtd    integer,
  semana_total    numeric,
  semana_qtd      integer,
  previsto_total  numeric
)
language sql
stable
set search_path = public
as $$
  with hoje as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  )
  select
    round(coalesce(sum(c.valor) filter (where c.status = 'a_pagar'), 0), 2),
    round(coalesce(sum(c.valor) filter (
      where c.status = 'a_pagar' and c.vencimento < h.d), 0), 2),
    coalesce(count(*) filter (
      where c.status = 'a_pagar' and c.vencimento < h.d), 0)::integer,
    round(coalesce(sum(c.valor) filter (
      where c.status = 'a_pagar' and c.vencimento between h.d and h.d + 7), 0), 2),
    coalesce(count(*) filter (
      where c.status = 'a_pagar' and c.vencimento between h.d and h.d + 7), 0)::integer,
    round(coalesce(sum(c.valor) filter (where c.status = 'prevista'), 0), 2)
  from hoje h
  left join public.contas_a_pagar c on true;
$$;
