-- ============================================================================
-- 0053 — DÍVIDAS CADASTRADAS (decisões do Evaner, 21/08/2026)
--
-- O que a empresa DEVE hoje, cadastrado. Aparece no Caixa como linha abaixo
-- do TOTAL do patrimônio (que é só o lado positivo) e não desconta dele.
--
-- DOIS FORMATOS, porque a vida tem dois:
--  - PARCELADA: acordo fechado. "Evaner, 8× R$ 12.000". O sistema mostra
--    quantas já foram pagas e quanto falta.
--  - ABERTA: valor devido sem cronograma. "40.000 com juro combinado de
--    boca, parado, uma hora vira 40×1.000". Sem parcelas até a negociação
--    fechar — o campo `observacao` guarda a situação em palavras.
--
-- JURO NÃO É CALCULADO (decisão do Evaner): juro "parado" sem negociação é
-- conversa, não número. Quando fechar, o valor é atualizado na mão e o log
-- (0022) registra quem mudou, quando e de quanto pra quanto.
--
-- O SALDO NÃO SE GUARDA, SE CALCULA: saldo = valor_total − pagamentos
-- vinculados JÁ PAGOS. Apagar um pagamento devolve a dívida sozinho, sem
-- trigger e sem número desencontrado. Mesma escolha da saldo_compradores().
-- ============================================================================

create table public.dividas (
  id uuid primary key default gen_random_uuid(),
  credor text not null,
  tipo text not null check (tipo in ('parcelada', 'aberta')),
  valor_total numeric(12,2) not null check (valor_total > 0),

  -- Só na parcelada. A parcelada é o acordo fechado; a aberta não tem.
  parcelas_total integer check (parcelas_total > 0),
  valor_parcela numeric(12,2) check (valor_parcela > 0),
  primeira_em date,

  -- A situação em palavras: juro combinado, estado da negociação, promessa.
  observacao text,

  -- Manual: some da linha do patrimônio e vira histórico consultável.
  -- (Dívida com saldo zerado também sai da linha sozinha — o saldo manda.)
  status text not null default 'aberta' check (status in ('aberta', 'quitada')),
  quitada_em date,

  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),

  constraint parcelada_tem_parcelas check (
    tipo <> 'parcelada' or (parcelas_total is not null and valor_parcela is not null)
  ),
  constraint quitada_tem_data check (status <> 'quitada' or quitada_em is not null)
);

create index idx_dividas_status on public.dividas(status, credor);

alter table public.dividas enable row level security;
create policy "admin acesso total dividas"
  on public.dividas for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- O vínculo: o pagamento diz QUAL dívida ele abateu
-- ---------------------------------------------------------------------------
-- on delete set null: apagar a dívida NÃO apaga o pagamento — aquele dinheiro
-- saiu de verdade e continua no DRE. Ele só deixa de abater alguém.
alter table public.contas_a_pagar
  add column if not exists divida_id uuid references public.dividas(id) on delete set null;

create index if not exists idx_contas_divida on public.contas_a_pagar(divida_id)
  where divida_id is not null;

