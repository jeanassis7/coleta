# Estado do projeto — onde paramos

> Atualizado em 19/08/2026, no fim da sessão do módulo financeiro.
> Ler junto com `CLAUDE.md` (contexto permanente), `PLANO-MODULO-1.md` e
> `PLANO-MODULO-2.md`.

---

## Resumo em uma frase

**Módulos 1, 2, 3 (frota e documentos) e o módulo FINANCEIRO estão no ar.**
O sistema fecha o ciclo inteiro: entra óleo → vira estoque → vira venda →
vira dinheiro → vira DRE. Os papéis foram reduzidos a dois (`motorista` e
`admin`), com `ve_log` como única diferença entre Jean e Evaner.

**Mas quase nada rodou com dado real ainda** — 0 cargas, estoque zerado,
nenhuma conta financeira cadastrada. O sistema está à frente da operação.

---

## Números

| | |
|---|---|
| Migrations aplicadas | 30 (`0001` → `0030`) |
| Páginas admin | 22 |
| Telas do motorista | 9 |
| Endpoints de API | 33 |
| Linhas em `src/` | ~23.000 |
| Checks automatizados | 55 (Módulo 1) + ~30 (Módulo 2) |

---

## O que existe

### Motorista (PWA, offline-first)

**No ar pros motoristas reais (Luis, Lucimar):** login, nova coleta com GPS
silencioso e sugestão de local por proximidade, foto comprimida, fila
offline no IndexedDB, sync automático em 4 gatilhos, e a lista
**"Coletas dessa carga"** com total de litros e total pago.

