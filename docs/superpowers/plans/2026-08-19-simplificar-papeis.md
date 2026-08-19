# Simplificar papéis: matar `dev` e `is_teste`

> **Para quem for executar:** os passos usam checkbox (`- [ ]`). Este projeto
> **não tem framework de teste** — a verificação é `npm run typecheck`,
> `npm run build` e os dois scripts E2E. Não invente `jest`/`vitest`.

**Objetivo:** deixar UMA diferença entre Jean e Evaner — `ve_log`. Some o papel
`dev` e some o conceito de motorista de teste.

**Arquitetura:** `profiles.role` volta a ter dois valores (`motorista` | `admin`).
Toda capacidade extra vira **coluna independente** no cadastro, não hierarquia.
Hoje existe uma só: `ve_log`. O sandbox deixa de existir — pra testar, cria-se um
perfil normal e apaga-se depois.

**Stack:** Next.js 15 · Supabase (Postgres + RLS) · `node scripts/aplicar-migration.mjs`

---

## ⚠️ ORDEM DE DEPLOY — ler antes de tudo

Errar isso te tranca fora do painel em produção. São **três fases**, nesta ordem:

| Fase | O quê | Por que nessa ordem |
|---|---|---|
| **1** | Migration A: `role='dev'` vira `'admin'` | O código **antigo** usa `podeAcessarAdmin` (admin OU dev), então virar admin agora é seguro. Se o código novo (só `admin`) subisse antes, o Evaner perderia o painel na hora. |
| **2** | Deploy do código | A coluna `is_teste` ainda existe, só deixa de ser usada. Nada quebra. |
| **3** | Migration B: `is_admin()`, view, `drop column is_teste` | Se a coluna caísse antes do deploy, o código em produção pediria `is_teste` ao PostgREST e tomaria 400 em todas as telas. |

Dentro da Migration B a ordem também importa: **redefinir a view
`movimentos_estoque` ANTES** de derrubar a coluna, senão o Postgres recusa por
dependência.

---

## Mapa de arquivos

**Apagados:** `src/lib/auth/gate-modulo1.ts` · `src/app/admin/(authed)/dev/layout.tsx` · `scripts/criar-dev.mjs` · `scripts/criar-motorista-teste.mjs`

**Criado:** `src/lib/auth/exigir-admin.ts`

**Movido:** `src/app/admin/(authed)/dev/features/page.tsx` para `src/app/admin/(authed)/features/page.tsx`

**Migrations novas:** `0023_evaner_vira_admin.sql` · `0024_fim_do_is_teste.sql`

**Modificados (os grandes):** `src/lib/admin/queries.ts` (39 ocorrências) · `src/lib/admin/alertas.ts` (13) · `scripts/e2e-modulo1.mjs` (25)

---

### Task 1: Migration A — Evaner vira admin

**Arquivos:** Criar `supabase/migrations/0023_evaner_vira_admin.sql`

- [ ] **Passo 1: escrever a migration**

```sql
-- 0023 — Evaner deixa de ser `dev` e vira `admin`.
--
-- Roda ANTES do deploy do código novo, de propósito: o código em produção
-- ainda aceita admin OU dev, então esta linha é invisível pra ele. O código
-- novo só aceita admin — se subisse primeiro, o Evaner perderia o painel.
--
-- A distinção que sobra é `ve_log`, que já está true pra ele desde a 0022.

update public.profiles set role = 'admin' where role = 'dev';
```

- [ ] **Passo 2: aplicar**

```
node scripts/aplicar-migration.mjs supabase/migrations/0023_evaner_vira_admin.sql
```

- [ ] **Passo 3: conferir em produção que nada quebrou**

Abrir o painel e navegar. Deve funcionar igual (o código antigo aceita admin).
O badge 🧪 DEV some da sidebar e `/admin/dev/features` passa a redirecionar pra
`/admin` — os dois são esperados nesta fase intermediária.

- [ ] **Passo 4: commit**

