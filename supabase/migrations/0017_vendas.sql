-- ============================================================================
-- 0017 — Compradores, vendas, recebimentos e cheques — Módulo 2, Bloco 2
-- Aplicar no Supabase APÓS 0016.
-- ============================================================================
-- A venda é o outro lado do estoque: um momento só, com o peso da balança
-- (qualquer balança — a do comprador é a que paga).
--
-- CONTA CORRENTE, não fatura. O Evaner descreveu o caso real: venda de
-- 50k, entra 20k de pix, depois 30.320 em cheque, e sobra 320 A FAVOR do
-- comprador. Forçar cada pagamento a casar com uma venda específica seria
-- burocracia que trava o lançamento. Então venda debita, pagamento credita,
-- saldo é a soma — e pode ficar positivo ou negativo.
--
-- CHEQUE É 1:1 COM RECEBIMENTO (unique). O desenho anterior permitia vários
-- cheques por recebimento e o Evaner achou o buraco: um recebimento misto
-- de R$ 10k em pix + R$ 2k em cheque, com o cheque voltando, faria a regra
-- "anula o recebimento do cheque devolvido" apagar os R$ 10k de pix junto.
-- Com 1:1 a regra fica trivial e o extrato fica granular.
-- ============================================================================

create table if not exists public.compradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text,
  contato text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists idx_compradores_ativo on public.compradores(ativo);

