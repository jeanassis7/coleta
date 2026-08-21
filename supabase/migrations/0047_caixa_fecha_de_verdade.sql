-- ============================================================================
-- 0047 — O CAIXA FECHA DE VERDADE
-- ============================================================================
-- A varredura de 20/08 (VARREDURA-DINHEIRO.md) mostrou que o "sistema
-- fechado de dinheiro" tinha portas faltando: dinheiro que entra sem ser
-- venda de óleo não tinha onde ser lançado, a conferência física da gaveta
-- não tinha contrapartida, o motorista não tinha como devolver troco sem
-- fechar o ciclo, e gasto de campo pago DIRETO pela sede entrava no DRE sem
-- sair de conta nenhuma. Esta migration abre as portas que faltavam.
--
-- REGRA DE OURO que nada aqui muda: prevista não entra no DRE; entrada
-- avulsa e ajuste de caixa TAMBÉM não entram no DRE — aporte, empréstimo e
-- acerto de gaveta não são RESULTADO, são caixa. O DRE continua contando
-- só o que a operação ganhou e gastou.

-- ============================================================================
-- 1) ENTRADAS AVULSAS — dinheiro que entra sem ser venda de óleo
-- ============================================================================
-- Aporte do sócio, empréstimo recebido, reembolso, rendimento de aplicação,
-- venda de um ativo (caminhão velho, sucata). Sem esta tabela, qualquer um
-- desses caindo na conta deixava o saldo do sistema menor que o extrato
-- PARA SEMPRE.
create table if not exists public.entradas_avulsas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in
    ('aporte','emprestimo','reembolso','rendimento','venda_ativo','outra')),
  valor numeric(12,2) not null check (valor > 0),
  data date not null,
  conta_id uuid not null references public.contas_financeiras(id),
  descricao text not null,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_entradas_avulsas_conta on public.entradas_avulsas(conta_id);
create index if not exists idx_entradas_avulsas_data  on public.entradas_avulsas(data desc);

comment on table public.entradas_avulsas is
  'Dinheiro que entra sem ser venda de óleo (aporte, empréstimo, reembolso, rendimento, venda de ativo). Entra no CAIXA e fica FORA do DRE — não é resultado da operação.';

alter table public.entradas_avulsas enable row level security;
drop policy if exists entradas_avulsas_admin on public.entradas_avulsas;
create policy entradas_avulsas_admin on public.entradas_avulsas
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- 2) AJUSTES DE CAIXA — o inventário do dinheiro
-- ============================================================================
-- O estoque tem inventário (0016); o caixa não tinha nada. "Contei a gaveta
-- e tem R$ 50 a menos" agora tem onde morar, com motivo obrigatório —
-- igual ao ajuste de estoque. Valor POSITIVO = sobra; NEGATIVO = falta.
-- Fora do DRE: é conferência, não gasto.
create table if not exists public.ajustes_caixa (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas_financeiras(id),
  valor numeric(12,2) not null check (valor <> 0),
  data date not null,
  motivo text not null,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_ajustes_caixa_conta on public.ajustes_caixa(conta_id);

comment on table public.ajustes_caixa is
  'Conferência física do dinheiro: a diferença entre o que o sistema diz e o que a gaveta/extrato tem. Positivo = sobra, negativo = falta. Motivo obrigatório. Fora do DRE.';

alter table public.ajustes_caixa enable row level security;
drop policy if exists ajustes_caixa_admin on public.ajustes_caixa;
create policy ajustes_caixa_admin on public.ajustes_caixa
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- 3) DEVOLUÇÃO DO MOTORISTA — troco no meio do ciclo
-- ============================================================================
-- "Toma R$ 500 de volta, continuo rodando." Antes, a única entrada de
-- dinheiro vindo de motorista era o acerto — tudo-ou-nada, resetando o
-- corte do ciclo inteiro. A devolução é o meio-termo: diminui o saldo na
-- mão dele e entra na conta escolhida, sem mexer no corte.
create table if not exists public.devolucoes_motorista (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  valor numeric(10,2) not null check (valor > 0),
  data date not null,
  conta_id uuid not null references public.contas_financeiras(id),
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_devolucoes_motorista on public.devolucoes_motorista(motorista_id);

alter table public.devolucoes_motorista enable row level security;
drop policy if exists devolucoes_admin on public.devolucoes_motorista;
create policy devolucoes_admin on public.devolucoes_motorista
  for all using (public.is_admin()) with check (public.is_admin());
-- O motorista lê as PRÓPRIAS devoluções: o meu_saldo() roda como invoker e
-- precisa enxergá-las, senão o card do celular diverge do painel.
drop policy if exists devolucoes_motorista_ve on public.devolucoes_motorista;
create policy devolucoes_motorista_ve on public.devolucoes_motorista
  for select using (motorista_id = auth.uid());

-- ============================================================================
-- 4) GASTO DE CAMPO PAGO PELA SEDE — despesa ganha o que o combustível já tinha
-- ============================================================================
-- A 0018 resolveu "assinei a nota" pro combustível e esqueceu a despesa: a
-- borracharia que fia e o hotel faturado obrigavam o motorista a lançar
-- como se tivesse pago do bolso — e ele recebia a menos no acerto.
alter table public.despesas
  add column if not exists pago_na_hora boolean not null default true;
