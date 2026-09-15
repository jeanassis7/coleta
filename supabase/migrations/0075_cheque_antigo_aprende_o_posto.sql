-- ============================================================================
-- 0075 — OS CHEQUES ANTIGOS APRENDEM QUAL POSTO RECEBERAM
-- ============================================================================
-- A 0073 criou `cheques.repassado_local_id` e deliberadamente NÃO fez
-- backfill: `repassado_para` é texto livre, e casar nome por semelhança
-- acertaria a maioria e erraria calado em alguma — dívida no posto errado é
-- pior que dívida sem posto.
--
-- Agora o backfill acontece com INTENÇÃO: em 15/09/2026 o Evaner olhou a
-- lista de 28 nomes distintos e confirmou, um a um, quais são os dois postos
-- cadastrados. Não é adivinhação de máquina — é a pessoa que assinou as notas
-- dizendo o que cada nome é.
--
--   "CENTRO OESTE ABASTECIMENTO"  → CENTRO OESTE   21 cheques  R$ 52.295,50
--   "CENTRO OESTE"                → CENTRO OESTE    3 cheques  R$  7.254,21
--   "TEXAS RODOVIA"               → Texas          12 cheques  R$ 46.059,82
--   "Texas"                       → Texas           2 cheques  R$  6.077,20
--                                                   ─────────────────────────
--                                                   38 cheques R$ 111.686,73
--
-- ⚠️ FICOU DE FORA, por decisão dele: "CATARATAS DIESEL VM330 ACERTO FINAL"
-- (1 cheque, R$ 4.199,00). O nome parece posto, mas foi o acerto final da
-- COMPRA DE UM VEÍCULO. É exatamente o caso que justificou não adivinhar: a
-- semelhança de nome teria mandado R$ 4.199 de dívida pro posto errado.
--
-- ---------------------------------------------------------------------------
-- O QUE ISTO MUDA, E O QUE NÃO MUDA
-- ---------------------------------------------------------------------------
-- NÃO muda um centavo de nada. `repassado_local_id` não é lido por
-- `movimentos_caixa`, `saldo_contas()`, `saldo_postos()` nem pelo DRE — ele
-- só é consultado NA DEVOLUÇÃO, pra saber de qual posto a dívida nova é.
--
-- Ou seja: o efeito é futuro e condicional. Se um desses 38 cheques voltar do
-- banco, a dívida vai pro saldo do posto certo em vez de ficar só com o nome
-- em Contas a pagar.
--
-- Só mexe em linha com `repassado_local_id` NULO: rodar duas vezes não
-- desfaz nada e não sobrescreve nada que o fechamento novo já tenha gravado.
-- ============================================================================

do $$
declare
  id_centro uuid;
  id_texas  uuid;
  n integer;
begin
  -- Busca por nome E tipo. Se o posto tiver sido renomeado ou apagado, é
  -- melhor a migration FALHAR do que ligar 38 cheques a um nulo em silêncio.
  select id into id_centro from public.locais
   where tipo = 'posto' and nome_canonico = 'CENTRO OESTE';
  select id into id_texas from public.locais
   where tipo = 'posto' and nome_canonico = 'Texas';

  if id_centro is null then
    raise exception 'não achei o posto CENTRO OESTE — confira o cadastro antes de rodar';
  end if;
  if id_texas is null then
    raise exception 'não achei o posto Texas — confira o cadastro antes de rodar';
  end if;

  update public.cheques
     set repassado_local_id = id_centro
   where repassado_local_id is null
     and repassado_em is not null
     and repassado_para in ('CENTRO OESTE ABASTECIMENTO', 'CENTRO OESTE');
  get diagnostics n = row_count;
  raise notice 'CENTRO OESTE: % cheque(s) ligado(s)', n;

  update public.cheques
     set repassado_local_id = id_texas
   where repassado_local_id is null
     and repassado_em is not null
     and repassado_para in ('TEXAS RODOVIA', 'Texas');
  get diagnostics n = row_count;
  raise notice 'Texas: % cheque(s) ligado(s)', n;
end $$;
