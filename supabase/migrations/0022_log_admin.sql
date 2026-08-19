-- ============================================================================
-- 0022 — Log de quem fez o quê no painel
-- Aplicar no Supabase APÓS 0021.
-- ============================================================================
-- Contexto: o Evaner entra na operação e passa a lançar o financeiro; o Jean
-- acompanha e lança parte. Com DOIS pessoas mexendo, "quem alterou isso?"
-- deixa de ser dedução. E log não existe retroativo — o que não for gravado
-- hoje some pra sempre.
--
-- ---------------------------------------------------------------------------
-- COMO O BANCO SABE DE ONDE VEIO A GRAVAÇÃO (testado, não suposto)
-- ---------------------------------------------------------------------------
--   Painel (chave de serviço) ...... auth.uid() = NULL
--   Celular do motorista ........... auth.uid() = id dele
--   Script/migration (conexão direta) auth.uid() = NULL, sem headers
--
-- É isso que permite logar SÓ o painel sem depender de ninguém lembrar de
-- nada. Sem essa distinção, um gatilho em `coletas` gravaria as centenas de
-- sincronizações do celular junto, e a ação do gestor ficaria enterrada.
--
-- ---------------------------------------------------------------------------
-- DECISÕES QUE VALE ENTENDER ANTES DE MEXER
-- ---------------------------------------------------------------------------
-- 1. O NOME vem por cabeçalho HTTP (`x-ator`), porque a chave de serviço é a
--    mesma pros dois. Se faltar, a linha é gravada como "não identificado" —
--    nunca deixa de gravar. Esquecimento vira linha feia, não vira ausência.
--
-- 2. O AGRUPAMENTO vem de `x-operacao`: um id por clique, repetido em todas
--    as gravações daquele clique. Assim ninguém precisa classificar o que é
--    "ação em lote" — regra que envelheceria e erraria em feature nova.
--    Apagar um motorista com 59 coletas = 60 linhas com o mesmo id.
--
-- 3. SENHA NUNCA ENTRA. `profiles.senha_visivel` guarda a senha em texto puro
--    pro gestor repassar ao motorista. Sem máscara, toda troca de senha
--    ficaria escrita num log imutável pra sempre — pior que não ter log.
--
-- 4. Tabela nova entra sozinha, via event trigger no fim deste arquivo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Quem enxerga o log — por marca no cadastro, NÃO por papel
-- ---------------------------------------------------------------------------
-- Amarrar ao papel 'dev' quebraria no dia em que ele for aposentado (o
-- próprio Evaner já sinalizou que vai). Assim o papel muda e o acesso fica.
alter table public.profiles
  add column if not exists ve_log boolean not null default false;

comment on column public.profiles.ve_log is
  'Enxerga /admin/log. Independente do papel — admin ou dev, tanto faz.';

-- ---------------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------------
create table if not exists public.log_admin (
  id bigserial primary key,

  ator_id uuid references public.profiles(id) on delete set null,
  -- Cópia congelada: se o perfil for apagado, o log continua legível.
  -- Sem isso, apagar um usuário apagaria o rastro do que ele fez.
  ator_nome text not null default 'não identificado',

  -- Um id por clique. Todas as gravações do mesmo clique compartilham.
  operacao_id uuid,

  acao text not null check (acao in ('criou', 'editou', 'apagou')),
  tabela text not null,
  registro_id text,

  -- Só o que MUDOU, não a linha inteira. Menos ruído e menos peso.
  antes jsonb,
  depois jsonb,

  criado_em timestamptz not null default now()
);

create index if not exists idx_log_admin_criado on public.log_admin(criado_em desc);
create index if not exists idx_log_admin_ator on public.log_admin(ator_id, criado_em desc);
create index if not exists idx_log_admin_operacao on public.log_admin(operacao_id);
create index if not exists idx_log_admin_tabela on public.log_admin(tabela, criado_em desc);

alter table public.log_admin enable row level security;

-- IMUTÁVEL: só existe política de leitura. Sem UPDATE e sem DELETE, ninguém
-- edita nem apaga — nem o admin, nem o dev. Log que o próprio autor pode
-- limpar não é log. A escrita entra por SECURITY DEFINER no gatilho.
drop policy if exists "quem tem ve_log lê o log" on public.log_admin;
create policy "quem tem ve_log lê o log"
  on public.log_admin for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.ativo and p.ve_log
    )
  );

