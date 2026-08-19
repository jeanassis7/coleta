# Bloco 3 — Frota e documentos

> **Para quem for executar:** passos com checkbox (`- [ ]`). Este projeto **não
> tem framework de teste** — a verificação é `npm run typecheck`, `npm run build`
> e os dois scripts E2E. Não invente `jest`/`vitest`.

**Objetivo:** cadastrar tudo de caminhão e de motorista — manutenção com custo,
documentos com vencimento (CIPP, CIV, IPVA, CNH, toxicológico, cursos) — com
ficha por veículo e por pessoa, e alertas quando algo vence.

**Origem:** `PLANO-MODULO-2.md`, seção "Bloco 3 — Frota e documentos" (SQL nas
linhas 225 e 270, telas na 341, resumo na 377). O desenho estava pronto e nunca
saiu do papel.

**Tudo de uma vez** (decisão do Evaner, 19/08/2026).

---

## Decisões tomadas neste plano

Estão aqui porque o plano original não fechava nenhuma delas. Se discordar de
alguma, é agora.

| # | Decisão | Por quê |
|---|---|---|
| 1 | **Bucket `documentos`, acesso só de `is_admin()`** | "É tudo dado gerencial de gestão, o motorista continua tudo igual" (Evaner). O `fotos-coletas` deixa o motorista ler a pasta dele — foto de portão e CNH não merecem a mesma porta. |
| 2 | **O app do motorista NÃO muda** | Nenhum arquivo em `src/app/motorista/` é tocado. Zero risco pro offline. |
| 3 | **km atual do caminhão = `max(cargas.km_final, abastecimentos.km)`** | Não existe campo "km atual". Essas são as duas fontes reais, e o abastecimento costuma ser mais recente que o fim da carga. |
| 4 | **Manutenção com forma de pagamento gera conta a pagar** | `contas_a_pagar.origem_tipo` **já aceita** `'manutencao'` (0019, linha 66). Só quando não for à vista. |
| 5 | **Documento NÃO gera conta a pagar automaticamente** | Já decidido no plano original (linha 576): vira previsão recorrente, não conta. O campo `valor` guarda quanto custou renovar, pra histórico. |
| 6 | **Migrations são 0025 e 0026** | O plano diz "0019 e 0020", mas contas a pagar furou a fila e tomou a 0019. A numeração do plano está velha. |
| 7 | **Não criar trigger de log na mão** | A 0022 instalou o event trigger `trg_auto_ligar_log`: toda tabela nova em `public` ganha `trg_log_admin` sozinha. Criar na mão dá trigger duplicado. |

---

### Task 1: Migration da manutenção

**Arquivos:** Criar `supabase/migrations/0025_manutencoes.sql`

- [ ] **Passo 1: escrever a migration**

