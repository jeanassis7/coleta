# Estado do projeto — onde paramos

> Atualizado em 13/08/2026, no fim da sessão do Módulo 1.
> Ler junto com `CLAUDE.md` (contexto permanente) e `PLANO-MODULO-1.md` (o plano e o que mudou dele).

---

## Resumo em uma frase

O **Módulo 1 (Cargas/ERP) está inteiro no ar em produção, invisível pro Jean**, esperando o teste de campo do Evaner. O próximo módulo é **Vendas + Estoque**, ainda não desenhado.

---

## O que existe hoje

**Motorista (PWA)** — com `features.carga` ligada: iniciar carga (boas-vindas → caminhão + km + foto do painel), home com barra do caminhão, coleta, abastecimento, despesa, descarregar (peso + km final + antiburros) e cancelar carga. Com `features.saldo` ligada: tela de aceite de adiantamento e card "Seu dinheiro". Coleta, despesa, abastecimento e descarga são **offline-first**; iniciar carga é a única ação que exige sinal.

**Admin (sidebar com grupos)** — Dashboard (alertas didáticos + cargas ativas + descargas recentes + KPIs), Cargas (tabela + drill-down com mapa do trajeto, linha do tempo e fotos), Abastecimentos, Despesas, Compra direta, Adiantamentos (+ histórico por motorista), Caminhões, Motoristas, e o painel dev de features.

**Verificação:** `node scripts/e2e-modulo1.mjs` — 51 checks contra produção. Rodar após qualquer mexida no módulo.

---

## Pendências reais

### Só o Evaner pode fazer (não dá pra automatizar)

1. ~~**Teste do modo avião**~~ — **FEITO em 13/08/2026 e aprovado.** O fluxo inteiro (coleta, despesa, abastecimento e descarga sem sinal, fechar e reabrir o app, e o sync automático quando o sinal voltou) funcionou. Um bug real apareceu e foi corrigido: as telas de confirmação e de carga encerrada recebiam parâmetros na URL, o Service Worker nunca tinha aquela URL em cache e o navegador mostrava "não é possível acessar esse site" — o dado estava salvo, mas assustava. Agora essas telas recebem os dados por sessionStorage e a URL é fixa.
2. **Calibrar o zoom do mapa** do drill-down — é calculado pela distância entre os pontos; só olhando uma carga real com pontos espalhados dá pra saber se ficou bom. Pendente.
3. **O flip pro Jean** — `MODULO1_LIBERADO_PARA_ADMIN` em `src/lib/auth/gate-modulo1.ts`. **Não fazer sem ordem explícita dele, e não ficar perguntando quando é** — ele avisa. Depois disso, ligar as features nos motoristas reais, um por vez.

### Em aberto, sem decisão

4. **Umidade não desconta nada** — o campo existe e é lançado, mas a fórmula de desconto depende da máquina de medir que a empresa ainda não tem.
5. **Comissão de motorista** — mencionada de passagem, nunca modelada. A separação entre coleta (motorista) e compra direta (empresa) já foi feita pensando nisso.

### Risco conhecido, baixo

6. Compra direta marcada como "não entra no estoque" pode disparar o alerta de peso divergente (a balança acusa óleo que não está nas coletas). É raro, o "OK, VI" resolve. Se virar rotina, incluir a compra na conta do esperado.

---

## Próximo módulo: Vendas + Estoque

Nada foi desenhado ainda. O que já está decidido e vale de entrada:

- **Estoque é em KG** (a balança é a fonte). Litros só como referência (÷ 0,9).
- **Três portas de entrada no estoque, cada lote entra por exatamente uma:**
  1. Descarga (óleo pesado dentro de uma carga)
  2. Compra direta pesada (`unidade = kg`)
  3. Compra direta estimada (`unidade = litros`, converte por 0,9)
  A flag `compras_diretas.entra_no_estoque = false` existe pro caso raro do óleo ter ido junto numa carga que ainda vai pesar — ali o peso conta na descarga.
- **Saída do estoque é a venda**, que ainda não existe.
- Compradores são as fundições (Perfilaz, Vissoto, Lazzarin, PR Alumínio…). Venda gera recebível — à vista ou cheque.

Perguntas que provavelmente abrem o brainstorm: a venda sai do estoque na saída do caminhão ou na entrega? Cheque é um por venda ou vários escalonados? Preço é por kg sempre? Tem frete? Quem emite nota?

Depois de Vendas/Estoque vêm, na ordem do brainstorm original: **Cheques a receber → Caixa consolidado → DRE → Fluxo de caixa projetado**.

---

## Como o Evaner trabalha (pra próxima sessão não errar)

- Ele decide o escopo; eu recomendo, ele corta. Prefere recortar a adicionar.
- Quer **debate antes de código** em qualquer coisa que envolva modelagem — e a conversa costuma melhorar o desenho (o corte do "óleo em carga ativa" e a máscara de dinheiro nasceram assim).
- Testa em produção com o celular dele. O que ele acha em 10 minutos de uso, nenhum teste automatizado acha.
- **Não pedir pra liberar pro Jean.** Quando for a hora, ele avisa.
