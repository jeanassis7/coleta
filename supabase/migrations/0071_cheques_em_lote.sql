-- ============================================================================
-- 0071 — CHEQUE SE DEPOSITA E SE COMPENSA EM MAÇO, NÃO UM POR UM
-- ============================================================================
-- Em 15/09/2026 o Evaner depositou 10 cheques (R$ 36.841,69) clicando um a
-- um, com "bom para" de 17/jun a 22/jul, de emitentes diferentes. É assim que
-- o depósito acontece na vida real: o maço se forma por DATA, não por
-- comprador. E tinha outro maço pronto — 37 cheques em carteira, 18 já
-- vencidos.
--
-- ---------------------------------------------------------------------------
-- POR QUE RPC, E NÃO UM LAÇO NO ENDPOINT
-- ---------------------------------------------------------------------------
-- Via PostgREST não existe transação de vários comandos. Um laço no endpoint
-- pode parar no meio: 8 cheques depositados, 2 na carteira, e ninguém sabendo
-- — o pior estado possível, porque não dá erro e não dá pra reproduzir.
--
-- Aqui o UPDATE é UM só, dentro da transação implícita da função. Se o número
-- de linhas mexidas não bater com o número de ids, a função LEVANTA EXCEÇÃO e
-- o Postgres desfaz tudo. Ou o maço inteiro entra, ou nada entra.
--
-- ---------------------------------------------------------------------------
-- ⚠️ MUDANÇA DE SEMÂNTICA: `cheques.conta_id` PASSA A SER GRAVADO NO DEPÓSITO
-- ---------------------------------------------------------------------------
-- A 0028 dizia "conta_id só na compensação". Agora ele é gravado já no
-- depósito, porque o Evaner SABE em qual conta depositou — e assim a
-- compensação não pede a mesma informação duas vezes.
--
-- ISSO NÃO MOVE UM CENTAVO. Conferido antes de escrever: `cheques.conta_id` é
-- lido em UM lugar no sistema inteiro — a view `movimentos_caixa` (0068) — e
-- lá o filtro é `status = 'compensado'`. O `saldo_contas()` é a soma dessa
-- view, então também não enxerga. O dinheiro continua entrando no caixa só
-- quando o cheque compensa, que é a regra R70 e não muda.
--
-- Se um dia alguém acrescentar um braço que leia `cheques.conta_id` SEM
-- filtrar o status, o depositado passa a contar como dinheiro em conta. É o
-- único jeito de isto virar bug — e está escrito aqui pra que não vire.
--
-- ---------------------------------------------------------------------------
-- SEGURANÇA: security INVOKER, de propósito
-- ---------------------------------------------------------------------------
-- Estas funções ESCREVEM. `security definer` + `grant to authenticated`
-- deixaria um MOTORISTA depositar cheque, porque motorista também é
-- `authenticated`. Como invoker, a RLS de `cheques` (admin acesso total) vale:
-- motorista mexe 0 linhas e a função levanta exceção. O service_role dos
-- endpoints ignora RLS normalmente, e o gate de verdade continua sendo o
-- `exigirAdmin()` do endpoint.
--
-- Não dá pra usar `is_admin()` como guarda aqui dentro: com service_role o
-- `auth.uid()` é nulo e `is_admin()` devolve false — a guarda barraria
-- justamente quem deve passar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) DEPOSITAR UM MAÇO
-- ---------------------------------------------------------------------------
-- Só sai de 'em_carteira'. Reapresentar cheque devolvido continua sendo ação
-- INDIVIDUAL (a transição antiga cobre): reapresentar é decisão pensada, um
-- papel de cada vez, e não pode acontecer por tabela marcada sem querer.
create or replace function public.depositar_cheques(
  ids     uuid[],
  conta   uuid,
  quando  date
)
returns integer
language plpgsql
set search_path = public
as $funcao$
declare
  pedidos integer;
  mexidos integer;