```sql
-- 0025 — Manutenção de veículo.
--
-- Pneu é `tipo = 'pneu'` com a descrição contando o que foi ("4 pneus
-- dianteiros"). Sem estrutura por carcaça, sem posição, sem sulco —
-- cortado pelo Evaner: pra 3-4 caminhões, relatório que ninguém alimenta
-- mente mais do que ajuda.
--
-- NÃO criar trigger de log aqui: o event trigger `trg_auto_ligar_log`
-- (migration 0022) liga sozinho em toda tabela nova de `public`.

create table if not exists public.manutencoes (
  id uuid primary key default gen_random_uuid(),
  caminhao_id uuid not null references public.caminhoes(id),
  data date not null,
  km integer check (km >= 0),
  tipo text not null check (tipo in ('troca_oleo','pneu','revisao','corretiva','outro')),
  descricao text not null,
  valor numeric(10,2) not null check (valor > 0),
  fornecedor text,
  -- Só troca de óleo usa: é o km em que a próxima vence.
  proxima_km integer check (proxima_km > 0),
  foto_path text,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_manutencoes_caminhao
  on public.manutencoes(caminhao_id, data desc);
create index if not exists idx_manutencoes_proxima
  on public.manutencoes(caminhao_id, proxima_km)
  where proxima_km is not null;

alter table public.manutencoes enable row level security;

-- Manutenção é dado de gestão. O motorista não lê nem escreve — não existe
-- tela disso no PWA e não vai existir.
create policy "admin acesso total manutencoes"
  on public.manutencoes for all
  using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Passo 2: aplicar**

```
node scripts/aplicar-migration.mjs supabase/migrations/0025_manutencoes.sql
```

- [ ] **Passo 3: confirmar que o log ligou sozinho**

Rodar no mesmo padrão dos diagnósticos desta sessão: consultar `pg_trigger` e
esperar `trg_log_admin` em `manutencoes`. Se **não** estiver lá, o event
trigger da 0022 falhou e isso é um achado — parar e investigar, não criar na mão.

- [ ] **Passo 4: commit**

```
git add supabase/migrations/0025_manutencoes.sql
git commit -m "feat(frota): tabela de manutencoes"
```

---

### Task 2: Migration dos documentos + bucket

**Arquivos:** Criar `supabase/migrations/0026_documentos.sql`

- [ ] **Passo 1: escrever a migration**

```sql
-- 0026 — Documentos com vencimento, de caminhão OU de motorista.
--
-- Dois FKs anuláveis com CHECK de exatamente um dono, em vez de dono
-- polimórfico por texto: mantém integridade referencial de verdade e o
-- banco impede documento órfão.
--
-- O `tipo` é texto livre no banco mas ENUM NA APLICAÇÃO (src/lib/documentos.ts).
-- Decisão do Evaner: lista fixa, com "outro" como saída de emergência pra
-- ninguém ficar travado num sábado. Texto livre puro garante que um dia
-- apareçam "CIPP", "cipp" e "C.I.P.P." como três coisas no painel.

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
  -- quanto custou renovar. NÃO vira conta a pagar automaticamente
  -- (decisão do plano original): documento vira previsão recorrente.
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
```

- [ ] **Passo 2: aplicar e conferir**

```
node scripts/aplicar-migration.mjs supabase/migrations/0026_documentos.sql
```

Conferir: bucket `documentos` existe com `public = false`, a policy de
`storage.objects` está lá, e `trg_log_admin` apareceu sozinho em `documentos`.

- [ ] **Passo 3: commit**

```
git add supabase/migrations/0026_documentos.sql
git commit -m "feat(frota): documentos com vencimento + bucket privado"
```

---

### Task 3: O enum dos tipos de documento

**Arquivos:** Criar `src/lib/documentos.ts`

Lista fixa **na aplicação**, não no banco — assim acrescentar um tipo é um
deploy, não uma migration.

- [ ] **Passo 1: criar o arquivo**

```ts
/**
 * Tipos de documento — lista fixa, decisão do Evaner.
 *
 * Fica na APLICAÇÃO e não no banco de propósito: acrescentar um tipo vira
 * um deploy em vez de uma migration. E fica fixa em vez de texto livre
 * porque texto livre garante que um dia apareçam "CIPP", "cipp" e
 * "C.I.P.P." como três coisas diferentes no painel.
 *
 * "outro" existe pra ninguém ficar travado num sábado esperando deploy.
 * Ele não agrupa nem gera estatística — e não precisa.
 */
export const TIPOS_DOC_CAMINHAO = [
  { valor: "ipva", label: "IPVA" },
  { valor: "licenciamento", label: "Licenciamento" },
  { valor: "seguro", label: "Seguro" },
  { valor: "civ", label: "CIV" },
  { valor: "cipp", label: "CIPP" },
  { valor: "cronotacografo", label: "Cronotacógrafo" },
  { valor: "antt", label: "ANTT/RNTRC" },
  { valor: "outro", label: "Outro (descreva)" },
] as const;

export const TIPOS_DOC_MOTORISTA = [
  { valor: "cnh", label: "CNH" },
  { valor: "toxicologico", label: "Exame toxicológico" },
  { valor: "mopp", label: "MOPP" },
  { valor: "curso", label: "Curso / reciclagem" },
  { valor: "outro", label: "Outro (descreva)" },
] as const;

