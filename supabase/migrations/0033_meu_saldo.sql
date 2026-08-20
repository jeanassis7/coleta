-- ============================================================================
-- 0033 — meu_saldo(): o card "Seu dinheiro" usa a MESMA fórmula do painel
-- ============================================================================
-- O card do motorista recalculava o saldo por conta própria no celular e
-- esqueceu as duas exceções da fórmula (coleta paga pela sede e abastecimento
-- de nota assinada): o painel mostrava um número, o celular mostrava outro —
-- e motorista que desconfia do número para de usar o aceite.
--
-- A correção definitiva não é copiar os filtros pro card (segunda cópia da
-- fórmula = diverge de novo um dia): é o card chamar a fórmula oficial.
--
-- A função roda com os direitos DE QUEM CHAMA (security invoker, o padrão):
-- a RLS continua valendo, e como todas as tabelas envolvidas só deixam o
-- motorista ler as PRÓPRIAS linhas, o resultado é o saldo dele e de mais
-- ninguém. O filtro por auth.uid() é cinto e suspensório.

create or replace function public.meu_saldo()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select s.saldo from public.saldos_motoristas() s where s.motorista_id = auth.uid()),
    0
  );
$$;

revoke all on function public.meu_saldo() from public;
grant execute on function public.meu_saldo() to authenticated;
