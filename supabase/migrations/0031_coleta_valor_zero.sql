-- 0031 — Coleta pode ter valor ZERO.
--
-- ---------------------------------------------------------------------------
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Regra R2 do NEGOCIOv3.md, conferida pelo Evaner: óleo é sempre pago, mas se
-- em algum caso ele for doado, lança-se com **valor zero** — e não com uma
-- regra especial ou um campo novo.
--
-- O CHECK original exigia `> 0` e recusava. O motorista digitava zero, o app
-- mandava, e o banco devolvia erro — no meio do Paraná, sem sinal, com a fila
-- offline tentando de novo pra sempre.
--
-- `litros > 0` CONTINUA: coleta sem óleo não é coleta. O que pode ser zero é
-- o quanto se pagou, não o quanto se coletou.

alter table public.coletas
  drop constraint if exists coletas_valor_pago_check;

alter table public.coletas
  add constraint coletas_valor_pago_check check (valor_pago >= 0);
