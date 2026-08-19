-- 0030 — Remuneração com VIGÊNCIA: valor que muda no tempo sem reescrever o
-- passado.
--
-- ---------------------------------------------------------------------------
-- O PEDIDO
-- ---------------------------------------------------------------------------
-- "Comissão y a partir de coletas do dia tal. Mudou a comissão, as coletas a
-- partir de tal data mudam." (Evaner, 19/08/2026)
--
-- O mesmo mecanismo serve salário, bônus, aumento e transferência a sócio:
-- todos são um valor que vale A PARTIR de uma data. Uma tabela só.
--
-- A busca: pra um fato na data D vale a vigência de MAIOR `vigente_desde`
-- que seja <= D, preferindo a específica da pessoa sobre a geral. Cadastrar
-- uma vigência nova não mexe em nada anterior — é isso que faz o histórico
-- parar de pé.
--
-- ---------------------------------------------------------------------------
-- COMISSÃO É PROPORCIONAL
-- ---------------------------------------------------------------------------
-- `valor` a cada `litros_base` litros, proporcional: 100 L numa base de 200
-- paga metade. Decisão do Evaner — não é bloco fechado.
--
-- ⚠️ NÃO criar trigger de log aqui — o event trigger `trg_auto_ligar_log`
-- (0022) liga sozinho em toda tabela nova de `public`.

create table if not exists public.vigencias_remuneracao (
  id uuid primary key default gen_random_uuid(),
  -- null = vale pra todo mundo (ex: a comissão padrão da empresa).
  -- Uma vigência com pessoa vence a geral na mesma data.
  pessoa_id uuid references public.profiles(id) on delete cascade,
  tipo text not null check (
    tipo in ('salario', 'comissao', 'bonus', 'transferencia_socio')
  ),
  valor numeric(12,2) not null check (valor >= 0),
  -- Só comissão usa: "R$ valor a cada litros_base litros".
  litros_base integer check (litros_base > 0),
  vigente_desde date not null,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),

  -- Duas vigências do mesmo tipo, pra mesma pessoa, começando no mesmo dia
  -- seria ambíguo: qual vale? O banco recusa em vez de escolher sozinho.
  constraint vigencia_unica unique (pessoa_id, tipo, vigente_desde)
);

-- Comissão precisa da base de litros; os outros tipos não usam.
alter table public.vigencias_remuneracao
  drop constraint if exists comissao_precisa_de_base;
alter table public.vigencias_remuneracao
  add constraint comissao_precisa_de_base check (
    (tipo = 'comissao' and litros_base is not null)
    or (tipo <> 'comissao' and litros_base is null)
  );

create index if not exists idx_vigencias_busca
  on public.vigencias_remuneracao(tipo, pessoa_id, vigente_desde desc);

alter table public.vigencias_remuneracao enable row level security;

-- Dado de gestão: o motorista não vê quanto os outros ganham.
create policy "admin acesso total vigencias"
  on public.vigencias_remuneracao for all
  using (public.is_admin()) with check (public.is_admin());
