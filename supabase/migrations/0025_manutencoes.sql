-- 0025 — Manutenção de veículo.
--
-- Pneu é `tipo = 'pneu'` com a descrição contando o que foi ("4 pneus
-- dianteiros"). Sem estrutura por carcaça, sem posição, sem sulco — cortado
-- pelo Evaner: pra 3-4 caminhões, relatório que ninguém alimenta mente mais
-- do que ajuda.
--
-- `proxima_km` só a troca de óleo usa: é o km em que a próxima vence, e é
-- o que faz nascer o alerta "passou do km da troca".
--
-- ⚠️ NÃO criar trigger de log aqui. O event trigger `trg_auto_ligar_log`
-- (migration 0022) liga `trg_log_admin` sozinho em toda tabela nova de
-- `public`. Criar na mão dá trigger duplicado e log em dobro.

create table if not exists public.manutencoes (
  id uuid primary key default gen_random_uuid(),
  caminhao_id uuid not null references public.caminhoes(id),
  data date not null,
  km integer check (km >= 0),
  tipo text not null check (tipo in ('troca_oleo','pneu','revisao','corretiva','outro')),
  descricao text not null,
  valor numeric(10,2) not null check (valor > 0),
  fornecedor text,
  proxima_km integer check (proxima_km > 0),
  foto_path text,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_manutencoes_caminhao
  on public.manutencoes(caminhao_id, data desc);

-- Índice parcial: o alerta de km só olha troca de óleo com próxima marcada.
create index if not exists idx_manutencoes_proxima
  on public.manutencoes(caminhao_id, proxima_km)
  where proxima_km is not null;

alter table public.manutencoes enable row level security;

-- Manutenção é dado de gestão. O motorista não lê nem escreve — não existe
-- tela disso no PWA e não vai existir (decisão do Evaner: "é tudo dado
-- gerencial de gestão, o motorista continua tudo igual").
create policy "admin acesso total manutencoes"
  on public.manutencoes for all
  using (public.is_admin()) with check (public.is_admin());
