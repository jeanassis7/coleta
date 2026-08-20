-- ============================================================================
-- 0034 — "ASSINEI A NOTA" gera a conta a pagar SOZINHO, no banco
-- ============================================================================
-- O fluxo do painel criava a conta junto do abastecimento; o fluxo do
-- CELULAR (sync do motorista) inseria direto na tabela e nenhuma conta
-- nascia: a dívida com o posto não existia em lugar nenhum e o gasto nunca
-- entrava no DRE (que descarta abastecimento não-pago-na-hora contando que
-- a conta exista).
--
-- Trigger no banco em vez de código no app, de propósito: cobre QUALQUER
-- caminho de inserção — sync do celular, painel, script. Não tem como
-- esquecer.
--
-- SECURITY DEFINER porque quem dispara o insert é o MOTORISTA, e a RLS de
-- contas_a_pagar é admin-only — sem definer, o insert da conta seria negado
-- e derrubaria o abastecimento junto.

create or replace function public.criar_conta_da_nota_assinada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotente: se a conta dessa origem já existe (retry do sync, painel
  -- que criou por fora), não duplica.
  if exists (
    select 1 from public.contas_a_pagar
    where origem_tipo = 'abastecimento' and origem_id = new.id
  ) then
    return new;
  end if;

  insert into public.contas_a_pagar (
    descricao, fornecedor, categoria, valor, vencimento, status,
    origem_tipo, origem_id, registrado_por
  ) values (
    'Diesel (nota assinada) — ' || new.posto_nome,
    new.posto_nome,
    'combustivel',
    new.valor,
    -- Sem vencimento combinado, dia 1 do mês seguinte — mesma convenção da
    -- coleta paga pela sede ("pago início do mês que vem"). O admin ajusta
    -- na tela se for diferente.
    (date_trunc('month', (new.criado_em at time zone 'America/Sao_Paulo')::date)
      + interval '1 month')::date,
    'a_pagar',
    'abastecimento',
    new.id,
    -- Do celular vem motorista_id; do painel (veículo avulso) o motorista é
    -- nulo e quem assina o registro é o admin que lançou.
    coalesce(new.motorista_id, new.lancado_por)
  );
  return new;
end;
$$;

drop trigger if exists trg_conta_nota_assinada on public.abastecimentos;
create trigger trg_conta_nota_assinada
  after insert on public.abastecimentos
  for each row
  when (new.pago_na_hora = false)
  execute function public.criar_conta_da_nota_assinada();