create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  comprador_id uuid not null references public.compradores(id),
  data date not null,

  -- Peso da balança. A mistura fino/grosso é estimada na hora ("meio a
  -- meio"), sem precisão milimétrica — mas tem que fechar com o total,
  -- senão o estoque sangra sem ninguém ver.
  peso_total_kg numeric(12,2) not null check (peso_total_kg > 0),
  kg_fino   numeric(12,2) not null default 0 check (kg_fino   >= 0),
  kg_grosso numeric(12,2) not null default 0 check (kg_grosso >= 0),
  constraint mistura_fecha check (kg_fino + kg_grosso = peso_total_kg),

  -- 4 casas de propósito: R$/kg de óleo anda em centavos e arredondar em 2
  -- sobre 12 toneladas erra dezenas de reais. O total fica com 2 — é ele
  -- que vale, e é ele que o comprador paga.
  preco_kg    numeric(12,4) not null check (preco_kg > 0),
  valor_total numeric(12,2) not null check (valor_total > 0),

  caminhao_id uuid references public.caminhoes(id),  -- null = comprador buscou
  nota_numero text,
  foto_ticket_path text,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_vendas_comprador on public.vendas(comprador_id);
create index if not exists idx_vendas_data on public.vendas(data desc);

-- RECEBIMENTOS — o lado credor da conta corrente do comprador.
create table if not exists public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  comprador_id uuid not null references public.compradores(id),
  venda_id uuid references public.vendas(id) on delete set null,  -- opcional
  forma text not null check (forma in ('pix','dinheiro','transferencia','cheque')),
  valor numeric(12,2) not null check (valor > 0),
  data date not null,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_recebimentos_comprador on public.recebimentos(comprador_id);

-- CHEQUES — objeto com vida própria. Nasce numa venda, fica na carteira, e
-- sai por três portas: depositado (compensa ou volta) ou repassado (paga um
-- fornecedor). Dois relógios: a dívida do comprador quita quando ele
-- entrega o papel; o dinheiro entra quando compensa.
create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null unique
    references public.recebimentos(id) on delete cascade,
  comprador_id uuid not null references public.compradores(id),
  banco text not null,
  emitente text not null,
  numero text,
  valor numeric(12,2) not null check (valor > 0),
  bom_para date not null,
  status text not null default 'em_carteira'
    check (status in ('em_carteira','depositado','compensado','devolvido','repassado')),
  repassado_para text,
  repassado_em date,
  depositado_em date,
  compensado_em date,
  devolvido_em date,
  foto_path text,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cheques_status_bompara
  on public.cheques(status, bom_para);
create index if not exists idx_cheques_comprador on public.cheques(comprador_id);

-- ============================================================================
-- RLS — tudo admin/dev. Motorista não tem nada a ver com venda.
-- ============================================================================
alter table public.compradores  enable row level security;
alter table public.vendas       enable row level security;
alter table public.recebimentos enable row level security;
alter table public.cheques      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['compradores','vendas','recebimentos','cheques'] loop
    execute format('drop policy if exists "admin acesso total %1$s" on public.%1$I', t);
    execute format(
      'create policy "admin acesso total %1$s" on public.%1$I for all
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ============================================================================
-- saldo_compradores() — conta corrente num round trip só
-- ============================================================================
-- Mesmo padrão da saldos_motoristas() (0013): a conta inteira dentro do
-- Postgres pra não repetir o N+1 que deixou o painel em 3-4s.
--
-- Cheque devolvido DEVOLVE A DÍVIDA sozinho: o recebimento dele para de
-- contar. Como é 1:1, anula exatamente o valor daquele cheque e nada mais.
--
-- Devolve os componentes (vendido, recebido, devolvido) porque um saldo
-- solto não serve — a ficha precisa dizer DE ONDE vem, senão o Jean vê
-- "3.560" e vai caçar o motivo no WhatsApp.
create or replace function public.saldo_compradores()
returns table (
  comprador_id uuid,
  vendido   numeric,
  recebido  numeric,
  devolvido numeric,
  saldo     numeric
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    round(coalesce(v.total, 0), 2)  as vendido,
    round(coalesce(r.total, 0), 2)  as recebido,
    round(coalesce(d.total, 0), 2)  as devolvido,
    round(coalesce(v.total, 0) - coalesce(r.total, 0), 2) as saldo
  from public.compradores c

  left join lateral (
    select sum(vv.valor_total) as total
    from public.vendas vv where vv.comprador_id = c.id
  ) v on true

  -- Recebimento vale, EXCETO se o cheque dele voltou.
  left join lateral (
    select sum(rr.valor) as total
    from public.recebimentos rr
    left join public.cheques ch on ch.recebimento_id = rr.id
    where rr.comprador_id = c.id
      and (ch.id is null or ch.status <> 'devolvido')
  ) r on true

  -- Quanto da dívida atual é cheque que voltou — pra ficha nomear.
  left join lateral (
    select sum(ch.valor) as total
    from public.cheques ch
    where ch.comprador_id = c.id and ch.status = 'devolvido'
  ) d on true;
$$;

-- ============================================================================
-- Estoque: a venda entra como SAÍDA
-- ============================================================================
-- A função estoque_atual() da 0016 já sabe tratar 'saida' — só faltava a
-- view ter de onde tirar. Colunas e ordem idênticas (exigência do
-- `create or replace view`).
create or replace view public.movimentos_estoque
with (security_invoker = true) as

  select
    d.id                                as referencia_id,
    'descarga'::text                    as origem,
    'fino'::text                        as tipo_oleo,
    'entrada'::text                     as especie,
    d.peso_liquido_kg::numeric          as kg,
    coalesce((
      select sum(c.valor_pago) from public.coletas c
      where c.carga_id = d.carga_id
    ), 0)::numeric                      as custo,
    d.criado_em                         as momento,
    (d.criado_em at time zone 'America/Sao_Paulo')::date as dia,
    1                                   as prioridade,
    coalesce(p.nome, '—')               as descricao
  from public.descargas d
  join public.cargas   g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id
  where p.is_teste = false

  union all

  select
    cd.id, 'compra_direta', cd.tipo_oleo, 'entrada',
    cd.peso_kg, cd.valor,
    cd.data::timestamptz, cd.data, 1,
    cd.fornecedor
  from public.compras_diretas cd
  where cd.entra_no_estoque = true

  union all

  -- Saída de fino e de grosso são linhas separadas: cada estoque tem seu
  -- próprio custo médio, então a mistura precisa sair de cada um.
  select
    v.id, 'venda', 'fino', 'saida',
    v.kg_fino, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_fino > 0

  union all

  select
    v.id, 'venda', 'grosso', 'saida',
    v.kg_grosso, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_grosso > 0

  union all

  select
    aj.id, 'ajuste', aj.tipo_oleo, 'ajuste',
    aj.saldo_novo_kg, aj.custo_medio_kg,
    aj.criado_em, aj.data, 2,
    aj.motivo
  from public.ajustes_estoque aj;
