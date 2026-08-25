-- ============================================================================
-- 0060 — Adiantamento de REGULARIZAÇÃO não é fato vivido pelo motorista
-- ============================================================================
-- O relatório da carga (25/08/2026) mostra a linha do tempo do que o motorista
-- viveu: ele aceitou o dinheiro no app, naquele dia, naquela hora. Os 15
-- adiantamentos que o backfill da virada criou não são isso — nasceram de uma
-- planilha, com hora sintética (12:00), e o motorista nunca viu tela nenhuma.
-- No papel dele viravam a pergunta errada: "eu aceitei R$ 5.000 nesse dia?".
--
-- ⚠️ Isto NÃO tira o dinheiro de lugar nenhum: a regularização continua
-- contando no saldo, no caixa e no DRE, exatamente como antes. A flag só
-- responde "isso apareceu na tela do motorista um dia?" — e por isso o único
-- lugar que a lê é o relatório dele.
--
-- Não vira toggle no painel (mesma decisão do `protegido`, 0059): é marca
-- histórica de um lote que já aconteceu e não volta a acontecer.

alter table public.adiantamentos
  add column if not exists regularizacao boolean not null default false;

comment on column public.adiantamentos.regularizacao is
  'true = lançamento de regularização (virada de sistema), não um aceite que o '
  'motorista viveu no app. Conta no saldo normalmente; fica FORA do relatório '
  'da carga.';

-- Os lotes do backfill se identificam sozinhos: o script carimbou a
-- observação com `[backfill-2026 adi-NNN]`.
update public.adiantamentos
   set regularizacao = true
 where observacao like '[backfill-2026%'
   and not regularizacao;
