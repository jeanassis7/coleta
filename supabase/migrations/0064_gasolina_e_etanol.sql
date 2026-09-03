-- ============================================================================
-- 0064 — CARRO NÃO ABASTECE DIESEL
-- ============================================================================
-- A 0044 separou diesel de arla porque arla não é combustível e derrubaria o
-- km/L. Naquele momento só existia caminhão. Agora existe carro de sócio na
-- nota da empresa (0061), e carro abastece gasolina ou etanol.
--
-- Sem isto, gasolina era gravada como 'diesel' — o rótulo mentiria na tela e
-- no relatório, e um dia alguém compararia "consumo de diesel" somando o
-- carro do Jean com o caminhão.

alter table public.abastecimentos drop constraint if exists abastecimentos_tipo_check;
alter table public.abastecimentos
  add constraint abastecimentos_tipo_check
  check (tipo in ('diesel', 'arla', 'gasolina', 'etanol'));

comment on column public.abastecimentos.tipo is
  'diesel | arla | gasolina | etanol. ARLA é o único que fica fora do km/L: '
  'não é combustível. Os outros três movem o veículo e contam.';