comment on column public.despesas.pago_na_hora is
  'false = assinou a nota / faturado: não sai do saldo do motorista e vira conta a pagar (trigger abaixo).';

-- E os DOIS ganham conta_id, pro caso "a sede pagou direto" (pix/cartão da
-- empresa, lançado pelo painel): o gasto sai da conta financeira escolhida
-- — antes ele entrava no DRE e não saía de lugar NENHUM (o vazamento mais
-- direto da varredura). Mesmo desenho da compra direta (0035).
alter table public.despesas
  add column if not exists conta_id uuid references public.contas_financeiras(id);
alter table public.abastecimentos
  add column if not exists conta_id uuid references public.contas_financeiras(id);

-- Trava de sanidade: conta financeira e motorista não coexistem (sairia do
-- saldo dele E da conta — o mesmo dinheiro duas vezes), e conta só faz
-- sentido em gasto pago na hora (nota assinada já vira conta a pagar).
alter table public.despesas drop constraint if exists despesa_conta_sem_motorista;
alter table public.despesas add constraint despesa_conta_sem_motorista
  check (conta_id is null or (motorista_id is null and pago_na_hora));
alter table public.abastecimentos drop constraint if exists abastecimento_conta_sem_motorista;
alter table public.abastecimentos add constraint abastecimento_conta_sem_motorista
  check (conta_id is null or (motorista_id is null and pago_na_hora));

-- Conta a pagar pode nascer de uma despesa.
alter table public.contas_a_pagar drop constraint if exists contas_a_pagar_origem_tipo_check;
alter table public.contas_a_pagar add constraint contas_a_pagar_origem_tipo_check
  check (origem_tipo in
    ('abastecimento','manutencao','compra_direta','documento','coleta','despesa'));

-- Trigger: despesa de nota assinada gera a conta sozinha, no banco —
-- espelho fiel do 0034 (cobre o sync do celular, o painel e script).
create or replace function public.criar_conta_da_despesa_assinada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.contas_a_pagar
    where origem_tipo = 'despesa' and origem_id = new.id
  ) then
    return new;
  end if;

  insert into public.contas_a_pagar (
    descricao, fornecedor, categoria, valor, vencimento, status,
    origem_tipo, origem_id, registrado_por
  ) values (
    'Despesa (nota assinada) — ' || left(new.descricao, 80),
    null,
    'custos_viagem',
    new.valor,
    (date_trunc('month', (new.criado_em at time zone 'America/Sao_Paulo')::date)
      + interval '1 month')::date,
    'a_pagar',
    'despesa',
    new.id,
    coalesce(new.motorista_id, new.lancado_por)
  );
  return new;
end;
$$;

drop trigger if exists trg_conta_despesa_assinada on public.despesas;
create trigger trg_conta_despesa_assinada
  after insert on public.despesas
  for each row
  when (new.pago_na_hora = false)
  execute function public.criar_conta_da_despesa_assinada();

-- ============================================================================
-- 5) ABATIMENTO — zerar o comprador sem mentir pro caixa
-- ============================================================================
-- "Pagou 49.700 nos 50.000 e tá quitado." Antes, ou a diferença virava
-- dívida eterna, ou um recebimento falso inflava a conta financeira e a
-- receita. O abatimento baixa o saldo do comprador SEM dinheiro entrar:
-- conta_id fica nulo (fora do saldo_contas, que filtra por conta) e o DRE
-- exclui a forma na receita (código).
alter table public.recebimentos drop constraint if exists recebimentos_forma_check;
alter table public.recebimentos add constraint recebimentos_forma_check
  check (forma in ('pix','dinheiro','transferencia','cheque','abatimento'));