```
git add supabase/migrations/0023_evaner_vira_admin.sql
git commit -m "feat(papeis): Evaner vira admin - primeira fase do fim do role dev"
```

---

### Task 2: Apagar o gate do Módulo 1

`gate-modulo1.ts` exporta 3 funções usadas em 42 arquivos. Todas viram o mesmo
check de admin.

**Arquivos:** Apagar `src/lib/auth/gate-modulo1.ts` e `src/app/admin/(authed)/dev/layout.tsx` · Criar `src/lib/auth/exigir-admin.ts` · Modificar os 42 importadores

- [ ] **Passo 1: listar quem importa**

```
grep -rl "gate-modulo1" src/
```

- [ ] **Passo 2: criar o helper único**

Criar `src/lib/auth/exigir-admin.ts`:

```ts
import { getSupabaseServer } from "@/lib/supabase/server";
import { podeAcessarAdmin } from "@/lib/auth/roles";

/**
 * Gate único dos endpoints de /api/admin.
 *
 * Substitui o antigo `exigirAcessoModulo1`, que existia só enquanto o
 * Módulo 1 era invisível pro Jean.
 *
 * Checa `ativo` de propósito: quem foi desativado perde a API, não só o
 * painel. Antes isso era inconsistente — `coletas/[id]` não checava.
 */
export async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !profile.ativo || !podeAcessarAdmin(profile)) return null;
  return user;
}
```

- [ ] **Passo 3: nas PÁGINAS — apagar a chamada**

`exigirAcessoModulo1OuRedirect()` sempre foi redundante: o `(authed)/layout.tsx`
barra quem não é admin antes da página rodar. Apagar a linha e o import nas 16
páginas.

Onde a página guardava o retorno (`const { ehDev } = await ...`), apagar a linha
inteira — `ehDev` some na Task 5.

Onde era `acessoModulo1Atual()` (`page.tsx` do dashboard e `motoristas/page.tsx`),
apagar a chamada e substituir os usos de `temAcesso` / `verModulo1` por `true`:
o conteúdo do Módulo 1 passa a ser sempre visível.

- [ ] **Passo 4: nos ENDPOINTS — trocar o import**

Nos 30 endpoints que fazem:

```ts
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";
const exigirAdmin = exigirAcessoModulo1;
```

trocar por:

```ts
import { exigirAdmin } from "@/lib/auth/exigir-admin";
```

`alertas/visto/route.ts` chama `exigirAcessoModulo1()` direto — trocar por
`exigirAdmin()`.

Os 6 endpoints com `exigirAdmin` próprio (`coletas/[id]`, `coletas/bulk-delete`,
`locais`, `locais/[id]`, `motoristas`, `motoristas/[id]`) passam a usar o helper
também — apagar a função local de cada um.

- [ ] **Passo 5: apagar os arquivos**

```
git rm src/lib/auth/gate-modulo1.ts
git rm "src/app/admin/(authed)/dev/layout.tsx"
```

- [ ] **Passo 6: typecheck**

```
npm run typecheck
```

Esperado: 0 erros.

- [ ] **Passo 7: commit**

```
git add -A
git commit -m "refactor(papeis): gate do Modulo 1 vira um exigirAdmin so"
```

---

### Task 3: Apagar `isDev` e `isAdminPuro`

**Arquivos:** `src/lib/auth/roles.ts` · `src/middleware.ts` · `src/app/admin/(authed)/layout.tsx` · `src/components/admin/Sidebar.tsx` · `src/components/admin/FormCriarMotorista.tsx` · `src/app/admin/(authed)/motoristas/page.tsx` · `src/app/api/admin/motoristas/route.ts` · `src/app/api/admin/motoristas/[id]/feature/route.ts`

- [ ] **Passo 1: `roles.ts` fica assim, o arquivo inteiro**

