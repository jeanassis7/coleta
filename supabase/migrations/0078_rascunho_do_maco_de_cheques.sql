-- ============================================================================
-- 0078 — O MAÇO DE CHEQUES EM DUAS ETAPAS
-- ============================================================================
-- Como o Jean trabalha de verdade (Evaner, 18/09/2026): ele pega o celular,
-- fotografa os cheques um a um, aperta "finalizei as fotos" — e aí senta no
-- notebook, dá F5, e confere com o maço de papel na mesa.
--
-- Hoje isso é impossível: as linhas lidas vivem na MEMÓRIA da aba. Fechou o
-- navegador, perdeu tudo — e paga a leitura de novo.
--
-- ---------------------------------------------------------------------------
-- A FOTO NÃO É SALVA, DE PROPÓSITO
-- ---------------------------------------------------------------------------
-- Só os DADOS que a leitura extraiu ficam guardados. A imagem morre na hora,
-- como sempre foi. Isso funciona porque **os cheques estão na mesa com ele**
-- na hora de conferir (confirmado com o Evaner) — papel na frente é melhor
-- conferência do que foto na tela.
--
-- ⚠️ Se um dia o fluxo mudar e ele passar a conferir LONGE dos cheques, esta
-- decisão cai: sem foto e sem papel, conferir vira acreditar. E o campo mais
-- perigoso é o valor, que é manuscrito — é por isso que o leitor tenta ler
-- ele DUAS vezes, em número e por extenso.
--
-- ---------------------------------------------------------------------------
-- POR QUE JSONB, E NÃO UMA TABELA DE LINHAS
-- ---------------------------------------------------------------------------
-- O rascunho é um bloco de rascunho: é lido inteiro e escrito inteiro, nunca
-- consultado por linha. Uma tabela filha só acrescentaria junção e ordem pra
-- manter, sem nada em troca.
--
-- E ele NÃO é dinheiro: nada aqui entra em caixa, estoque ou DRE. O maço só
-- vira cheque de verdade quando passa pelo `/api/admin/cheques/lote`, que
-- continua validando tudo do mesmo jeito. Este arquivo guarda intenção, não
-- fato — por isso não tem CHECK de valor nem trava de status.
--
-- ⚠️ AS DIVERGÊNCIAS VIAJAM JUNTO. `valor_extenso`, `ano_assumido` e a origem
-- do "bom para" existem só pra conferência e nunca vão pro /lote — mas
-- precisam sobreviver à troca de aparelho. Se o rascunho guardasse só os
-- valores, o notebook receberia um número limpo onde havia uma dúvida, e a
-- dúvida é justamente o ponto da segunda etapa.
-- ============================================================================

create table if not exists public.rascunho_lote_cheques (
  -- UM maço em andamento por pessoa. O Jean e o Evaner têm o seu, e ninguém
  -- esbarra no do outro. Chave primária no dono é o que garante.
  dono_id uuid primary key references public.profiles(id) on delete cascade,

  -- O cabeçalho do maço, se ele já tiver escolhido. Pode estar vazio: no
  -- celular ele às vezes só fotografa, e escolhe o comprador no notebook.
  comprador_id uuid references public.compradores(id) on delete set null,
  data date,
  rotulo text,

  -- As linhas como a tela trabalha com elas.
  linhas jsonb not null default '[]'::jsonb,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.rascunho_lote_cheques is
  'Maço de cheques em andamento: fotografa no celular, confere no computador. Guarda os DADOS lidos, nunca a imagem. Não é dinheiro — o maço só vira cheque pelo /api/admin/cheques/lote.';

alter table public.rascunho_lote_cheques enable row level security;
drop policy if exists rascunho_lote_cheques_admin on public.rascunho_lote_cheques;
create policy rascunho_lote_cheques_admin on public.rascunho_lote_cheques
  for all using (public.is_admin()) with check (public.is_admin());

-- `atualizado_em` é o que a tela mostra ("maço de 12 fotos, parado desde
-- ontem") e o que a limpeza usa. Mantido pelo banco pra não depender de todo
-- caminho de escrita lembrar.
create or replace function public.tocar_rascunho_cheques()
returns trigger
language plpgsql
set search_path = public
as $funcao$
begin
  new.atualizado_em := now();
  return new;
end;
$funcao$;

drop trigger if exists trg_tocar_rascunho_cheques on public.rascunho_lote_cheques;
create trigger trg_tocar_rascunho_cheques
  before update on public.rascunho_lote_cheques
  for each row execute function public.tocar_rascunho_cheques();