-- ============================================================================
-- 6) saldos_motoristas() — despesa assinada não sai do bolso; devolução sai
-- ============================================================================
-- Duas mudanças em relação à 0021:
--   • despesas ganham `and d.pago_na_hora` (paridade com o combustível);
--   • devoluções depois do corte SUBTRAEM (o dinheiro voltou pra empresa).
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
          where c.motorista_id = b.motorista_id
            and c.criado_em > b.corte
            and not c.pago_pela_sede   -- escritório pagou: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(d.valor) from public.despesas d
          where d.motorista_id = b.motorista_id
            and d.criado_em > b.corte
            and d.pago_na_hora   -- assinou a nota: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(ab.valor) from public.abastecimentos ab
          where ab.motorista_id = b.motorista_id
            and ab.criado_em > b.corte
            and ab.pago_na_hora   -- assinou a nota: nao saiu da mao dele
        ), 0)
      - coalesce((
          select sum(dv.valor) from public.devolucoes_motorista dv
          where dv.motorista_id = b.motorista_id
            and dv.criado_em > b.corte   -- devolveu troco: saiu da mao dele
        ), 0)
    , 2) as saldo
  from base b;
$$;

-- meu_saldo() (0033) delega pra esta função — o card do celular acompanha
-- sozinho, sem segunda cópia da fórmula.

-- ============================================================================
-- 7) saldo_contas() — os braços novos
-- ============================================================================
-- Corpo da 0042 mais, nas ENTRADAS: entradas avulsas, devoluções de
-- motorista e a parte positiva dos ajustes; nas SAÍDAS: a parte negativa
-- dos ajustes, abastecimento e despesa pagos direto de conta.
-- Recebimento de forma 'abatimento' nunca tem conta_id, então já fica de
-- fora do braço de recebimentos sozinho.
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
      ), 0)
      -- Cheque só entra no caixa quando COMPENSA.
      + coalesce((
        select sum(ch.valor) from public.cheques ch
        where ch.conta_id = b.id and ch.status = 'compensado'
          and ch.compensado_em >= b.saldo_inicial_em
      ), 0)
      -- Aporte, empréstimo, reembolso, rendimento, venda de ativo.
      + coalesce((
        select sum(ea.valor) from public.entradas_avulsas ea
        where ea.conta_id = b.id and ea.data >= b.saldo_inicial_em
      ), 0)
      -- Troco devolvido pelo motorista no meio do ciclo.
      + coalesce((
        select sum(dv.valor) from public.devolucoes_motorista dv
        where dv.conta_id = b.id and dv.data >= b.saldo_inicial_em
      ), 0)
      -- Sobra na conferência da gaveta.
      + coalesce((
        select sum(aj.valor) from public.ajustes_caixa aj
        where aj.conta_id = b.id and aj.valor > 0
          and aj.data >= b.saldo_inicial_em
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
          and (ad.data_envio at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(t.valor) from public.transferencias t
        where t.conta_origem_id = b.id and t.data >= b.saldo_inicial_em
      ), 0)
      -- Compra direta à vista: o dinheiro saiu da conta no dia da compra.
      + coalesce((
        select sum(cd.valor) from public.compras_diretas cd
        where cd.conta_id = b.id and cd.data >= b.saldo_inicial_em
      ), 0)
      -- Abastecimento e despesa pagos DIRETO pela sede (pix/cartão da
      -- empresa, lançados no painel): saem da conta escolhida. Comparação
      -- pelo dia BR, mesma lição da 0042.
      + coalesce((
        select sum(ab.valor) from public.abastecimentos ab
        where ab.conta_id = b.id
          and (ab.criado_em at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0)
      + coalesce((
        select sum(d.valor) from public.despesas d
        where d.conta_id = b.id
          and (d.criado_em at time zone 'America/Sao_Paulo')::date >= b.saldo_inicial_em
      ), 0)
      -- Falta na conferência da gaveta.
      + coalesce((
        select sum(-aj.valor) from public.ajustes_caixa aj
        where aj.conta_id = b.id and aj.valor < 0
          and aj.data >= b.saldo_inicial_em
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