-- ---------------------------------------------------------------------------
-- saldo_dividas() — a conta inteira dentro do Postgres, uma ida só
-- ---------------------------------------------------------------------------
create or replace function public.saldo_dividas()
returns table (
  id             uuid,
  credor         text,
  tipo           text,
  valor_total    numeric,
  pago           numeric,
  saldo          numeric,
  parcelas_total integer,
  valor_parcela  numeric,
  parcelas_pagas integer,
  status         text,
  quitada_em     date,
  primeira_em    date,
  observacao     text,
  criado_em      timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    d.id,
    d.credor,
    d.tipo,
    d.valor_total,
    coalesce(p.pago, 0) as pago,
    d.valor_total - coalesce(p.pago, 0) as saldo,
    d.parcelas_total,
    d.valor_parcela,
    -- Quantas parcelas o dinheiro pago já cobre. Pagamento quebrado (metade
    -- de uma parcela) conta como parcela ainda NÃO fechada — floor.
    case
      when d.tipo = 'parcelada' and d.valor_parcela > 0
        then floor(coalesce(p.pago, 0) / d.valor_parcela)::integer
      else null
    end as parcelas_pagas,
    d.status,
    d.quitada_em,
    d.primeira_em,
    d.observacao,
    d.criado_em
  from public.dividas d
  left join (
    select cp.divida_id, sum(cp.valor) as pago
      from public.contas_a_pagar cp
     where cp.divida_id is not null
       and cp.status = 'paga'      -- regime de caixa: abate quando SAI
     group by cp.divida_id
  ) p on p.divida_id = d.id
  order by
    case when d.status = 'aberta' then 0 else 1 end,
    d.valor_total desc;
$$;

-- ---------------------------------------------------------------------------
-- A foto semanal ganha a linha das dívidas (ordem 96, abaixo do total)
-- ---------------------------------------------------------------------------
create or replace function public.tirar_foto_caixa(
  p_data date default (now() at time zone 'America/Sao_Paulo')::date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- FIXO por decisão do Evaner (21/08/2026). Mudar aqui E em
  -- src/lib/admin/caixa.ts (PRECO_REFERENCIA_LITRO).
  v_preco constant numeric := 2.80;
  v_total numeric := 0;
  r record;
  v numeric;
  v_litros numeric;
begin
  -- Foto é IMUTÁVEL: se o dia já tem foto, não sobrescreve nem duplica.
  if exists (select 1 from public.fotos_caixa where data = p_data) then
    return;
  end if;

  for r in select s.conta_id, s.nome, s.saldo from public.saldo_contas() s loop
    insert into public.fotos_caixa (data, chave, label, ordem, valor)
    values (p_data, 'conta:' || r.conta_id, r.nome, 10, round(r.saldo, 2));
    v_total := v_total + r.saldo;
  end loop;

  select coalesce(sum(sm.saldo), 0) into v from public.saldos_motoristas() sm;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'maos_motoristas', 'Em mãos de motoristas', 20, round(v, 2));
  v_total := v_total + v;

  select coalesce(sum(a.valor), 0) into v
    from public.adiantamentos a where a.status = 'pendente';
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'a_caminho', 'A caminho (adiantamento não aceito)', 25, round(v, 2));
  v_total := v_total + v;

  select coalesce(sum(e.saldo_kg), 0) into v from public.estoque_atual() e;
  v_litros := v / 0.9;
  insert into public.fotos_caixa (data, chave, label, ordem, valor, detalhe)
  values (p_data, 'estoque', 'Valor em estoque', 30, round(v_litros * v_preco, 2),
          jsonb_build_object('kg', round(v, 1), 'litros', round(v_litros, 0), 'preco_litro', v_preco));
  v_total := v_total + v_litros * v_preco;

  select coalesce(sum(c.litros), 0) into v_litros
    from public.coletas c
    join public.cargas g on g.id = c.carga_id and g.status = 'ativa';
  insert into public.fotos_caixa (data, chave, label, ordem, valor, detalhe)
  values (p_data, 'oleo_caminhoes', 'Óleo nos caminhões', 40, round(v_litros * v_preco, 2),
          jsonb_build_object('litros', round(v_litros, 0), 'preco_litro', v_preco));
  v_total := v_total + v_litros * v_preco;

  select coalesce(sum(ch.valor), 0) into v
    from public.cheques ch where ch.status in ('em_carteira', 'depositado');
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'cheques_aberto', 'Cheques em aberto', 50, round(v, 2));
  v_total := v_total + v;

  select coalesce(sum(sc.saldo), 0) into v
    from public.saldo_compradores() sc where sc.saldo > 0;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'a_receber', 'A receber dos compradores', 60, round(v, 2));
  v_total := v_total + v;

  -- TOTAL: só o lado positivo do giro (o que a empresa TEM)
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'total', 'TOTAL', 90, round(v_total, 2));

  -- Abaixo do total, informação própria, NÃO desconta.
  -- Conta amarrada a uma dívida fica FORA daqui: ela já está dentro da linha
  -- de dívidas, e contar nas duas seria a mesma dívida em dobro.
  select coalesce(sum(cp.valor), 0) into v
    from public.contas_a_pagar cp
   where cp.status = 'a_pagar' and cp.divida_id is null;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'contas_a_pagar', 'Contas a pagar em aberto', 95, round(v, 2));

  select coalesce(sum(sd.saldo), 0) into v
    from public.saldo_dividas() sd where sd.status = 'aberta' and sd.saldo > 0;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'dividas_cadastradas', 'Dívidas cadastradas', 96, round(v, 2));
end;
$$;
