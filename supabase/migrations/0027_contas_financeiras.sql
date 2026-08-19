-- 0027 — Caixa de verdade: contas financeiras e transferências.
--
-- ---------------------------------------------------------------------------
-- O PRINCÍPIO
-- ---------------------------------------------------------------------------
-- Dinheiro não aparece nem some. Pra entregar dinheiro pro motorista, ele
-- saiu de algum lugar. Se entrou espécie, veio de uma venda ou de um saque.
-- Toda movimentação passa a apontar PRA QUAL CONTA.
--
-- Isso é a fundação do DRE: sem caixa, o DRE mostra número sem lastro.
--
-- ⚠️ NÃO criar trigger de log aqui — o event trigger `trg_auto_ligar_log`
-- (0022) liga sozinho em toda tabela nova de `public`.

create table if not exists public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('especie','banco')),
  -- Só fazem sentido quando tipo = 'banco'. Ficam aqui já pensando na
  -- conciliação bancária, que é fase posterior.
  banco text,
  agencia text,
  numero text,
  -- Sem saldo inicial o caixa nasce errado e nunca mais bate. A data é o
  -- CORTE: movimento anterior a ela não é somado, porque já está embutido
  -- no saldo informado.
  saldo_inicial numeric(12,2) not null default 0,
  saldo_inicial_em date not null,
  ativa boolean not null default true,
  ordem integer not null default 0,
  observacao text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_contas_financeiras_ativa
  on public.contas_financeiras(ativa, ordem);

-- ---------------------------------------------------------------------------
-- Transferência: dinheiro que troca de bolso
-- ---------------------------------------------------------------------------
-- Saque (banco → espécie) e depósito (espécie → banco) não são receita nem
-- despesa — é o mesmo dinheiro mudando de lugar. Ter isso como tabela própria
-- é o que faz o caixa fechar E o DRE ignorar corretamente.
create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  conta_origem_id  uuid not null references public.contas_financeiras(id),
  conta_destino_id uuid not null references public.contas_financeiras(id),
  valor numeric(12,2) not null check (valor > 0),
  data date not null,
  descricao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),
  constraint origem_diferente_do_destino
    check (conta_origem_id <> conta_destino_id)
);

create index if not exists idx_transferencias_data
  on public.transferencias(data desc);
create index if not exists idx_transferencias_origem
  on public.transferencias(conta_origem_id, data);
create index if not exists idx_transferencias_destino
  on public.transferencias(conta_destino_id, data);

-- ---------------------------------------------------------------------------
-- De qual conta cada movimento saiu / entrou
-- ---------------------------------------------------------------------------
-- Anulável no banco de propósito: as 2 contas a pagar que já existem não têm
-- de onde tirar conta, e `not null` quebraria o insert delas. A obrigação
-- vive na aplicação, onde dá pra explicar o porquê pra quem está lançando.
alter table public.recebimentos
  add column if not exists conta_id uuid references public.contas_financeiras(id);
alter table public.contas_a_pagar
  add column if not exists conta_id uuid references public.contas_financeiras(id);
alter table public.adiantamentos
  add column if not exists conta_id uuid references public.contas_financeiras(id);
-- Acerto devolve dinheiro da mão do motorista pro caixa — é ENTRADA.
alter table public.acertos
  add column if not exists conta_id uuid references public.contas_financeiras(id);

create index if not exists idx_recebimentos_conta   on public.recebimentos(conta_id);
create index if not exists idx_contas_pagar_conta   on public.contas_a_pagar(conta_id);
create index if not exists idx_adiantamentos_conta  on public.adiantamentos(conta_id);
create index if not exists idx_acertos_conta        on public.acertos(conta_id);

-- ---------------------------------------------------------------------------
-- RLS — dado de gestão, o motorista não vê nem escreve
-- ---------------------------------------------------------------------------
alter table public.contas_financeiras enable row level security;
alter table public.transferencias     enable row level security;

create policy "admin acesso total contas_financeiras"
  on public.contas_financeiras for all
  using (public.is_admin()) with check (public.is_admin());

create policy "admin acesso total transferencias"
  on public.transferencias for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- saldo_contas() — o saldo de todas as contas numa ida ao banco
-- ---------------------------------------------------------------------------
-- Uma consulta pra todas, não uma por conta: o N+1 do saldo do motorista já
-- deixou este painel em 4 segundos uma vez (foi o que gerou a 0013).
--
-- Tudo respeita o CORTE (`saldo_inicial_em`): movimento anterior já está
-- embutido no saldo informado e somar de novo dobraria.
--
-- Adiantamento CANCELADO não sai do caixa — o dinheiro não foi entregue.
-- Pendente sai: o motorista recebeu o dinheiro, só não confirmou no app.
create or replace function public.saldo_contas()
returns table (
  conta_id uuid,
  nome text,
  tipo text,
  saldo_inicial numeric,
  entradas numeric,
  saidas numeric,
  saldo numeric
)
language sql
stable
security definer
set search_path = public
as $funcao$
  with base as (
    select c.id, c.nome, c.tipo, c.saldo_inicial, c.saldo_inicial_em
    from public.contas_financeiras c
    where c.ativa = true
  ),
  ent as (
    select b.id,
      coalesce((
        select sum(r.valor) from public.recebimentos r
        where r.conta_id = b.id and r.data >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(t.valor) from public.transferencias t
        where t.conta_destino_id = b.id and t.data >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(a.valor_devolvido) from public.acertos a
        where a.conta_id = b.id
          and (a.corte_em at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0) as total
    from base b
  ),
  sai as (
    select b.id,
      coalesce((
        select sum(cp.valor) from public.contas_a_pagar cp
        where cp.conta_id = b.id and cp.status = 'paga'
          and cp.pago_em >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(ad.valor) from public.adiantamentos ad
        where ad.conta_id = b.id and ad.status <> 'cancelado'
          and ad.data_envio >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(t.valor) from public.transferencias t
        where t.conta_origem_id = b.id and t.data >= b.saldo_inicial_em
      ), 0) as total
    from base b
  )
  select
    b.id, b.nome, b.tipo,
    round(b.saldo_inicial, 2),
    round(ent.total, 2),
    round(sai.total, 2),
    round(b.saldo_inicial + ent.total - sai.total, 2)
  from base b
  join ent on ent.id = b.id
  join sai on sai.id = b.id
  order by b.nome;
$funcao$;
