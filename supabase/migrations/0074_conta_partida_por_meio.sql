-- ============================================================================
-- 0074 — UMA CONTA, VÁRIOS MEIOS DE PAGAMENTO
-- ============================================================================
-- "Às vezes 3 contas dão R$ 1.000 e um cheque de R$ 1.000 paga. Às vezes 1
-- conta dá R$ 1.000 e cheque de 600 + outro de 400 paga." (Evaner, 15/09)
--
-- ---------------------------------------------------------------------------
-- O DESENHO: O BANCO PARTE, A TELA JUNTA
-- ---------------------------------------------------------------------------
-- A alternativa era uma tabela de pagamentos com itens e meios (a modelagem
-- academicamente correta). Ela obriga a reescrever `movimentos_caixa` — que é
-- A FONTE DO DINHEIRO — mais o backfill de todo o histórico. Semanas de risco
-- em cima do coração financeiro, pra chegar no mesmo resultado visível.
--
-- Aqui cada PEDAÇO de conta carrega EXATAMENTE UM meio. Com isso
-- `forma_pagamento`, `conta_id` e `cheque_id` continuam valendo 1:1 e NADA
-- muda na `movimentos_caixa`, na `saldo_contas()` nem no DRE. A tela reagrupa
-- os pedaços numa linha só, por `conta_pai_id`.
--
-- E tem um ganho que não é cosmético: partir POR MEIO faz o `cheque_id` parar
-- de mentir. Hoje o fechamento do posto joga todas as notas-de-cheque no
-- primeiro cheque ("é referência, não rateio"); com um meio por pedaço, a
-- amarração vira verdade.
--
-- ---------------------------------------------------------------------------
-- POR QUE A FK NÃO TEM `on delete cascade`
-- ---------------------------------------------------------------------------
-- Cascade deixaria apagar o pedaço-mãe levar os filhos junto — inclusive
-- filhos JÁ PAGOS por outro meio, sumindo com dinheiro que saiu de verdade.
-- Sem cascade o banco RECUSA apagar a mãe enquanto houver pedaço apontando
-- pra ela, e o caminho certo passa a ser desfazer o acerto inteiro pelo
-- `pagamento_id` (0073). O endpoint avisa isso em português antes de o banco
-- precisar reclamar.
-- ============================================================================

alter table public.contas_a_pagar
  add column if not exists conta_pai_id uuid references public.contas_a_pagar(id);

create index if not exists idx_contas_pai on public.contas_a_pagar(conta_pai_id);

comment on column public.contas_a_pagar.conta_pai_id is
  'Pedaço de uma conta partida entre meios de pagamento. Aponta pro pedaço original, que guarda a identidade da conta. A tela agrupa por coalesce(conta_pai_id, id); a SOMA dos pedaços é o valor original da conta.';

-- Um pedaço não pode ser pai de outro: dois níveis viraria árvore, e árvore
-- num lugar que só precisa de "mãe e filhos" é complexidade que só aparece
-- quando alguém já errou. O trigger recusa antes.
create or replace function public.pedaco_nao_e_pai()
returns trigger
language plpgsql
set search_path = public
as $funcao$
begin
  if new.conta_pai_id is not null then
    if exists (
      select 1 from public.contas_a_pagar
       where id = new.conta_pai_id and conta_pai_id is not null
    ) then
      raise exception
        'esse pedaço já é filho de outra conta — aponte pro pedaço original, não pra um irmão';
    end if;
    if new.conta_pai_id = new.id then
      raise exception 'uma conta não pode ser mãe de si mesma';
    end if;
  end if;
  return new;
end;
$funcao$;

drop trigger if exists trg_pedaco_nao_e_pai on public.contas_a_pagar;
create trigger trg_pedaco_nao_e_pai
  before insert or update of conta_pai_id on public.contas_a_pagar
  for each row execute function public.pedaco_nao_e_pai();
