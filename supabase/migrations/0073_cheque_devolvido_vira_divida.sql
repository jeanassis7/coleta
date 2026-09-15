-- ============================================================================
-- 0073 — CHEQUE QUE VOLTA VIRA DÍVIDA (quando não dá pra saber o que reverter)
-- ============================================================================
-- ⚠️ ESTA MIGRATION MUDA UMA REGRA DE NEGÓCIO. A R68 do NEGOCIOv3.md dizia
-- "cheque devolvido: TUDO volta", incluindo "a conta a pagar que ele quitou
-- volta a ser a pagar". Passa a ter exceção, decidida pelo Evaner em 15/09:
--
--   • pagamento pontual (um cheque quitou uma conta específica)
--       → a conta volta a ser devida. R68 preservada.
--   • fornecedor com SALDO (o posto, onde várias notinhas viram um acerto)
--       → as notinhas continuam pagas e nasce uma DÍVIDA NOVA do valor do
--         cheque. Nas palavras dele: "as notinhas não voltam, mas o saldo
--         volta — é uma conta que de fato é um saldo a ser pago".
--
-- POR QUE ISSO É MELHOR, E NÃO SÓ MAIS FÁCIL:
--   1. O VALOR BATE SEMPRE. A dívida vale exatamente o papel que voltou, sem
--      depender de saber qual fatia de qual nota aquele cheque cobriu — que
--      é uma pergunta sem resposta hoje (as 17 notas do acerto do Texas
--      apontam todas pro primeiro cheque; o segundo tem zero).
--   2. A DATA FICA CERTA. Reabrir a nota de agosto a traz de volta já
--      vencida. A dívida nova nasce no dia em que o cheque voltou.
--   3. O TROCO FICA CERTO. Se o acerto teve troco, a dívida pelo valor cheio
--      do papel já embute isso; reverter a nota deixaria o troco solto.
--
-- ⚠️ A ASSIMETRIA, QUE PRECISA ESTAR ESCRITA: a R67-b diz que repassar cheque
-- também é RECEITA, e que "se o cheque voltar, os dois lados se desfazem
-- sozinhos". Com a regra nova só UM lado se desfaz — a receita sai sozinha
-- (o braço lê status='repassado'), a despesa fica. Entre o cheque voltar e o
-- comprador pagar, o resultado do mês fica mais baixo nesse valor. No
-- acumulado a despesa conta uma vez e a receita conta uma vez, então o desvio
-- é só ENTRE MESES. Aprovado pelo Evaner: "bem barato, super tranquilo".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) O CARIMBO DO ACERTO — `pagamento_id`
-- ---------------------------------------------------------------------------
-- Um uuid, não uma tabela e não uma FK: ele só AGRUPA o que nasceu do mesmo
-- pagamento. Todas as contas quitadas e todos os cheques usados num acerto
-- levam o mesmo carimbo.
--
-- É o que responde "esse cheque foi sozinho ou num maço?" — a pergunta que a
-- regra acima precisa fazer. Nasce AQUI, e não no item 4 do plano, porque o
-- item 3 não pode depender de código que ainda não existe: o fechamento do
-- posto (que já produz maços hoje) passa a carimbar imediatamente.
alter table public.contas_a_pagar add column if not exists pagamento_id uuid;
alter table public.cheques        add column if not exists pagamento_id uuid;

create index if not exists idx_contas_pagamento on public.contas_a_pagar(pagamento_id);
create index if not exists idx_cheques_pagamento on public.cheques(pagamento_id);

comment on column public.contas_a_pagar.pagamento_id is
  'Carimbo do acerto: tudo que foi pago junto compartilha o mesmo uuid. Não é FK — é agrupamento. Nulo nos pagamentos anteriores a 15/09/2026.';

