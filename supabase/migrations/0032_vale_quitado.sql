-- 0032 — O vale do acerto sabe quando foi descontado.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- No acerto, o saldo do motorista se divide em três: devolvido (dinheiro
-- vivo), **vale** (desconta do salário) e saldo (carrega pro próximo ciclo).
--
-- O vale ficava registrado no acerto e **nada o ligava ao pagamento**. Na
-- hora de pagar o salário, era o gestor que tinha que lembrar de cabeça — e
-- lembrar de cabeça é o que o sistema existe pra evitar.
--
-- Regra R110-b do NEGOCIOv3.md: "o sistema deveria lembrar".
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA DATA E NÃO UM BOOLEANO
-- ---------------------------------------------------------------------------
-- `vale_quitado_em` responde "quando" além de "se". Um booleano diria só que
-- foi descontado, e no primeiro "mas em qual pagamento?" a resposta some.
--
-- `vale_quitado_por` guarda o lançamento de salário que o descontou — assim
-- dá pra abrir o pagamento e ver o que ele cobriu.

alter table public.acertos
  add column if not exists vale_quitado_em date,
  add column if not exists vale_quitado_por uuid references public.contas_a_pagar(id) on delete set null;

-- Índice parcial: a busca é sempre "vales pendentes deste motorista", nunca
-- a lista inteira de acertos.
create index if not exists idx_acertos_vale_pendente
  on public.acertos(motorista_id)
  where valor_vale <> 0 and vale_quitado_em is null;