```ts
export type Role = "motorista" | "admin";

export interface ProfileMinimo {
  role: Role | string;
  features?: Record<string, unknown> | null;
  mostra_saldo_app?: boolean | null;
}

/** Admin. Único papel com acesso ao painel. */
export function podeAcessarAdmin(p: ProfileMinimo | null | undefined): boolean {
  return p?.role === "admin";
}

/**
 * Motorista tem uma feature ligada?
 * Feature nova nasce OFF pra todos; o admin liga por motorista em
 * /admin/features conforme aprova.
 */
export function hasFeature(
  p: ProfileMinimo | null | undefined,
  feature: string
): boolean {
  const f = p?.features;
  if (!f || typeof f !== "object") return false;
  return !!(f as Record<string, unknown>)[feature];
}
```

- [ ] **Passo 2: `middleware.ts` linhas 63-64**

De:

```ts
    const rolePermitida =
      profile?.role === "admin" || profile?.role === "dev";
```

Para:

```ts
    const rolePermitida = profile?.role === "admin";
```

- [ ] **Passo 3: `src/app/page.tsx` — nada a fazer**

A linha 20 já é `profile?.role === "admin"`. Era um bug (o dev caía em
`/motorista`); com o papel `dev` extinto, fica correta sozinha. Só conferir.

- [ ] **Passo 4: `(authed)/layout.tsx`**

Apagar `const dev = isDev(profile);`, apagar `const mostrarModulo1 = ...`, apagar
os imports mortos (`isDev`, `MODULO1_LIBERADO_PARA_ADMIN`) e as props `dev` e
`mostrarModulo1` do `<Sidebar>`. **Manter `veLog`.** Apagar o comentário
mentiroso da linha 35 que ainda diz "Estágio 1 (dev-only)".

- [ ] **Passo 5: `Sidebar.tsx`**

Apagar a prop `dev` da interface e da desestruturação; apagar o bloco
`{dev && (<span>🧪 DEV</span>)}` do rodapé; trocar

```tsx
...(dev ? [{ href: "/admin/dev/features", label: "🧪 Features" }] : []),
```

por um item fixo:

```tsx
{ href: "/admin/features", label: "Features" },
```

Apagar a prop `mostrarModulo1` e os `mostrarModulo1 ?` que escondiam grupos.

- [ ] **Passo 6: `FormCriarMotorista.tsx`**

Apagar a prop `ehDev` e o bloco `{ehDev && role === "motorista" && (...)}` que
renderiza o checkbox "motorista de teste". Em `motoristas/page.tsx`, apagar
`ehDev={isDev(viewer)}` e o bloco inteiro que buscava o `viewer` (o
`getSupabaseServer` + `getUser` + query de `profiles`) — some 1 `getUser()` de
brinde.

- [ ] **Passo 7: `api/admin/motoristas/route.ts`**

Apagar `const is_teste = isDev(auth.profile) && body.is_teste === true;` e o
campo `is_teste` do insert.

- [ ] **Passo 8: `api/admin/motoristas/[id]/feature/route.ts`**

Trocar `if (!isDev(profile) || !profile?.ativo)` pelo `exigirAdmin()` da Task 2.

- [ ] **Passo 9: typecheck + commit**

```
npm run typecheck
git add -A
git commit -m "refactor(papeis): apaga isDev e isAdminPuro - role vira motorista|admin"
```

---

### Task 4: Features sai de `/admin/dev` e vira tela normal

**Arquivos:** Mover `src/app/admin/(authed)/dev/features/page.tsx` · Modificar `src/lib/admin/queries.ts`

- [ ] **Passo 1: mover**

```
git mv "src/app/admin/(authed)/dev/features/page.tsx" "src/app/admin/(authed)/features/page.tsx"
```

- [ ] **Passo 2: trocar a fonte de dados**

De `buscarMotoristasTeste()` para `buscarMotoristas()`. A tela passa a listar
**todos** os motoristas, que é o ciclo já documentado em `roles.ts`: "admin liga
pros reais gradualmente quando aprova".

- [ ] **Passo 3: reescrever o cabeçalho**

