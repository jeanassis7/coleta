# Estado do projeto — onde paramos

> Atualizado em 14/08/2026, no fim da sessão do Módulo 2.
> Ler junto com `CLAUDE.md` (contexto permanente), `PLANO-MODULO-1.md` e
> `PLANO-MODULO-2.md`.

---

## Resumo em uma frase

**Módulo 1 (Cargas) e Módulo 2 (Estoque, Vendas, Cheques, Contas a pagar)
estão inteiros no ar, invisíveis pro Jean**, esperando teste de campo do
Evaner. Os motoristas reais usam só a coleta — e acabaram de ganhar a lista
"Coletas dessa carga", que é a primeira mudança em produção com gente de
verdade dependendo.

---

## Números

| | |
|---|---|
| Migrations aplicadas | 20 (`0001` → `0020`) |
| Páginas admin | 22 |
| Telas do motorista | 9 |
| Endpoints de API | 33 |
| Linhas em `src/` | ~23.000 |
| Commits | 53 |
| Checks automatizados | 55 (Módulo 1) + ~30 (Módulo 2) |

---

## O que existe

### Motorista (PWA, offline-first)

**No ar pros motoristas reais (Luis, Lucimar):** login, nova coleta com GPS
silencioso e sugestão de local por proximidade, foto comprimida, fila
offline no IndexedDB, sync automático em 4 gatilhos, e a lista
**"Coletas dessa carga"** com total de litros e total pago.

**Atrás de `features.carga` (só o Teste 1 hoje):** iniciar carga, barra do
caminhão, abastecimento (com posto por GPS e "PAGUEI AGORA / ASSINEI A
NOTA"), despesa, descarregar e cancelar carga.

**Atrás de `features.saldo`:** aceite de adiantamento e card "Seu dinheiro".

### Admin (dev-only, atrás do gate)

- **Dashboard** — alertas didáticos, cargas ativas, descargas recentes, KPIs
- **Estoque** — fino e grosso, saldo, custo médio ponderado móvel, inventário
- **Vendas** — peso da balança, mistura, preço, entrega e pagamento
- **Cheques** — carteira por "bom para", depositar/compensar/repassar/voltou
- **Contas a pagar** — a pagar, previstas, pagas, recorrentes
- **Compradores** — conta corrente com saldo explicado em linhas + ficha
- **Cargas** — tabela densa + drill-down com mapa, linha do tempo e fotos
- **Abastecimentos · Despesas · Compra direta · Adiantamentos**
- **Caminhões · Motoristas · Curadoria de locais · Eventos**
- **`/admin/dev/features`** — toggles por motorista de teste

---

## Testes

**CI no GitHub Actions**, a cada push: typecheck, build e os dois E2E.
Segredos cadastrados — os quatro jobs rodam de verdade.

- `scripts/e2e-modulo1.mjs` — **55 checks**. Cria e apaga o próprio motorista
  descartável ("E2E Bot"). Nunca encosta no Teste 1.
- `scripts/e2e-modulo2.mjs` — read-only: simula dentro de transação e dá
  ROLLBACK. Cobre a matemática do custo médio, venda baixando os dois
  estoques, cheque devolvido, contas a pagar e geração idempotente.

**O que os testes NÃO cobrem** (e é o buraco real): nada roda no navegador.
Zero cobertura de Service Worker, fila offline e sync — a parte mais
arriscada do sistema é verificada só pelo Evaner com o celular no modo
avião. Ver "Dívidas" abaixo.

---

## Pendências reais

### Só o Evaner pode fazer

1. **Testar o Módulo 2 em produção** — estoque, venda, cheque, contas a pagar.
   Nada disso foi usado com dado real ainda.
2. **Avisar o Luis e o Lucimar** antes/depois do deploy da lista nova — eles
   vão ver o histórico voltando do servidor de uma vez.
3. **Calibrar o zoom do mapa** do drill-down (precisa de carga real espalhada).
4. **O flip pro Jean** — `MODULO1_LIBERADO_PARA_ADMIN` em
   `src/lib/auth/gate-modulo1.ts`. **Não perguntar quando** — ele avisa.
5. **Ligar `features.carga`** nos motoristas reais (ele disse: "dentro de
   alguns dias").

### Em aberto, sem decisão

6. **Umidade não desconta nada** — espera a máquina de medir.
7. **OCR de cheque em lote** — desenhado no plano, não implementado. Precisa
   de `ANTHROPIC_API_KEY` no Vercel.
8. **Manutenção, pneus e documentos com vencimento** — Bloco 3 do Módulo 2,
   desenhado no plano, não implementado.
9. **Fichas de caminhão e motorista** (`/admin/caminhoes/[id]`,
   `/admin/motoristas/[id]`) — Bloco 3.

### Módulo 3 — Salários (só no papel)

Decidido: é módulo de **cadastro**, não de cálculo de folha. Vem do contador,
o Evaner lança, o sistema calcula o vale, anexa o recibo assinado e baixa do
saldo. Comissão tem **versão** (V1/V2) e nada é recalculado pra trás.

Em aberto: a regra da comissão (hoje 200 L, vai mudar) e se 200 L é bloco
fechado ou proporcional.

### Depois disso

Caixa consolidado → DRE → fluxo de caixa projetado. Contas a pagar já
entrega metade do caminho.

---

## Dívidas técnicas

1. **Nenhum teste roda no navegador.** O fluxo offline — Service Worker,
   IndexedDB, sync — é o mais complexo e o mais arriscado, e é testado só na
   mão. Playwright cobrindo modo avião: ~4-6h de trabalho. **Fazer antes de
   ligar features nos motoristas reais**, porque a partir daí uma regressão
   ali não é incômodo, é coleta perdida no meio do Paraná.
2. **Os E2E rodam contra produção** — é o único ambiente que existe. Está
   mitigado (bot descartável, rollback), mas um projeto Supabase separado pra
   teste resolveria de vez.
3. **Sem monitoramento de erro centralizado** — só `app_events`.
4. **Backup PITR do Supabase** — free tier tem 7 dias.
5. **ESLint nunca foi configurado** — o CI pula lint por isso.

---

## Como o Evaner trabalha (pra próxima sessão não errar)

- Ele decide o escopo; eu recomendo, ele corta. Prefere recortar a adicionar.
- Quer **debate antes de código** em qualquer coisa que envolva modelagem — e
  a conversa costuma melhorar o desenho. O posto por GPS, a conta corrente
  por comprador e o previsto × real nasceram assim.
- **Revisa o plano tecnicamente** e acha buracos reais (o cheque devolvido
  levando o pix junto, o custo médio derretendo depois de saldo negativo).
- Testa em produção com o celular. O que ele acha em 10 minutos, nenhum teste
  automatizado acha.
- **Não pedir pra liberar pro Jean.** Quando for a hora, ele avisa.