-- ---------------------------------------------------------------------------
-- O gatilho
-- ---------------------------------------------------------------------------
create or replace function public.registrar_log_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Campos que NUNCA podem ser gravados em claro.
  campos_ocultos constant text[] := array['senha_visivel'];
  headers json;
  v_ator uuid;
  v_operacao uuid;
  v_nome text;
  v_acao text;
  v_id text;
  v_antes jsonb;
  v_depois jsonb;
  chave text;
begin
  -- Veio do celular do motorista (ele está logado): não é ação de painel.
  if auth.uid() is not null then
    return coalesce(new, old);
  end if;

  begin
    headers := current_setting('request.headers', true)::json;
  exception when others then
    headers := null;   -- conexão direta (migration): segue sem cabeçalho
  end;

  -- Cast tolerante: cabeçalho torto não pode derrubar a gravação original.
  begin
    v_ator := nullif(headers ->> 'x-ator', '')::uuid;
  exception when others then
    v_ator := null;
  end;
  begin
    v_operacao := nullif(headers ->> 'x-operacao', '')::uuid;
  exception when others then
    v_operacao := null;
  end;

  if v_ator is not null then
    select nome into v_nome from public.profiles where id = v_ator;
  end if;

  if TG_OP = 'INSERT' then
    v_acao := 'criou';
    v_antes := null;
    v_depois := to_jsonb(new);
    v_id := to_jsonb(new) ->> 'id';

  elsif TG_OP = 'DELETE' then
    v_acao := 'apagou';
    v_antes := to_jsonb(old);
    v_depois := null;
    v_id := to_jsonb(old) ->> 'id';

  else
    v_acao := 'editou';
    v_id := to_jsonb(new) ->> 'id';
    -- Só as colunas que mudaram de fato. Salvar a linha inteira encheria o
    -- log de campo repetido e esconderia o que importa.
    select
      coalesce(jsonb_object_agg(k, to_jsonb(old) -> k), '{}'::jsonb),
      coalesce(jsonb_object_agg(k, e.v), '{}'::jsonb)
      into v_antes, v_depois
    from jsonb_each(to_jsonb(new)) as e(k, v)
    where to_jsonb(old) -> e.k is distinct from e.v;

    -- Nada mudou de verdade (update que reescreveu o mesmo valor): não loga.
    if v_depois = '{}'::jsonb then
      return new;
    end if;
  end if;

  -- Máscara: registra QUE mudou, nunca O QUE é.
  foreach chave in array campos_ocultos loop
    if v_antes ? chave then v_antes := jsonb_set(v_antes, array[chave], '"(oculto)"'); end if;
    if v_depois ? chave then v_depois := jsonb_set(v_depois, array[chave], '"(oculto)"'); end if;
  end loop;

  insert into public.log_admin
    (ator_id, ator_nome, operacao_id, acao, tabela, registro_id, antes, depois)
  values
    (v_ator, coalesce(v_nome, 'não identificado'), v_operacao, v_acao,
     TG_TABLE_NAME, v_id, v_antes, v_depois);

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ligar nas tabelas
-- ---------------------------------------------------------------------------
-- Fora da lista: `log_admin` (registraria a si mesmo em loop),
-- `alertas_vistos` (o "OK, VI" não muda dado) e `app_events` (telemetria do
-- celular, milhares de linhas).
create or replace function public.ligar_log_na_tabela(p_tabela text)
returns void language plpgsql as $$
begin
  if p_tabela in ('log_admin', 'alertas_vistos', 'app_events') then
    return;
  end if;
  execute format('drop trigger if exists trg_log_admin on public.%I', p_tabela);
  execute format(
    'create trigger trg_log_admin after insert or update or delete on public.%I
       for each row execute function public.registrar_log_admin()', p_tabela);
end;
$$;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('log_admin', 'alertas_vistos', 'app_events')
  loop
    perform public.ligar_log_na_tabela(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tabela nova nasce com log — sem ninguém lembrar
-- ---------------------------------------------------------------------------
-- Sem isto, a tabela de manutenção ou de salários (que ainda vamos criar)
-- ficaria sem rastro até alguém perceber. E "alguém perceber" é justamente o
-- que não acontece com log: a ausência de linha não parece erro.
create or replace function public.auto_ligar_log()
returns event_trigger
language plpgsql
as $$
declare r record;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE'
  loop
    if r.schema_name = 'public' then
      perform public.ligar_log_na_tabela(split_part(r.object_identity, '.', 2));
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_auto_ligar_log;
create event trigger trg_auto_ligar_log
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.auto_ligar_log();