export function labelDocumento(tipo: string, descricao?: string | null): string {
  if (tipo === "outro") return descricao?.trim() || "Outro";
  const achado =
    TIPOS_DOC_CAMINHAO.find((t) => t.valor === tipo) ??
    TIPOS_DOC_MOTORISTA.find((t) => t.valor === tipo);
  return achado?.label ?? tipo;
}

export const TIPOS_MANUTENCAO = [
  { valor: "troca_oleo", label: "Troca de óleo" },
  { valor: "pneu", label: "Pneu" },
  { valor: "revisao", label: "Revisão" },
  { valor: "corretiva", label: "Corretiva" },
  { valor: "outro", label: "Outro" },
] as const;
```

- [ ] **Passo 2: `npm run typecheck` + commit**

---

### Task 4: Queries

**Arquivos:** Modificar `src/lib/admin/queries.ts`

- [ ] **Passo 1: `kmAtualPorCaminhao()`**

Não existe campo "km atual". As duas fontes reais são o fim das cargas e o km
dos abastecimentos — e o abastecimento costuma ser mais recente. Uma consulta
só, não uma por caminhão (o N+1 já mordeu este projeto antes):

```ts
/**
 * Km mais alto conhecido de cada caminhão.
 *
 * Não existe campo "km atual" em `caminhoes` — o número vive espalhado em
 * `cargas.km_final` e `abastecimentos.km`. O abastecimento costuma ser mais
 * recente que o fim da carga, então os dois entram e vence o maior.
 *
 * Uma ida ao banco pra todos, não uma por caminhão: o N+1 já deixou este
 * painel em 4s uma vez (ver `saldos_motoristas()`).
 */
export async function kmAtualPorCaminhao(): Promise<Map<string, number>> {
  const supabase = await getSupabaseServer();
  const [{ data: cargas }, { data: abast }] = await Promise.all([
    supabase.from("cargas").select("caminhao_id, km_final").not("km_final", "is", null),
    supabase.from("abastecimentos").select("caminhao_id, km").not("km", "is", null),
  ]);
  const mapa = new Map<string, number>();
  const por = (id: string | null, km: number | null) => {
    if (!id || km == null) return;
    if ((mapa.get(id) ?? 0) < km) mapa.set(id, km);
  };
  for (const c of cargas ?? []) por(c.caminhao_id, c.km_final);
  for (const a of abast ?? []) por(a.caminhao_id, a.km);
  return mapa;
}
```

- [ ] **Passo 2: `buscarManutencoes` e `buscarDocumentos`**

Assinaturas (com as interfaces exportadas, no padrão do resto do arquivo):

```ts
export interface Manutencao {
  id: string; caminhao_id: string; data: string; km: number | null;
  tipo: string; descricao: string; valor: number; fornecedor: string | null;
  proxima_km: number | null; foto_path: string | null; observacao: string | null;
  criado_em: string;
}
export async function buscarManutencoes(
  opts: { caminhao_id?: string } = {}
): Promise<Manutencao[]>   // ordem: data desc

export interface Documento {
  id: string; caminhao_id: string | null; motorista_id: string | null;
  tipo: string; descricao: string | null; vencimento: string;
  valor: number | null; arquivo_path: string | null; alerta_dias: number;
  observacao: string | null; criado_em: string;
}
export async function buscarDocumentos(
  opts: { caminhao_id?: string; motorista_id?: string } = {}
): Promise<Documento[]>    // ordem: vencimento asc (o que vence primeiro no topo)
```

- [ ] **Passo 3: `resumoCaminhao(id, inicio, fim)`**

Retorna `{ km_rodado, litros_combustivel, km_por_litro, gasto_manutencao, gasto_combustivel, gasto_total }`.
Reusar o cálculo de km/L que já existe em `buscarCargas` (km rodado ÷ litros de
combustível) — **não reimplementar**.

- [ ] **Passo 4: typecheck + commit**

---

### Task 5: Endpoints

**Arquivos:** Criar `src/app/api/admin/manutencoes/route.ts`, `.../manutencoes/[id]/route.ts`, `.../documentos/route.ts`, `.../documentos/[id]/route.ts`

- [ ] **Passo 1: seguir o padrão que já existe**

Copiar a forma de `src/app/api/admin/compras/route.ts` (é o mais parecido:
POST com validação + `getSupabaseAdmin(user.id)`). Cada arquivo começa com:

```ts
import { exigirAdmin } from "@/lib/auth/exigir-admin";
```

e no handler:

```ts
  const user = await exigirAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // UM getSupabaseAdmin por handler — é o que agrupa as gravações no log
  const admin = getSupabaseAdmin(user.id);