**Atrás de `features.carga` (nenhum motorista real ainda):** iniciar carga, barra do
caminhão, abastecimento (com posto por GPS e "PAGUEI AGORA / ASSINEI A
NOTA"), despesa, descarregar e cancelar carga.

**Atrás de `features.saldo`:** aceite de adiantamento e card "Seu dinheiro".

### Admin (o Jean já usa tudo)

- **Dashboard** — alertas didáticos, cargas ativas, descargas recentes, KPIs
- **Estoque** — fino e grosso, saldo, custo médio ponderado móvel, inventário
- **Vendas** — peso da balança, mistura, preço, entrega e pagamento
- **Cheques** — carteira por "bom para", depositar/compensar/repassar/voltou
- **Contas a pagar** — a pagar, previstas, pagas, recorrentes
- **Compradores** — conta corrente com saldo explicado em linhas + ficha
- **Cargas** — tabela densa + drill-down com mapa, linha do tempo e fotos
- **Abastecimentos · Despesas · Compra direta · Adiantamentos**
- **Caminhões · Motoristas · Curadoria de locais · Eventos**
- **Ficha do caminhão** (`/admin/caminhoes/[id]`) — próxima troca de óleo por km com semáforo, km/L e gasto do mês, histórico de manutenção e documentos
- **Ficha do motorista** (`/admin/motoristas/[id]`) — CNH, toxicológico, MOPP, cursos, com vencimento e arquivo anexado
- **`/admin/caixa`** — saldo por conta, dinheiro na mão dos motoristas, transferências (saque/depósito)
- **`/admin/lancamentos`** — o que já saiu, no ritmo do extrato, com filtros
- **`/admin/dre`** — painel por regime de caixa, com abertura por pessoa
- **`/admin/remuneracao`** — vigências de salário/comissão + cálculo da comissão do período
- **`/admin/features`** — liga feature por motorista (rollout gradual)
- **`/admin/log`** — quem fez o quê (só quem tem `ve_log`; hoje só o Evaner)

---

## Testes

**CI no GitHub Actions**, a cada push: typecheck, build e os dois E2E.
Segredos cadastrados — os quatro jobs rodam de verdade.

- `scripts/e2e-modulo1.mjs` — **55 checks**. Cria e apaga o próprio motorista
  descartável ("E2E Bot"). Enquanto roda (~1 min) o dado dele fica visível no
  painel — o conceito de motorista invisível deixou de existir em 19/08.
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
   Em 19/08 as tabelas ainda estavam zeradas.
2. **Calibrar o zoom do mapa** do drill-down (precisa de carga real espalhada).
3. **Ligar `features.carga`** nos motoristas reais, em `/admin/features` — um
   de cada vez. Antes disso, **cadastrar os caminhões de verdade**: hoje só
   existe o AAA-0000 de teste, e sem caminhão o motorista não inicia carga.
4. **Limpar o resto do dado de teste** — o caminhão AAA-0000 e o perfil
   Teste 1. Ele disse que faz na mão.

### As 7 correções do NEGOCIO.md

Em **19/08/2026** o Evaner conferiu **131 regras de negócio** uma a uma (ver
`NEGOCIO.md`, Parte XII). Saíram 7 divergências entre o que a operação faz e
o que o software faz:

1. **Coleta de R$ 0** — o banco recusa (`check valor_pago > 0`), mas óleo
   doado deve poder ser lançado com zero
2. **Comissão sobre os litros da DESCARGA**, não das coletas — muda quanto
   cada motorista recebe
3. **Receita do DRE por RECEBIMENTO**, não pela data da venda
4. **Painel de caixa com o patrimônio inteiro** — falta valor do estoque,
   óleo nos caminhões, cheques em aberto, e um preço de referência editável
5. **Cheque:** repassar exige despesa, e devolver reverte a conta a pagar
6. **Alertas:** remover 2 de cheque, mudar "dinheiro parado" pra 15 dias
7. **O sistema lembra do vale** do acerto na hora de pagar o salário

### Aberto sem causa raiz

**O painel travou de forma intermitente em 19/08** — telas presas no esqueleto
por 20-30s, inclusive o login. Investigado a fundo e **descartados com
medição**: banco (0 linhas, RLS em 0,055ms), Supabase (135-200ms), Service
Worker (limpo, continuou), JS quebrado (React estava hidratado). Os motoristas
trabalhavam normalmente na mesma janela, então não foi queda de plataforma.
**Se curou sozinho**, o que aponta pra algo com janela de tempo (rate limit ou
estado de sessão). Se voltar: F12 → Network com Preserve log + Console, é o
que falta pra fechar.

Suspeita não confirmada: a sidebar tem 21 `<Link>`, o Next faz prefetch de
todos, e o middleware roda `auth.getUser()` (ida de rede) + query de
`profiles` em CADA requisição — ~45 chamadas ao Supabase por abertura de
página. Otimização pendente: `prefetch={false}` na sidebar e colapsar os 3
`getUser()` em um.

### Feito nesta sessão (19/08/2026)

- **Bloco 3 — frota e documentos.** Manutenção com custo, documentos com
  vencimento (CIPP, CIV, IPVA, CNH, toxicológico, cursos), as duas fichas,
  alertas de vencimento e de km, e os 3 KPIs de topo.
- **OCR de cheque em lote.** Sobe até 10 fotos, monta a lista de conferência
  com a foto ao lado, e só lança o que for ticado. Usa **OpenAI** (decisão do
  Evaner: já paga por ela). Falta `OPENAI_API_KEY` na Vercel — sem ela o
  botão some e o lançamento manual funciona igual.
- **Módulo financeiro inteiro** — caixa, lançamentos, DRE e remuneração.
  Migrations 0027 a 0030.
- **NEGOCIO.md** — 131 regras de negócio conferidas uma a uma pelo Evaner.

### Em aberto, sem decisão

1. **Umidade não desconta nada** — espera a máquina de medir.
2. **Checklist ao iniciar carga** — o Evaner quer, mas decidiu deixar pra
   depois.
3. **Kit de emergência** (carga perigosa) — mesma coisa.

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
- **Ele quer o diagnóstico antes do conserto.** Uma sessão anterior saiu
  mexendo em tudo sem causa raiz e ele perdeu a confiança no resultado.
  Medir, mostrar o número, e só então propor.
