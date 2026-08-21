-- ============================================================================
-- 0051 — FOTO SEMANAL DO CAIXA (decisão do Evaner, 21/08/2026)
--
-- Toda segunda-feira às 06:00 de Brasília o BANCO fotografa o giro da
-- empresa (as mesmas linhas do card Patrimônio) e guarda numa tabela.
-- É a versão automática da aba "ACOMPANHAMENTO DE CAIXA" da planilha antiga.
--
-- Três decisões que moram aqui:
--  1. FOTO, não recálculo: a linha gravada NUNCA muda. Corrigir o passado
--     não reescreve a foto — se um dia o recálculo divergir da foto, isso
--     DENUNCIA que mexeram no passado. É a testemunha do sistema fechado.
--  2. O relógio é o pg_cron DO BANCO: não depende de Vercel, navegador nem
--     de alguém lembrar. Primeira foto: segunda 31/08/2026 (pedido dele —
--     depois da regularização dos motoristas).
--  3. Preço de referência do óleo FIXO em R$ 2,80 no código (decisão do
--     Evaner: "se eu quiser mudar eu mudo pelo código, menos burlável").
--     Mudar = editar a constante AQUI e em src/lib/admin/caixa.ts
--     (PRECO_REFERENCIA_LITRO), nos DOIS lugares.
-- ============================================================================

create table public.fotos_caixa (
  data date not null,
  -- 'conta:<uuid>' | 'maos_motoristas' | 'a_caminho' | 'estoque'
  -- | 'oleo_caminhoes' | 'cheques_aberto' | 'a_receber' | 'contas_a_pagar'
  -- | 'total'
  chave text not null,
  label text not null,
  -- ordena as linhas da tabela na tela (contas primeiro, total no fim)
  ordem integer not null,
  valor numeric(14, 2) not null,
  -- litros/kg/preço do dia — o que explica o valor sem precisar recalcular
  detalhe jsonb,
  criado_em timestamptz not null default now(),
  primary key (data, chave)
);

alter table public.fotos_caixa enable row level security;

create policy "admin le fotos_caixa"
  on public.fotos_caixa for select
  using (public.is_admin());
-- Escrita: só a função abaixo (definer) e o cron (postgres). Nenhuma tela
-- escreve foto — foto tirada na mão deixaria de ser testemunha.

-- ----------------------------------------------------------------------------
-- A função que fotografa — a MESMA matemática do card Patrimônio
-- (saldo_contas, saldos_motoristas, estoque_atual, saldo_compradores).
-- ----------------------------------------------------------------------------
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

  -- 1. cada conta financeira (o saldo_contas já limita às ativas)
  for r in select s.conta_id, s.nome, s.saldo from public.saldo_contas() s loop
    insert into public.fotos_caixa (data, chave, label, ordem, valor)
    values (p_data, 'conta:' || r.conta_id, r.nome, 10, round(r.saldo, 2));
    v_total := v_total + r.saldo;
  end loop;

  -- 2. dinheiro na mão dos motoristas (líquido)
  select coalesce(sum(sm.saldo), 0) into v from public.saldos_motoristas() sm;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'maos_motoristas', 'Em mãos de motoristas', 20, round(v, 2));
  v_total := v_total + v;

  -- 3. adiantamento enviado e não aceito — saiu da conta, não chegou na mão
  select coalesce(sum(a.valor), 0) into v
    from public.adiantamentos a where a.status = 'pendente';
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'a_caminho', 'A caminho (adiantamento não aceito)', 25, round(v, 2));
  v_total := v_total + v;

  -- 4. estoque valorado pelo preço de referência
  select coalesce(sum(e.saldo_kg), 0) into v from public.estoque_atual() e;
  v_litros := v / 0.9;
  insert into public.fotos_caixa (data, chave, label, ordem, valor, detalhe)
  values (p_data, 'estoque', 'Valor em estoque', 30, round(v_litros * v_preco, 2),
          jsonb_build_object('kg', round(v, 1), 'litros', round(v_litros, 0), 'preco_litro', v_preco));
  v_total := v_total + v_litros * v_preco;

  -- 5. óleo nos caminhões (coletado em carga ativa, ainda não pesado)
  select coalesce(sum(c.litros), 0) into v_litros
    from public.coletas c
    join public.cargas g on g.id = c.carga_id and g.status = 'ativa';
  insert into public.fotos_caixa (data, chave, label, ordem, valor, detalhe)
  values (p_data, 'oleo_caminhoes', 'Óleo nos caminhões', 40, round(v_litros * v_preco, 2),
          jsonb_build_object('litros', round(v_litros, 0), 'preco_litro', v_preco));
  v_total := v_total + v_litros * v_preco;

  -- 6. cheques em aberto (carteira + depositados; devolvido fica fora)
  select coalesce(sum(ch.valor), 0) into v
    from public.cheques ch where ch.status in ('em_carteira', 'depositado');
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'cheques_aberto', 'Cheques em aberto', 50, round(v, 2));
  v_total := v_total + v;

  -- 7. a receber dos compradores (venda entregue, sem dinheiro e sem cheque;
  --    só saldo POSITIVO — crédito de comprador não é ativo)
  select coalesce(sum(sc.saldo), 0) into v
    from public.saldo_compradores() sc where sc.saldo > 0;
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'a_receber', 'A receber dos compradores', 60, round(v, 2));
  v_total := v_total + v;

  -- 8. (−) contas a pagar em aberto — o giro honesto desconta o que já é
  --    dívida certa (prevista fica fora: é palpite)
  select coalesce(sum(cp.valor), 0) into v
    from public.contas_a_pagar cp where cp.status = 'a_pagar';
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'contas_a_pagar', '(−) Contas a pagar em aberto', 70, round(-v, 2));
  v_total := v_total - v;

  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'total', 'TOTAL', 99, round(v_total, 2));
end;
$$;

-- ----------------------------------------------------------------------------
-- O despertador: toda segunda 09:00 UTC = 06:00 em Brasília.
-- O WHERE segura o gatilho até a primeira foto combinada (31/08/2026).
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule('foto_caixa_semanal')
 where exists (select 1 from cron.job where jobname = 'foto_caixa_semanal');

select cron.schedule(
  'foto_caixa_semanal',
  '0 9 * * 1',
  $job$select public.tirar_foto_caixa() where (now() at time zone 'America/Sao_Paulo')::date >= date '2026-08-31'$job$
);