```tsx
      <h1 className="text-2xl font-bold mb-2">Features por motorista</h1>
      <p className="text-cinza-suave mb-6">
        Liga recurso novo em um motorista de cada vez. Feature nova nasce
        desligada pra todos — ligue em um, acompanhe alguns dias, depois
        estenda. Desligar não apaga nada que já foi lançado.
      </p>
```

Apagar o bloco de estado vazio que mandava rodar `criar-motorista-teste.mjs`, e
a constante `FEATURES_DISPONIVEIS` continua igual.

- [ ] **Passo 4: apagar `buscarMotoristasTeste` de `queries.ts`**

- [ ] **Passo 5: typecheck + commit**

```
npm run typecheck
git add -A
git commit -m "feat(features): painel de features vira tela normal do admin"
```

---

### Task 5: Tirar `is_teste` do código

**Arquivos:** `src/lib/admin/queries.ts` (39) · `src/lib/admin/alertas.ts` (13) · `src/lib/admin/curadoria.ts` (3) · `src/lib/types.ts` · 10 páginas · 8 componentes

- [ ] **Passo 1: `queries.ts` — as três formas que aparecem**

```ts
// 1) parâmetro da assinatura — apagar o campo
opts: { incluirTeste?: boolean } = {}

// 2) filtro no query builder — apagar a linha inteira
if (!opts.incluirTeste) q = q.eq("profiles.is_teste", false);
if (!opts.incluirTeste) qM = qM.eq("is_teste", false);

// 3) campo no select embutido — tirar só `is_teste` da lista de campos
profiles!cargas_motorista_id_fkey!inner(nome, is_teste)
// vira:
profiles!cargas_motorista_id_fkey!inner(nome)
```

⚠️ **Não mexer no `!inner`.** Ele parece existir só pro filtro, mas trocar por
join normal muda LEFT para INNER e some com linhas legítimas.

- [ ] **Passo 2: apagar os campos derivados**

`motorista_is_teste` nas interfaces (`CargaDetalhada` e vizinhas) e a linha que
preenchia no `.map()`:

```ts
      motorista_is_teste: !!r.profiles?.is_teste,
```

- [ ] **Passo 3: componentes — apagar os badges 🧪**

Em `TabelaCargas`, `TabelaDespesas`, `TabelaAbastecimentos`, `TabelaMotoristas`,
`CardCargasAtivas`, `CardDescargasRecentes` e `AdiantamentosPanel`: apagar o
render condicional do 🧪 e o campo correspondente no tipo das props.

- [ ] **Passo 4: `types.ts`** — apagar `is_teste` do tipo de profile.

- [ ] **Passo 5: as chamadas nas páginas**

Apagar todos os `incluirTeste: ehDev` e `incluirTeste: true` das 10 páginas.
Isso resolve de quebra a inconsistência em que `motoristas/page.tsx` e
`eventos/page.tsx` passavam `true` fixo e o Jean via o Teste 1.

- [ ] **Passo 6: typecheck + build + varredura**

```
npm run typecheck
npm run build
grep -rn "is_teste\|incluirTeste" src/
```

Esperado: 0 erros nos dois primeiros, e o `grep` retornando **vazio**.

- [ ] **Passo 7: commit**

```
git add -A
git commit -m "refactor(teste): apaga o conceito de motorista de teste do codigo"
```

---

### Task 6: Blindar a desativação de admin

Hoje o checkbox "Ativo" desliga qualquer um — inclusive você mesmo — sem
confirmação, e a API aceita direto com `service_role`. Sem o papel `dev` não
sobra backdoor: quem se desativar só volta por SQL.

**Arquivos:** `src/app/api/admin/motoristas/[id]/route.ts` · `src/components/admin/TabelaMotoristas.tsx`

- [ ] **Passo 1: bloquear no SERVIDOR (é o que vale)**

Em `PATCH`, logo depois de `const { id } = await params;` e do `const body = await req.json();`:

```ts
  // Desativar admin é caminho sem volta: o middleware tranca na hora e não
  // existe mais o papel `dev` como backdoor. Só SQL traria de volta.
  // Bloqueia no servidor porque desabilitar o checkbox na tela não impede
  // uma chamada direta na API.
  if (body.ativo === false) {
    const { data: alvo } = await getSupabaseAdmin()
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (alvo?.role === "admin") {
      return NextResponse.json(
        { error: "Não dá pra desativar um admin. Mude o papel antes." },
        { status: 400 }
      );
    }
  }
```

⚠️ Este `getSupabaseAdmin()` é **sem `atorId`** e é uma leitura. Não conta como
"criar o cliente duas vezes" pro agrupamento do log, que só olha escrita — mas
se preferir, reuse o `adminClient` já criado abaixo movendo a criação dele pra
cima deste bloco.

- [ ] **Passo 2: refletir na TELA**

Em `TabelaMotoristas.tsx`, no checkbox `ativo`, trocar
`disabled={loadingId === m.id}` por:

```tsx
                  disabled={loadingId === m.id || m.role === "admin"}
                  title={
                    m.role === "admin"
                      ? "Admin não pode ser desativado por aqui"
                      : undefined
                  }
```

- [ ] **Passo 3: commit**

```
git add -A
git commit -m "fix(seguranca): admin nao pode ser desativado pelo painel"
```

- [ ] **Passo 4: testar na mão (depois do deploy da Task 8)**

Na tela de Motoristas, o checkbox "Ativo" deve estar cinza na linha do Jean e na
sua, e funcionar normal na linha de um motorista.

---

### Task 7: Scripts e E2E

- [ ] **Passo 1: apagar os scripts que perderam sentido**

```
git rm scripts/criar-dev.mjs scripts/criar-motorista-teste.mjs
```

- [ ] **Passo 2: `limpar-lancamentos-teste.mjs` — trocar a trava**

A trava dele era `is_teste=true` ("recusa perfil real"). Sem a coluna ele
apagaria lançamento de motorista real calado. Trocar por confirmação explícita:

```js
// A trava antiga era o is_teste, que não existe mais. Agora quem chama
// declara que sabe o que está fazendo — este script APAGA lançamento.
if (!process.argv.includes("--sim-eu-confirmo")) {
  console.error("❌ Este script APAGA lançamentos. Rode com --sim-eu-confirmo");
  process.exit(1);
}
```

- [ ] **Passo 3: `e2e-modulo1.mjs` — as 25 referências**

- Linha 80: tirar `is_teste: true` do insert do bot.
- Linhas 250, 270, 391, 399, 411, 420, 426, 432, 451, 458: apagar
  `.eq("profiles.is_teste", false)` e `.eq("cargas.profiles.is_teste", false)`.
- Nos `SELECT_CARGAS` / `SELECT_DESC` e afins: tirar `is_teste` da lista de
  campos e **manter o `!inner`**.
- **Apagar os 2 checks** que testavam o filtro (linhas ~252 e ~272):
  `"filtro is_teste esconde carga do teste"` e
  `"filtro aninhado is_teste esconde descarga do teste"`. De 55 passa a 53.
- Atualizar o comentário do topo (linha 5), que fala do Teste 1.

⚠️ Consequência aceita: enquanto o E2E roda (~1 min), o dado do bot fica visível
no dashboard. É a mesma escolha de testar com perfil real e apagar depois.

- [ ] **Passo 4: rodar os dois**

```
node scripts/e2e-modulo1.mjs
```

Esperado: **53/53 OK**.

```
node scripts/e2e-modulo2.mjs
```

Esperado: todos OK (read-only, com rollback).

- [ ] **Passo 5: commit**

```
git add -A
git commit -m "test(e2e): E2E deixa de testar o filtro de motorista de teste"
```

---

### Task 8: Deploy, e só depois a Migration B

- [ ] **Passo 1: push**

```
git push
```

Esperado: os 4 jobs do CI verdes. **Esperar o deploy da Vercel terminar (~2 min).**

- [ ] **Passo 2: conferir o painel em produção ANTES de mexer no banco**

