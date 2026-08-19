-- 0026 — Documentos com vencimento, de caminhão OU de motorista.
--
-- Dois FKs anuláveis com CHECK de exatamente um dono, em vez de dono
-- polimórfico por texto: mantém integridade referencial de verdade e o banco
-- impede documento órfão.
--
-- O `tipo` é texto no banco mas ENUM NA APLICAÇÃO (src/lib/documentos.ts).
-- Decisão do Evaner: lista fixa, com "outro" como saída de emergência pra
-- ninguém ficar travado num sábado esperando deploy. Texto livre puro garante
-- que um dia apareçam "CIPP", "cipp" e "C.I.P.P." como três coisas no painel.
--
-- `valor` guarda quanto custou renovar, pra histórico. Documento NÃO vira
-- conta a pagar automaticamente (decisão do plano do Módulo 2): ele vira
-- previsão recorrente, que é outra máquina.
--
-- ⚠️ NÃO criar trigger de log aqui — ver o comentário na 0025.

create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  caminhao_id  uuid references public.caminhoes(id) on delete cascade,
  motorista_id uuid references public.profiles(id)  on delete cascade,
  constraint um_dono_so check (
    (caminhao_id is not null)::int + (motorista_id is not null)::int = 1
  ),
  tipo text not null,
  -- preenchido só quando tipo = 'outro'
  descricao text,
  vencimento date not null,
  valor numeric(10,2) check (valor >= 0),
  arquivo_path text,
  -- quantos dias antes o alerta acende
  alerta_dias integer not null default 30 check (alerta_dias between 0 and 365),
  observacao text,
  registrado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_documentos_caminhao
  on public.documentos(caminhao_id, vencimento) where caminhao_id is not null;
create index if not exists idx_documentos_motorista
  on public.documentos(motorista_id, vencimento) where motorista_id is not null;
create index if not exists idx_documentos_vencimento
  on public.documentos(vencimento);

alter table public.documentos enable row level security;

create policy "admin acesso total documentos"
  on public.documentos for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bucket dos arquivos
-- ---------------------------------------------------------------------------
-- Bucket SEPARADO do `fotos-coletas` de propósito. Lá a policy deixa o
-- motorista ler tudo dentro da pasta com o id dele — regra correta pra foto
-- de fachada e errada pra foto de CNH e de exame toxicológico.
--
-- Aqui: só admin, nas quatro operações. O motorista não tem tela disso e o
-- app dele não muda em nada neste bloco.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists "admin acesso total documentos storage" on storage.objects;
create policy "admin acesso total documentos storage"
  on storage.objects for all
  using      (bucket_id = 'documentos' and public.is_admin())
  with check (bucket_id = 'documentos' and public.is_admin());
