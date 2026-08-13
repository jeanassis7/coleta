-- ============================================================================
-- 0010 — Valores do Módulo 1 aceitam centavos
-- Aplicar no Supabase APÓS 0009.
-- ============================================================================
-- Contexto (feedback do Evaner no teste de campo):
--   O input de R$ antigo descartava vírgula — "520,12" virava 52.012 (100x).
--   A UI ganhou máscara estilo app de banco (digita algarismos, preenche
--   da direita: "68047" → R$ 680,47) e esses valores agora carregam
--   centavos, porque combustível/almoço nunca são redondos e o cupom
--   fotografado precisa bater com o sistema.
--
--   COLETAS FICAM FORA: coletas.valor_pago segue INTEIRO (regra antiga do
--   Evaner: "valor cheio sempre 100 125 130 200"). Na coleta a UI bloqueia
--   vírgula com aviso em vez de mascarar.
--
--   ALTER TYPE integer→numeric preserva os CHECKs existentes (>0 / >=0).
-- ============================================================================

alter table public.despesas
  alter column valor type numeric(10,2);

alter table public.abastecimentos
  alter column valor type numeric(10,2);

alter table public.adiantamentos
  alter column valor type numeric(10,2);

alter table public.acertos
  alter column valor_devolvido type numeric(10,2),
  alter column valor_vale type numeric(10,2),
  alter column valor_saldo type numeric(10,2);