Abrir `/admin`, `/admin/cargas`, `/admin/estoque`, `/admin/vendas`,
`/admin/features`, `/admin/log`, `/admin/motoristas`. Todas devem carregar. A
coluna `is_teste` ainda existe, só não é mais usada — se algo quebrar aqui, dá
pra reverter sem tocar no banco.

- [ ] **Passo 3: escrever a Migration B**

Criar `supabase/migrations/0024_fim_do_is_teste.sql`:

```sql
-- 0024 — Fim do `is_teste` e do papel `dev`.
--
-- ⚠️ RODAR SÓ DEPOIS DO DEPLOY do código que não usa mais `is_teste`.
-- Se a coluna cair antes, o código em produção pede `is_teste` ao PostgREST
-- e toma 400 em todas as telas do admin.
--
-- A ORDEM AQUI DENTRO IMPORTA: a view `movimentos_estoque` referencia a
-- coluna. Redefinir a view primeiro, derrubar a coluna depois — senão o
-- Postgres recusa por dependência.

-- 1) is_admin() para de conhecer o papel `dev`.
--    Vira STABLE de propósito: em política RLS, função VOLATILE é
--    reavaliada LINHA A LINHA. Com o volume de hoje isso é invisível; com
--    carga acumulada vira o gargalo do painel.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $funcao$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and ativo = true
  );
$funcao$;

-- 2) A view de estoque para de filtrar motorista de teste.
--    Só o braço das descargas usava o filtro. O join com `profiles`
--    CONTINUA: ele também alimenta `descricao` com o nome do motorista.
--    Corpo copiado da 0017 com a linha `where p.is_teste = false` removida;
--    colunas e ordem idênticas, como o `create or replace view` exige.
create or replace view public.movimentos_estoque
with (security_invoker = true) as

  select
    d.id                                as referencia_id,
    'descarga'::text                    as origem,
    'fino'::text                        as tipo_oleo,
    'entrada'::text                     as especie,
    d.peso_liquido_kg::numeric          as kg,
    coalesce((
      select sum(c.valor_pago) from public.coletas c
      where c.carga_id = d.carga_id
    ), 0)::numeric                      as custo,
    d.criado_em                         as momento,
    (d.criado_em at time zone 'America/Sao_Paulo')::date as dia,
    1                                   as prioridade,
    coalesce(p.nome, '—')               as descricao
  from public.descargas d
  join public.cargas   g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id

  union all

  select
    cd.id, 'compra_direta', cd.tipo_oleo, 'entrada',
    cd.peso_kg, cd.valor,
    cd.data::timestamptz, cd.data, 1,
    cd.fornecedor
  from public.compras_diretas cd
  where cd.entra_no_estoque = true

  union all

  -- Saída de fino e de grosso são linhas separadas: cada estoque tem seu
  -- próprio custo médio, então a mistura precisa sair de cada um.
  select
    v.id, 'venda', 'fino', 'saida',
    v.kg_fino, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_fino > 0

  union all

  select
    v.id, 'venda', 'grosso', 'saida',
    v.kg_grosso, 0::numeric,
    v.data::timestamptz, v.data, 1,
    co.nome
  from public.vendas v
  join public.compradores co on co.id = v.comprador_id
  where v.kg_grosso > 0

  union all

  select
    aj.id, 'ajuste', aj.tipo_oleo, 'ajuste',
    aj.saldo_novo_kg, aj.custo_medio_kg,
    aj.criado_em, aj.data, 2,
    aj.motivo
  from public.ajustes_estoque aj;

-- 3) A coluna sai.
drop index if exists public.idx_profiles_is_teste;
alter table public.profiles drop column if exists is_teste;
```

⚠️ Dois detalhes fáceis de perder aqui, os dois já resolvidos acima: o
`with (security_invoker = true)` (sem ele a view muda de comportamento sob RLS)
e o `join public.profiles`, que continua porque alimenta a coluna `descricao`.

- [ ] **Passo 4: aplicar**

```
node scripts/aplicar-migration.mjs supabase/migrations/0024_fim_do_is_teste.sql
```

