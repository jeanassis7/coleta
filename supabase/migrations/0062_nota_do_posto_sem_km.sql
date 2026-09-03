-- ============================================================================
-- 0062 — A NOTA QUE VEM DO EXTRATO DO POSTO NÃO TEM KM
-- ============================================================================
-- Como funciona de verdade (Evaner, 03/09/2026): o Jean e o Valdecir não
-- lançam nada na hora de abastecer. Uma vez por mês eles vão ao posto, o
-- posto entrega as notas assinadas do período, e SÓ ENTÃO isso entra no
-- software.
--
-- O km é o odômetro na hora da bomba — quem tem esse número é o motorista,
-- pelo celular. Numa nota transcrita de um extrato trinta dias depois ele
-- não existe. Obrigar um número ali produziria km inventado, e km inventado
-- envenena o km/L e o alerta de salto de odômetro: o dado errado seria pior
-- que o dado ausente.
--
-- A trava não some, muda de forma: sem km só passa lançamento do PAINEL
-- (`lancado_por` preenchido). O do motorista continua exigindo o odômetro.

alter table public.abastecimentos
  alter column km_atual drop not null;

comment on column public.abastecimentos.km_atual is
  'Odômetro na hora do abastecimento. Nulo SÓ em nota transcrita do extrato '
  'do posto pelo painel — quem abastece pelo celular sempre informa. '
  'O km/L já ignora linha sem km.';

alter table public.abastecimentos
  drop constraint if exists abastecimento_sem_km_so_do_painel;
alter table public.abastecimentos
  add constraint abastecimento_sem_km_so_do_painel
  check (km_atual is not null or lancado_por is not null);