begin
  pedidos := coalesce(array_length(ids, 1), 0);

  if pedidos = 0 then
    raise exception 'escolha ao menos um cheque para depositar';
  end if;

  if quando is null then
    raise exception 'diga a data do depósito';
  end if;

  if conta is null then
    raise exception 'diga em qual conta os cheques foram depositados';
  end if;

  if not exists (select 1 from public.contas_financeiras where id = conta) then
    raise exception 'essa conta da empresa não existe';
  end if;

  -- Id repetido na lista faria `pedidos` contar 2 e o UPDATE mexer 1 —
  -- a função acusaria conflito onde não há. Recusa antes, com nome claro.
  if pedidos <> (select count(distinct x) from unnest(ids) as x) then
    raise exception 'há cheque repetido na lista';
  end if;

  update public.cheques
     set status        = 'depositado',
         depositado_em = quando,
         conta_id      = conta
   where id = any(ids)
     and status = 'em_carteira';

  get diagnostics mexidos = row_count;

  if mexidos <> pedidos then
    raise exception
      'de % cheque(s) selecionado(s), só % estava(m) na carteira — alguém mexeu em outra aba. Nada foi depositado; recarregue a tela.',
      pedidos, mexidos;
  end if;

  return mexidos;
end;
$funcao$;

revoke all on function public.depositar_cheques(uuid[], uuid, date) from public;
grant execute on function public.depositar_cheques(uuid[], uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) COMPENSAR UM MAÇO
-- ---------------------------------------------------------------------------
-- ESTE é o momento em que o dinheiro entra no caixa (R70). O maço de
-- compensação é o mesmo do depósito — conta + data — porque é assim que o
-- extrato do banco mostra.
--
-- A conta vem do próprio cheque (gravada no depósito). O parâmetro existe
-- para dois casos: cheque depositado ANTES desta migration (conta nula) e
-- correção (depositou achando que era um banco, caiu em outro). Quando vem
-- preenchido, ele VENCE — quem está olhando o extrato agora sabe mais do que
-- quem digitou no depósito.
create or replace function public.compensar_cheques(
  ids     uuid[],
  quando  date,
  conta   uuid default null
)
returns integer
language plpgsql
set search_path = public
as $funcao$
declare
  pedidos integer;
  mexidos integer;
  sem_conta integer;
begin
  pedidos := coalesce(array_length(ids, 1), 0);

  if pedidos = 0 then
    raise exception 'escolha ao menos um cheque';
  end if;

  if quando is null then
    raise exception 'diga a data em que o dinheiro caiu';
  end if;

  if pedidos <> (select count(distinct x) from unnest(ids) as x) then
    raise exception 'há cheque repetido na lista';
  end if;

  if conta is not null
     and not exists (select 1 from public.contas_financeiras where id = conta) then
    raise exception 'essa conta da empresa não existe';
  end if;

  -- Sem conta o cheque compensaria e o dinheiro não entraria em conta
  -- nenhuma: sumiria do caixa, calado. Recusa ANTES de mexer em qualquer um.
  select count(*) into sem_conta
    from public.cheques
   where id = any(ids)
     and status = 'depositado'
     and coalesce(conta, conta_id) is null;

  if sem_conta > 0 then
    raise exception
      '% cheque(s) desse maço não sabe(m) em qual conta caiu — diga a conta. Sem isso o dinheiro sumiria do caixa.',
      sem_conta;
  end if;

  update public.cheques
     set status        = 'compensado',
         compensado_em = quando,
         conta_id      = coalesce(conta, conta_id)
   where id = any(ids)
     and status = 'depositado';

  get diagnostics mexidos = row_count;

  if mexidos <> pedidos then
    raise exception
      'de % cheque(s) selecionado(s), só % estava(m) depositado(s) — alguém mexeu em outra aba. Nada foi compensado; recarregue a tela.',
      pedidos, mexidos;
  end if;

  return mexidos;
end;
$funcao$;

revoke all on function public.compensar_cheques(uuid[], date, uuid) from public;
grant execute on function public.compensar_cheques(uuid[], date, uuid) to authenticated;
