-- ============================================================================
-- 0014 — Compras diretas de óleo (o gestor compra, não o motorista)
-- Aplicar no Supabase APÓS 0013.
-- ============================================================================
-- Contexto (Evaner): as vezes aparece um óleo grande, o gestor negocia,
-- paga do caixa da empresa e busca com um caminhão. O motorista não
-- coletou nada — então isso NÃO pode:
--   • descontar do saldo/adiantamento de ninguém
--   • contar como coleta dele (comissão, custo por motorista, certificado)
--
-- O que entra: custo da empresa + óleo no estoque.
--
-- UNIDADE: quem pesou na balança lança em kg (medido); quem não pesou
-- lança em litros (estimado) e o peso_kg sai por conversão 0,9 — a mesma
-- densidade do resto do sistema. peso_kg é a coluna oficial pro estoque,
-- e a unidade original fica registrada pra nunca confundir chute com
-- balança.
--
-- entra_no_estoque = false no caso RARO de o óleo ter ido dentro de um
-- caminhão que ainda tinha carga de motorista: ali o peso vai ser contado
-- na descarga dele, e aqui registra-se só o custo (senão contaria duas
-- vezes). Processo combinado: só buscar óleo de fora com caminhão vazio.
-- ============================================================================

create table public.compras_diretas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  fornecedor text not null,
  valor numeric(10,2) not null check (valor > 0),
  quantidade numeric(10,2) not null check (quantidade > 0),
  unidade text not null check (unidade in ('kg', 'litros')),
  peso_kg numeric(10,2) generated always as (
    case when unidade = 'kg' then quantidade else quantidade * 0.9 end
  ) stored,
  entra_no_estoque boolean not null default true,
  foto_path text,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index idx_compras_diretas_data on public.compras_diretas(data desc);

alter table public.compras_diretas enable row level security;

-- Só admin/dev (is_admin() cobre os dois). Motorista não vê nem lança.
create policy "admin acesso total compras_diretas"
  on public.compras_diretas for all
  using (public.is_admin()) with check (public.is_admin());
