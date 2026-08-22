-- ============================================================================
-- 0054 — Fecha buracos da varredura adversarial de 21/08/2026
-- (ver VARREDURA-21-08.md e REGUA-DO-DINHEIRO.md)
--
-- 1. `acertos.client_id` — idempotência. Dois POSTs simultâneos liam o mesmo
--    saldo antes de qualquer insert (TOCTOU) e os dois passavam: clique
--    duplo num acerto com R$ 2.000 devolvidos gravava DOIS acertos e a
--    conta recebia R$ 4.000. Mesma solução de cheques (0041) e vendas.
--
-- 2. `estoque_atual()` ganha `custo_confiavel` — venda a descoberto deixa o
--    valor do estoque negativo; quando entra óleo novo o custo médio sai
--    errado e o alerta de saldo negativo some junto, escondendo a
--    distorção. A própria 0016 previu ("o custo por kg vira ficção sem
--    nenhum sinal na tela") e delegou ao inventário — faltava o SINAL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Idempotência do acerto
-- ---------------------------------------------------------------------------
alter table public.acertos
  add column if not exists client_id uuid;

create unique index if not exists acertos_client_id_key
  on public.acertos(client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- 2. estoque_atual() com sinal de custo não confiável
-- ---------------------------------------------------------------------------
-- Muda a assinatura (coluna nova no retorno) — precisa derrubar antes.
drop function if exists public.estoque_atual();

create or replace function public.estoque_atual()
returns table (
  tipo_oleo       text,
  saldo_kg        numeric,
  custo_medio_kg  numeric,
  valor_total     numeric,
  -- false = em algum momento saiu mais óleo do que existia e o valor do
  -- estoque ficou negativo. O custo médio daqui pra frente é ficção até
  -- alguém lançar um INVENTÁRIO, que faz o rebase de quantidade E valor.
  custo_confiavel boolean
)
language plpgsql
stable
set search_path = public
as $$
declare
  t         text;
  m         record;
  v_saldo   numeric;
  v_valor   numeric;
  v_cm      numeric;   -- último custo médio VÁLIDO (sobrevive a saldo <= 0)
  v_furou   boolean;   -- já houve valor negativo desde o último inventário?
begin
  foreach t in array array['fino', 'grosso'] loop
    v_saldo := 0;
    v_valor := 0;
    v_cm    := 0;
    v_furou := false;

    for m in
      select mv.especie, mv.kg, mv.custo
      from public.movimentos_estoque mv
      where mv.tipo_oleo = t
      order by mv.dia, mv.prioridade, mv.momento
    loop
      if m.especie = 'entrada' then
        v_saldo := v_saldo + m.kg;
        v_valor := v_valor + m.custo;
        if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;

      elsif m.especie = 'saida' then
        -- Sai pelo custo médio vigente. Se o saldo já estava zerado ou
        -- negativo, usa o último válido — não inventa número novo.
        if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;
        v_saldo := v_saldo - m.kg;
        v_valor := v_valor - (m.kg * v_cm);
        -- A marca fica: mesmo que o saldo volte a positivo com a próxima
        -- descarga, o custo médio já carrega a distorção.
        if v_saldo < 0 or v_valor < 0 then v_furou := true; end if;

      else -- 'ajuste' — rebase de quantidade E de valor: limpa a marca
        v_cm    := m.custo;
        v_saldo := m.kg;
        v_valor := m.kg * m.custo;
        v_furou := false;
      end if;
    end loop;

    if v_saldo > 0 then v_cm := v_valor / v_saldo; end if;

    tipo_oleo       := t;
    saldo_kg        := round(v_saldo, 2);
    custo_medio_kg  := round(coalesce(v_cm, 0), 4);
    valor_total     := round(v_valor, 2);
    custo_confiavel := not v_furou;
    return next;
  end loop;
end;
$$;