```

- [ ] **Passo 2: manutenção que não é à vista vira conta a pagar**

No POST de manutenção, aceitar `forma_pagamento` e `vencimento` opcionais. Se
vier vencimento, inserir também em `contas_a_pagar` com
`origem_tipo = 'manutencao'` e `origem_id` = id da manutenção — a coluna já
aceita esse valor desde a 0019.

⚠️ Usar o **mesmo** `admin` client criado no topo, não criar outro: é o que faz
as duas gravações saírem agrupadas como uma operação só no `/admin/log`.

- [ ] **Passo 3: upload do arquivo**

O arquivo vai pro bucket `documentos` pelo **client**, com o path
`documentos/<documento_id ou uuid>/<nome>`. O endpoint só guarda o
`arquivo_path`. Mesma divisão que a foto de coleta já usa.

- [ ] **Passo 4: typecheck + commit**

---

### Task 6: Ficha do caminhão

**Arquivos:** Criar `src/app/admin/(authed)/caminhoes/[id]/page.tsx` · Modificar `src/components/admin/TabelaCaminhoes.tsx`

- [ ] **Passo 1: a lista vira clicável**

Em `TabelaCaminhoes`, a placa vira `<Link href={'/admin/caminhoes/' + c.id}>`.
O `FormCaminhao` de criar continua na listagem.

- [ ] **Passo 2: a ficha**

Blocos, nesta ordem (é a do plano original, linha 341):

1. **Dados e edição** — reusar `FormCaminhao` em modo edição
2. **Próximas manutenções** — troca de óleo com `proxima_km` já passado pelo
   km atual aparece em **vermelho**; perto (faltando ≤ 1.000 km) em amarelo
3. **Histórico de manutenção** + botão de lançar
4. **Documentos** e vencimentos + botão de lançar
5. **Consumo km/L** nas últimas cargas
6. **Gasto total** do caminhão no período

- [ ] **Passo 3: sem popup**

`ModalConfirmar` / `ModalInputTexto` de `src/components/admin/Modais.tsx`.
**`alert()`, `confirm()` e `prompt()` são proibidos** — regra do `CLAUDE.md`.

- [ ] **Passo 4: typecheck + build + commit**

---

### Task 7: Ficha do motorista

**Arquivos:** Criar `src/app/admin/(authed)/motoristas/[id]/page.tsx` · Modificar `src/components/admin/TabelaMotoristas.tsx`

- [ ] **Passo 1: o nome vira link** na tabela de motoristas

- [ ] **Passo 2: a ficha** — dados, documentos (CNH, toxicológico, MOPP,
  cursos) com vencimento e botão de lançar, e **link** pro histórico de
  dinheiro que já existe em `/admin/adiantamentos/[id]` (não duplicar aquela
  tela aqui).

- [ ] **Passo 3: typecheck + build + commit**

---

### Task 8: Alertas novos

**Arquivos:** Modificar `src/lib/admin/alertas.ts`

Seis alertas, no mesmo tom didático dos que já existem (o que aconteceu →
hipóteses de causa → o que fazer). O `alertas_vistos` já cuida do "OK, VI", e a
chave é a **ocorrência** (id do registro).

- [ ] **Passo 1: documento vencido ou vencendo** (caminhão e motorista)

Vencido = severidade `alta`. Vencendo dentro de `alerta_dias` = `media`.
Chave: `documento:<id>`.

- [ ] **Passo 2: caminhão passou do km da troca de óleo**

Comparar `kmAtualPorCaminhao()` com o maior `proxima_km` de
`tipo = 'troca_oleo'` daquele caminhão. Chave: `manutencao_km:<caminhao_id>`.

- [ ] **Passo 3: os três de cheque**

- vence essa semana e não foi depositado
- venceu e continua na carteira
- devolvido ainda não resolvido

- [ ] **Passo 4: estoque negativo**

Saldo negativo em fino ou grosso é sinal de que está na hora de contar o
tanque — texto tem que dizer isso, não acusar erro.

- [ ] **Passo 5: NÃO criar alerta de comprador devendo**

Cortado pelo Evaner no plano original: a conta corrente já está na tela de
compradores, e alerta ruidoso ensina a ignorar alerta.

- [ ] **Passo 6: typecheck + commit**

---

### Task 9: Os 3 KPIs de topo

**Arquivos:** Modificar `src/app/admin/(authed)/page.tsx` e `src/components/admin/KpiCardsComDelta.tsx`

Estavam no desenho do Bloco 2 e ficaram pra trás: **estoque** (kg e valor),
**a receber**, **cheques em carteira**. As três contas já existem
(`estoque_atual()`, `saldo_compradores()`, tabela `cheques`).

- [ ] **Passo 1: buscar em paralelo** com o que o dashboard já busca (`Promise.all`),
  não em sequência.
- [ ] **Passo 2: typecheck + build + commit**

---

### Task 10: E2E

**Arquivos:** Modificar `scripts/e2e-modulo2.mjs`

- [ ] **Passo 1: cobrir manutenção** — lançar com `forma_pagamento` a prazo e
  conferir que nasceu a conta a pagar com `origem_tipo='manutencao'`.
- [ ] **Passo 2: cobrir documento** — o CHECK `um_dono_so` recusa documento com
  os dois donos e recusa com nenhum.
- [ ] **Passo 3: cobrir o alerta de km** — troca de óleo com `proxima_km`
  abaixo do km atual acende; acima não acende.
- [ ] **Passo 4: medir DELTA, nunca total absoluto** — os E2E rodam contra
  produção; asserção absoluta quebra sozinha quando o Jean lança algo.
- [ ] **Passo 5: rodar os dois E2E**

```
node scripts/e2e-modulo1.mjs
```

Esperado: 55/55 (este bloco não mexe em nada do Módulo 1).

```
node scripts/e2e-modulo2.mjs
```

- [ ] **Passo 6: commit**

---

### Task 11: Deploy e documentação

- [ ] **Passo 1: `git push`** — esperar CI verde e o deploy da Vercel (~2 min)
- [ ] **Passo 2: conferir em produção** — `/admin/caminhoes/[id]`,
  `/admin/motoristas/[id]`, lançar uma manutenção e um documento de verdade,
  ver o alerta nascer
- [ ] **Passo 3: `CLAUDE.md`** — acrescentar `0025` e `0026` na lista de
  migrations, as rotas novas no mapa, o bucket `documentos` no ciclo de vida
  dos dados, e a regra "tabela nova ganha log sozinha, não criar trigger na mão"
- [ ] **Passo 4: `ESTADO.md`** — Bloco 3 sai de "pendências", entra em "o que existe"
- [ ] **Passo 5: commit + push**

---

## Como voltar atrás

Nada aqui é destrutivo: são duas tabelas novas, um bucket novo e telas novas.
`git revert` do código e `drop table public.manutencoes, public.documentos`
devolvem o estado anterior. Nenhuma tabela existente muda de forma.

## Fora de escopo (de propósito)

- **O app do motorista** — nenhum arquivo em `src/app/motorista/` é tocado.
- **Motorista ver a própria CNH vencendo no app** — seria feature nova, não
  foi pedida. Se um dia for, o bucket precisa de uma policy a mais.
- **Rastreio de pneu por carcaça e medição de sulco** — cortados pelo Evaner
  no plano original.
- **O travamento intermitente do painel** — investigação aberta, sem causa raiz.
- **Os 3 `auth.getUser()` por página** — otimização, assunto separado.
