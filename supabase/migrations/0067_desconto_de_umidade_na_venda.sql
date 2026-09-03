-- ============================================================================
-- 0067 — DESCONTO DE UMIDADE: CHEGA DEPOIS DA VENDA
-- ============================================================================
-- Como funciona com a PROLUMINAS (Evaner, 03/09/2026): eles buscam a carga,
-- pagam um adiantamento por um valor combinado, e SÓ DEPOIS mandam a análise
-- de umidade deles — que derruba o valor. A venda nasce com um número que
-- ainda não é o final.
--
-- Hoje o jeito de refletir isso era editar o valor da venda pra menos. O
-- dinheiro fechava, mas a memória sumia: daqui a seis meses ninguém sabe se
-- aqueles R$ 6.400 a menos foram umidade, negociação ou erro de digitação.
--
-- ⚠️ DECISÃO DE DESENHO: `valor_total` continua sendo O VALOR FINAL — o que
-- eles devem e o que a empresa ganhou. Tudo que já lê vendas (saldo do
-- comprador, receita do DRE) continua certo sem saber que este campo existe.
-- Os campos novos são MEMÓRIA do que aconteceu, não uma segunda verdade.
-- O caminho contrário (valor_total = combinado, e cada consulta subtraindo o
-- desconto) espalharia a regra por todo lado e um dia alguém esqueceria.

alter table public.vendas
  add column if not exists valor_combinado numeric(12,2),
  add column if not exists desconto_umidade numeric(12,2) not null default 0,
  add column if not exists desconto_umidade_em date,
  add column if not exists desconto_umidade_obs text;

comment on column public.vendas.valor_combinado is
  'O valor ANTES do desconto de umidade. Nulo enquanto não houve desconto.';
comment on column public.vendas.desconto_umidade is
  'Quanto o comprador abateu pela análise de umidade DELE. Já está descontado '
  'de valor_total — este campo é a memória do porquê, não um segundo valor.';
comment on column public.vendas.desconto_umidade_em is
  'Quando o desconto foi lançado. É sempre DEPOIS da venda: a análise deles '
  'não existe no dia em que a carga sai.';

-- O desconto nunca pode engolir a venda inteira nem ser negativo (isso seria
-- acréscimo disfarçado, e acréscimo tem que ser lançado como o que é).
alter table public.vendas drop constraint if exists venda_desconto_umidade_coerente;
alter table public.vendas add constraint venda_desconto_umidade_coerente check (
  desconto_umidade >= 0
  and (desconto_umidade = 0 or valor_combinado is not null)
  and (valor_combinado is null or desconto_umidade < valor_combinado)
);
