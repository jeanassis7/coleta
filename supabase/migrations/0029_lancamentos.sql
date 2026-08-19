-- 0029 — Lançamentos: quem, e a fonte do dinheiro.
--
-- ---------------------------------------------------------------------------
-- O QUÊ vs QUEM
-- ---------------------------------------------------------------------------
-- A planilha do Evaner misturava as duas coisas: "Pro-Labore Jean", "Lucimar
-- — Dinheiro em mãos". Isso faz a lista de categorias crescer com as PESSOAS
-- — contratou alguém, mexe na lista; saiu alguém, a categoria fica órfã no
-- histórico pra sempre.
--
-- Aqui `categoria` é só o QUÊ, e `pessoa_id` é o QUEM. Assim "Salários" é uma
-- linha do DRE que abre por pessoa, e contratar não mexe em nada.
--
-- A lista de categorias vive na APLICAÇÃO (src/lib/plano-contas.ts), não num
-- CHECK: acrescentar linha vira deploy em vez de migration, e o DRE precisa
-- de metadado (grupo, se pede pessoa, de onde vem) que não cabe num CHECK.

alter table public.contas_a_pagar
  add column if not exists pessoa_id uuid references public.profiles(id);

create index if not exists idx_contas_pagar_pessoa
  on public.contas_a_pagar(pessoa_id) where pessoa_id is not null;

create index if not exists idx_contas_pagar_categoria
  on public.contas_a_pagar(categoria, vencimento);

-- ---------------------------------------------------------------------------
-- Valdecir — criado FORA daqui, de propósito
-- ---------------------------------------------------------------------------
-- `profiles.id` tem FK pra `auth.users`: não dá pra criar pessoa por SQL
-- puro, ela precisa nascer no Supabase Auth primeiro. Quem faz isso é
-- `scripts/criar-pessoa.mjs`, que usa a service_role.
--
-- Ele nasce INATIVO: `ativo = false` o mantém fora do login e de qualquer
-- tela operacional, e o middleware nunca deixa entrar. É cadastro contábil,
-- não usuário.

-- ---------------------------------------------------------------------------
-- As 2 contas que já existem viram categoria do plano novo
-- ---------------------------------------------------------------------------
-- Elas nasceram de coletas pagas pela sede (origem_tipo = 'coleta'), então a
-- categoria certa é o custo do óleo. Não entram no DRE de qualquer jeito —
-- são espelho da coleta, que é quem lança o gasto.
update public.contas_a_pagar
set categoria = 'oleo_sede'
where origem_tipo = 'coleta' and categoria not in (
  select unnest(array['oleo_sede'])
);
