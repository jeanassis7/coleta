-- ============================================================================
-- 0052 — Foto do caixa: TOTAL é o número POSITIVO (decisão do Evaner, 21/08)
--
-- O patrimônio soma só o que a empresa TEM (contas, mãos, óleo, papel, a
-- receber). O que ela DEVE (contas a pagar em aberto; futuramente as
-- dívidas cadastradas) aparece como linha própria ABAIXO do total, sem
-- descontar dele. Reordena: total=90, contas_a_pagar=95 (abaixo do total).
--
-- Substitui a função da 0051 ANTES da primeira foto (31/08) — nenhuma foto
-- existente muda, porque nenhuma existe.
-- ============================================================================

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

  -- TOTAL: só o lado positivo do giro (o que a empresa TEM)
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'total', 'TOTAL', 90, round(v_total, 2));

  -- 8. contas a pagar em aberto — ABAIXO do total, informação própria,
  --    NÃO desconta (dívida certa; prevista fica fora, é palpite)
  select coalesce(sum(cp.valor), 0) into v
    from public.contas_a_pagar cp where cp.status = 'a_pagar';
  insert into public.fotos_caixa (data, chave, label, ordem, valor)
  values (p_data, 'contas_a_pagar', 'Contas a pagar em aberto', 95, round(v, 2));
end;
$$;