Roda em transação — se qualquer statement falhar, nada é aplicado.

- [ ] **Passo 5: conferir estoque e vendas**

Abrir `/admin/estoque` e `/admin/vendas`. Os números devem bater com o que
estava antes. Se a view saiu errada, é aqui que aparece.

- [ ] **Passo 6: rodar os E2E contra o schema novo**

```
node scripts/e2e-modulo1.mjs
node scripts/e2e-modulo2.mjs
```

- [ ] **Passo 7: commit**

```
git add supabase/migrations/0024_fim_do_is_teste.sql
git commit -m "feat(papeis): fim do is_teste e do papel dev no banco"
git push
```

---

### Task 9: Documentação

Sem isso, a próxima sessão lê o `CLAUDE.md` e reintroduz tudo que acabou de sair.

**Arquivos:** `CLAUDE.md` · `ESTADO.md`

- [ ] **Passo 1: `CLAUDE.md` — reescrever a seção "Roles"**

Dois níveis em vez de três. Trocar o aviso dos "4 lugares pra checar ao mexer em
role" — agora é um conceito só. Documentar `ve_log` como a única capacidade
extra e registrar o padrão: **capacidade nova vira coluna, não papel novo.**

- [ ] **Passo 2: `CLAUDE.md` — apagar o que morreu**

A seção do "Motorista de teste (`is_teste=true`)", o parágrafo do
`MODULO1_LIBERADO_PARA_ADMIN` e do estágio dev-only, as menções a
`exigirAcessoModulo1OuRedirect` / `acessoModulo1Atual`, os scripts
`criar-dev.mjs` e `criar-motorista-teste.mjs`, e a regra "Não deixar o E2E
encostar no Teste 1".

- [ ] **Passo 3: `CLAUDE.md` — atualizar a lista de migrations**

Está parada na `0015`. Acrescentar `0016` a `0024`, uma linha cada.

- [ ] **Passo 4: `CLAUDE.md` — registrar as duas decisões**

Em "Coisas que considerei mas descartei":

> ❌ **Papel `dev` separado de `admin`** — existiu enquanto o Módulo 1 era
> invisível pro Jean. Depois do flip virou hierarquia sem função. Decisão do
> Evaner (19/08/2026): capacidade extra vira **coluna** no cadastro (`ve_log`),
> nunca papel novo.
>
> ❌ **Motorista de teste (`is_teste`)** — sandbox invisível pro admin. Decisão
> do Evaner: pra testar, cria-se um perfil normal, testa-se de verdade
> (entrando nos relatórios) e apaga-se depois. Mais simples e mais fiel ao real.

- [ ] **Passo 5: `ESTADO.md`**

Está parado em 14/08 e ainda diz que os módulos são invisíveis pro Jean.
Atualizar: gate liberado em 18/08, esta refatoração, migrations (24) e checks do
E2E (53).

- [ ] **Passo 6: commit**

```
git add CLAUDE.md ESTADO.md
git commit -m "docs: papeis viram motorista|admin, capacidade extra e coluna"
git push
```

---

## Como voltar atrás

- **Depois da Task 1, antes da 8:** `git revert` dos commits de código. O banco
  não mudou de forma relevante (a `0023` só troca o papel do Evaner, e o código
  antigo aceita admin).
- **Depois da Migration B:** a coluna `is_teste` foi embora. Recriar é
  `alter table public.profiles add column is_teste boolean not null default false;`
  — mas quem era teste **não volta**. Hoje isso custa zero: o Teste 1 tem 0
  coletas, 0 cargas, 0 despesas.

## Fora de escopo (de propósito)

- A alteração não commitada em `src/app/sw.ts` — decisão separada, ainda pendente.
- O painel travando de forma intermitente — investigação aberta, sem causa raiz
  confirmada. Nada aqui promete resolver aquilo.
- Os 3 `auth.getUser()` por página — otimização, assunto separado. (A Task 3
  remove um deles de brinde, na tela de Motoristas.)