-- ---------------------------------------------------------------------------
-- 2) PRA QUEM O CHEQUE FOI, DE VERDADE
-- ---------------------------------------------------------------------------
-- `repassado_para` é texto livre, e a produção prova o problema: existem
-- "Texas", "TEXAS RODOVIA", "CENTRO OESTE" e "CENTRO OESTE ABASTECIMENTO"
-- como se fossem quatro destinos, pra dois postos cadastrados. Dívida tem que
-- ir pro posto certo, não pro nome certo.
--
-- SEM BACKFILL, de propósito: casar nome por semelhança acertaria a maioria e
-- erraria calado em alguma — e dívida no posto errado é pior que dívida sem
-- posto. Cheque antigo que voltar gera a dívida com o NOME (e aparece em
-- Contas a pagar); do fechamento novo em diante o id vai junto e o saldo do
-- posto acende sozinho.
alter table public.cheques
  add column if not exists repassado_local_id uuid references public.locais(id);

alter table public.contas_a_pagar
  add column if not exists local_id uuid references public.locais(id);

create index if not exists idx_contas_local on public.contas_a_pagar(local_id);

-- ---------------------------------------------------------------------------
-- 3) O CHECK DE `origem_tipo` PRECISA ACEITAR O TIPO NOVO
-- ---------------------------------------------------------------------------
-- ⚠️ Sem isto o insert da dívida falharia — e falharia no pior momento
-- possível: exatamente quando um cheque volta do banco, que é quando o
-- sistema mais precisa funcionar.
alter table public.contas_a_pagar drop constraint if exists contas_a_pagar_origem_tipo_check;
alter table public.contas_a_pagar add constraint contas_a_pagar_origem_tipo_check
  check (origem_tipo in (
    'abastecimento', 'manutencao', 'compra_direta', 'documento',
    'coleta', 'despesa', 'cheque_devolvido'
  ));

-- A origem é o CHEQUE, e um cheque só devolve uma vez: índice único =
-- devolver duas vezes não cria duas dívidas.
create unique index if not exists idx_contas_cheque_devolvido_unica
  on public.contas_a_pagar(origem_id)
  where origem_tipo = 'cheque_devolvido';

-- ---------------------------------------------------------------------------
-- 4) saldo_postos() PASSA A ENXERGAR A DÍVIDA DO CHEQUE
-- ---------------------------------------------------------------------------
-- Ela só somava dívida vinda de abastecimento ou despesa com `local_id`. Sem
-- este braço a dívida nasceria e NÃO apareceria na tela do posto — ou seja, o
-- "o saldo volta" não aconteceria de verdade, que é o ponto inteiro da regra.
--
-- O terceiro braço exclui as duas origens dos outros braços pra que uma conta
-- que um dia tenha as duas coisas não seja contada duas vezes.
create or replace function public.saldo_postos()
returns table (
  local_id      uuid,
  nome          text,
  notas_abertas bigint,
  saldo         numeric
)
language sql
stable
set search_path = public
as $$
  with notas as (
    select ab.local_id, cp.id, cp.valor
    from public.abastecimentos ab
    join public.contas_a_pagar cp
      on cp.origem_tipo = 'abastecimento' and cp.origem_id = ab.id
    where cp.status = 'a_pagar' and ab.local_id is not null

    union all

    select d.local_id, cp.id, cp.valor
    from public.despesas d
    join public.contas_a_pagar cp
      on cp.origem_tipo = 'despesa' and cp.origem_id = d.id
    where cp.status = 'a_pagar' and d.local_id is not null

    union all

    -- Dívida apontada direto pro posto (hoje: cheque devolvido que tinha
    -- pago um acerto dele).
    select cp.local_id, cp.id, cp.valor
    from public.contas_a_pagar cp
    where cp.status = 'a_pagar'
      and cp.local_id is not null
      and (cp.origem_tipo is null
           or cp.origem_tipo not in ('abastecimento', 'despesa'))
  )
  select
    l.id,
    l.nome_canonico,
    count(n.id),
    round(coalesce(sum(n.valor), 0), 2)
  from public.locais l
  left join notas n on n.local_id = l.id
  where l.tipo = 'posto'
  group by l.id, l.nome_canonico;
$$;

revoke all on function public.saldo_postos() from public;
grant execute on function public.saldo_postos() to authenticated;
