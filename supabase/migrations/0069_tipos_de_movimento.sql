-- ============================================================================
-- 0069 — O FILTRO DE TIPO SE DESCOBRE SOZINHO
-- ============================================================================
-- O dropdown "tipo de movimento" da tela de Lançamentos não pode ser uma
-- lista escrita no código: fonte nova de dinheiro entraria em `movimentos_caixa`
-- (0068) e ficaria invisível no filtro até alguém lembrar de acrescentar — que
-- é exatamente o bug que a 0068 consertou, voltando pela porta dos fundos.
--
-- Aqui a lista vem do DADO. Tipo novo aparece no filtro no dia em que produzir
-- a primeira linha. Mesma lição da `atores_do_log()` (0055): DISTINCT tem que
-- ser feito no banco — o select cru trunca em 1.000 sem avisar.

create or replace function public.tipos_de_movimento()
returns table (tipo text, linhas bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.tipo, count(*)
  from public.movimentos_caixa m
  group by m.tipo
  order by m.tipo;
$$;

revoke all on function public.tipos_de_movimento() from public;
grant execute on function public.tipos_de_movimento() to authenticated;
