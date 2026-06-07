/**
 * Gera o PDF "Manual do Coleta — Guia para o Jean"
 * Rodar: node scripts/gerar-tutorial-pdf.mjs
 * Saída: tutorial-coleta.pdf na raiz
 */

import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { join } from "node:path";

const VERDE = "#16a34a";
const VERDE_ESCURO = "#15803d";
const CINZA_TEXTO = "#0f172a";
const CINZA_SUAVE = "#64748b";
const CINZA_FUNDO = "#f1f5f9";
const AMARELO = "#fef3c7";
const AMARELO_BORDA = "#f59e0b";

const ROOT = process.cwd();
const SAIDA = join(ROOT, "tutorial-coleta.pdf");
const ICONE = join(ROOT, "public", "icons", "icon-512.png");

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 60, bottom: 60, left: 60, right: 60 },
  info: {
    Title: "Manual do Coleta",
    Author: "Evaner",
    Subject: "Guia rápido para o Jean usar o painel admin",
  },
});

doc.pipe(createWriteStream(SAIDA));

// ============================================================================
// Helpers de layout
// ============================================================================

function tituloPagina(texto) {
  doc
    .fillColor(VERDE_ESCURO)
    .fontSize(24)
    .font("Helvetica-Bold")
    .text(texto, { align: "left" })
    .moveDown(0.3);
  const y = doc.y;
  doc
    .moveTo(60, y)
    .lineTo(200, y)
    .lineWidth(3)
    .strokeColor(VERDE)
    .stroke();
  doc.moveDown(0.8);
}

function secao(numero, texto) {
  doc.moveDown(0.5);
  if (doc.y > 720) doc.addPage();
  doc
    .fillColor(VERDE_ESCURO)
    .fontSize(15)
    .font("Helvetica-Bold")
    .text(`${numero}.  ${texto}`, { align: "left" })
    .moveDown(0.4);
}

function paragrafo(texto, opcoes = {}) {
  doc
    .fillColor(CINZA_TEXTO)
    .fontSize(11)
    .font("Helvetica")
    .text(texto, { align: "left", lineGap: 3, ...opcoes })
    .moveDown(0.6);
}

function destaqueObs(texto) {
  doc.moveDown(0.3);
  const startY = doc.y;
  const altura = doc.heightOfString(texto, { width: 460, lineGap: 3 }) + 16;
  doc.rect(60, startY, 475, altura).fillAndStroke(AMARELO, AMARELO_BORDA);
  doc
    .fillColor(CINZA_TEXTO)
    .fontSize(10.5)
    .font("Helvetica")
    .text(texto, 68, startY + 8, { width: 460, lineGap: 3 });
  doc.y = startY + altura;
  doc.moveDown(0.8);
}

function caixaInfo(linhas) {
  const startY = doc.y;
  const altura = linhas.length * 16 + 16;
  doc
    .rect(60, startY, 475, altura)
    .fillAndStroke(CINZA_FUNDO, "#cbd5e1");
  let y = startY + 10;
  for (const { label, valor } of linhas) {
    doc
      .fillColor(CINZA_SUAVE)
      .fontSize(10)
      .font("Helvetica")
      .text(label, 70, y, { width: 130, continued: false });
    doc
      .fillColor(CINZA_TEXTO)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(valor, 210, y, { width: 320 });
    y += 16;
  }
  doc.y = startY + altura;
  doc.moveDown(0.7);
}

function listaBullet(itens) {
  for (const item of itens) {
    doc
      .fillColor(CINZA_TEXTO)
      .fontSize(11)
      .font("Helvetica")
      .text(`•  ${item}`, { align: "left", lineGap: 3, indent: 8 })
      .moveDown(0.2);
  }
  doc.moveDown(0.4);
}

function listaNumerada(itens) {
  let n = 1;
  for (const item of itens) {
    doc
      .fillColor(CINZA_TEXTO)
      .fontSize(11)
      .font("Helvetica")
      .text(`${n}.  ${item}`, { align: "left", lineGap: 3, indent: 8 })
      .moveDown(0.2);
    n++;
  }
  doc.moveDown(0.4);
}

function quebraSePerto(bottomThreshold = 720) {
  if (doc.y > bottomThreshold) doc.addPage();
}

// ============================================================================
// Capa
// ============================================================================

// Fundo verde topo
doc.rect(0, 0, 595, 280).fill(VERDE);

// Logo: gota verde do app, em branco sobre fundo verde
// Usa o PNG real do app, com fundo transparente fica difícil — solução:
// desenhar gota com primitivas PDF, branca sobre o verde
doc.fillColor("white");
// Gota desenhada com caminho — formato simples:
// começa no topo, sobe pra meio, faz arco até o fundo, fecha
const cx = 110;
const cy = 130;
doc.path(
  `M ${cx} ${cy - 45} ` +
  `C ${cx + 25} ${cy - 15}, ${cx + 35} ${cy + 5}, ${cx + 35} ${cy + 25} ` +
  `C ${cx + 35} ${cy + 45}, ${cx + 18} ${cy + 60}, ${cx} ${cy + 60} ` +
  `C ${cx - 18} ${cy + 60}, ${cx - 35} ${cy + 45}, ${cx - 35} ${cy + 25} ` +
  `C ${cx - 35} ${cy + 5}, ${cx - 25} ${cy - 15}, ${cx} ${cy - 45} Z`
).fill("white");

// Título
doc
  .fillColor("white")
  .fontSize(36)
  .font("Helvetica-Bold")
  .text("Manual do", 180, 110);
doc
  .fillColor("white")
  .fontSize(54)
  .font("Helvetica-Bold")
  .text("Coleta", 180, 150);
doc
  .fillColor("white")
  .fontSize(14)
  .font("Helvetica")
  .text("Guia rápido para o Jean", 180, 220);

// Subinfo no corpo
doc.y = 340;
doc
  .fillColor(CINZA_TEXTO)
  .fontSize(13)
  .font("Helvetica")
  .text(
    "App de coleta de óleo lubrificante usado. Pra você, gestor, no computador. E pro Luis, Lucimar, Lucinei em campo no celular.",
    60,
    340,
    { width: 475, lineGap: 4 }
  );

doc.moveDown(2);

// Sumário
doc
  .fillColor(VERDE_ESCURO)
  .fontSize(14)
  .font("Helvetica-Bold")
  .text("O que tem aqui dentro", { align: "left" })
  .moveDown(0.5);

const sumario = [
  "Seus acessos e senhas",
  "Como o motorista vai usar (primeiro acesso + lançar coleta)",
  "O painel admin (suas 5 abas)",
  "Rollout da foto (importante!)",
  "Operação semanal — sua rotina",
  "Editando e deletando coletas",
  "Problemas comuns e como resolver",
  "URLs resumo",
  "Quando precisar de ajuda",
];

let nn = 1;
for (const item of sumario) {
  doc
    .fillColor(CINZA_TEXTO)
    .fontSize(11)
    .font("Helvetica")
    .text(`${nn}.  ${item}`, { indent: 8, lineGap: 3 })
    .moveDown(0.15);
  nn++;
}

// Rodapé capa
doc
  .fillColor(CINZA_SUAVE)
  .fontSize(9)
  .font("Helvetica")
  .text("Feito pelo Evaner pro Jean · 2026", 60, 770);

// ============================================================================
// 1 — Seus acessos
// ============================================================================
doc.addPage();
tituloPagina("1. Seus acessos");

paragrafo("Guarda essa página. Tem tudo que você e os motoristas precisam pra entrar.");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Painel admin (você, no computador)")
  .moveDown(0.3);

caixaInfo([
  { label: "Link:", valor: "coleta-inky.vercel.app/admin/login" },
  { label: "Email:", valor: "jean@coleta.local" },
  { label: "Senha:", valor: "Progevaner123$" },
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("App dos motoristas (eles, no celular)")
  .moveDown(0.3);

caixaInfo([
  { label: "Link único:", valor: "coleta-inky.vercel.app/motorista" },
]);

doc.moveDown(0.3);

doc
  .fillColor(CINZA_TEXTO)
  .fontSize(11)
  .font("Helvetica-Bold")
  .text("Logins de cada motorista:")
  .moveDown(0.4);

caixaInfo([
  { label: "Luis", valor: "luis@coleta.local        senha: volante" },
  { label: "Lucimar", valor: "lucimar@coleta.local     senha: tanque" },
  { label: "Lucinei", valor: "lucinei@coleta.local     senha: lanterna" },
]);

destaqueObs(
  "Os emails são só identificadores internos. Não precisam ser reais — não existe caixa de email associada."
);

// ============================================================================
// 2 — Como o motorista vai usar
// ============================================================================
doc.addPage();
tituloPagina("2. Como o motorista vai usar");

paragrafo(
  "Você vai estar junto deles na primeira vez (frente a frente). O passo a passo é simples:"
);

secao("2.1", "Primeiro acesso — instalando o app no celular do motorista");

listaNumerada([
  "Pega o celular dele (Android) e abre o Chrome.",
  "Digita: coleta-inky.vercel.app/motorista",
  "Vai aparecer a tela de login. Coloca o email e senha dele (da seção 1).",
  'Toca em "ENTRAR".',
  "Caiu na tela inicial do app (logo verde da gota + botão NOVA COLETA).",
  'Vai aparecer um banner pequeno "Instalar app" — toca em "INSTALAR".',
  'O Chrome vai pedir confirmação — toca "Instalar" / "Adicionar".',
  "Pronto — agora tem um ícone do app (a gota verde) na tela inicial do celular dele.",
  "Sai do navegador e abre pelo ícone. A partir de agora ele usa SEMPRE pelo ícone, não pelo navegador.",
]);

destaqueObs(
  "A sessão fica salva pra sempre. Ele só vai precisar logar de novo se: trocar de celular, apagar o app, ou se você resetar a senha."
);

secao("2.2", "Como ele lança uma coleta");

listaNumerada([
  "Abre o app (pelo ícone da gota).",
  'Toca no botão verde gigante "NOVA COLETA".',
  "Digita quantos litros coletou (ex: 50).",
  'Escolhe o certificado: "Não emitiu" / "Sim, mas só uma parte" / "Sim, pelos 50L".',
  "Se for parcial, digita quantos litros foram pro certificado.",
  "Digita ou escolhe o nome do local.",
  "Digita quanto pagou no total (ex: 100).",
  'Tira foto (se o "exige foto" estiver ativado pra ele — ver seção 4).',
  "(Opcional) digita observação.",
  'Toca "SALVAR COLETA".',
  "Tela de confirmação ✓ → volta pro início.",
]);

destaqueObs(
  "SUGESTÃO AUTOMÁTICA DE LOCAL: depois que você curar os locais (ver seção 3.3), o app vai sugerir o local automaticamente baseado no GPS. Ele só toca e seleciona — sem digitar."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("O que acontece em segundo plano (motorista não vê)")
  .moveDown(0.3);

listaBullet([
  "GPS é capturado automaticamente.",
  "Foto é comprimida pra economizar dados móveis (~50KB).",
  "Tudo salvo no celular instantaneamente.",
  "Sync automático com o servidor quando tem rede.",
  "Se ele estiver sem sinal (rural): salva no celular, sincroniza sozinho quando voltar 4G.",
  "Aparece pra ele um botão '📤 Enviar agora' caso queira forçar o envio.",
]);

// ============================================================================
// 3 — Painel admin
// ============================================================================
doc.addPage();
tituloPagina("3. O painel admin (suas 5 abas)");

paragrafo(
  "Quando você entrar em coleta-inky.vercel.app/admin, vai ver 5 abas no topo:"
);

// DASHBOARD
secao("3.1", "Dashboard");

paragrafo("A visão geral. Sempre que abrir o painel, é aqui que cai.");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Filtros (no topo):")
  .moveDown(0.3);

listaBullet([
  "Período: Hoje, Semana (dom→sáb da semana atual), Mês (dia 1 ao fim do mês atual), Customizado.",
  "Motorista: filtra por um motorista específico ou todos.",
  "Tudo recalcula junto. URL guarda estado (dá pra compartilhar link de uma view específica).",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("KPIs (6 cards no topo):")
  .moveDown(0.3);

listaBullet([
  "Coletas, Litros, Total pago, R$/litro, Motoristas, % com GPS.",
  "Setinha verde = bom (subiu litros, caiu custo).",
  "Setinha vermelha = atenção (custo subiu, GPS caiu).",
  "Comparação é vs MESMO intervalo no período anterior (ex: dias 1-6 desse mês vs dias 1-6 do mês passado — comparação justa).",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Painéis abaixo:")
  .moveDown(0.3);

listaBullet([
  "Por motorista (volume): barras horizontais — quem coletou mais.",
  "Custo R$/L por motorista: ordenado do mais barato pro mais caro. Quem paga melhor preço?",
  "Certificado emitido: % de LITROS que entraram no certificado, por motorista.",
  "Top 15 locais: ranking por litros coletados. Clica num local → mostra quebra por motorista.",
  "Lista/Mapa: alterna entre lista de coletas e visão de mapa.",
  "Exportar CSV: gera planilha pra Excel/Sheets.",
]);

// MAPA
quebraSePerto(650);
secao("3.2", "Mapa");

paragrafo("Visão geográfica completa. Pra entender ONDE estão seus clientes.");

listaBullet([
  "Gotas verdes com badge: locais já cadastrados (curados). O número é quantas visitas teve no período.",
  "Pins coloridos por motorista: coletas que ainda não foram vinculadas a um local oficial. A cor diz qual motorista foi.",
  "Hover (passa o mouse): mostra rápido nome + nº de visitas.",
  "Click: mostra detalhes completos (motoristas que foram, última visita, total litros, total pago).",
]);

// CURADORIA
quebraSePerto(650);
secao("3.3", "Curadoria — seu trabalho semanal de 10 min");

paragrafo("Aqui é onde os dados ficam limpos. Funciona assim:");

paragrafo(
  "Cada vez que um motorista digita um local novo (ex: 'Mecânica Silva'), a coleta entra na fila de curadoria. Outras vezes ele pode digitar variações ('Mec Silva', 'Mecanica Silva')."
);

paragrafo(
  "O sistema agrupa automaticamente essas variações em CLUSTERS baseado em:"
);

listaBullet([
  "Proximidade GPS (raio 80m).",
  "Nome similar (ignora maiúsculas, acentos, espaços).",
]);

paragrafo("Pra cada cluster, você:");

listaNumerada([
  "Olha os nomes que os motoristas digitaram (mostra tudo).",
  "Define um NOME OFICIAL (geralmente o mais comum).",
  "Define o RAIO de match (50m padrão; 30m em centro urbano; 100m em rural).",
  "(Opcional) escreve NOTAS internas — tel do dono, horários, observações.",
  "Clica em 'Criar e vincular as X coletas'.",
]);

destaqueObs(
  "Esse passo é o segredo do app evoluir sozinho. Depois que você curou 'Mecânica Silva', toda vez que um motorista voltar lá, vai aparecer SUGESTÃO automática — ele só toca e salva. Sem digitação."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Plano de curadoria recomendado")
  .moveDown(0.3);

listaBullet([
  "Semana 1-2: motoristas só digitando. Sem curadoria ainda.",
  "Semana 3: primeira rodada. Cria os 10-15 locais mais visitados.",
  "Semana 4+: 5-10 min toda semana, curando os novos.",
  "Em 2-3 meses: 80% das coletas já tem sugestão automática.",
]);

// MOTORISTAS
quebraSePerto(650);
secao("3.4", "Motoristas");

paragrafo("Gerencia quem pode usar o app.");

listaBullet([
  "+ Adicionar motorista: cria conta nova. Email auto-gerado (ex: pedro@coleta.local). Senha temporária você escolhe.",
  "Toggle Ativo: liga/desliga sem deletar. Conta desativada não pode logar.",
  "Toggle Exige foto: controla se aquele motorista precisa tirar foto (ver seção 4).",
  "Senha visível: clica em '👁 mostrar' pra ver a senha. Útil quando o motorista esquecer.",
  "Resetar senha: define uma nova senha pro motorista.",
  "Deletar: apaga o motorista. Pede pra digitar o nome pra confirmar. Se tiver coletas, pergunta de novo se quer apagar tudo junto.",
]);

// EVENTOS
quebraSePerto(650);
secao("3.5", "Eventos");

paragrafo("Log de coisas que aconteceram no app dos motoristas. Útil pra debug.");

listaBullet([
  "gps_denied: motorista negou permissão de localização.",
  "gps_timeout: GPS demorou demais (>10s). Comum em primeiro uso ou cobertura ruim.",
  "gps_error: erro técnico (raro).",
  "sync_failure: falhou ao sincronizar coleta com servidor.",
  "login / logout / app_install: ações normais, só pra histórico.",
  "foto_toggle_changed: você ligou/desligou o 'exige foto'.",
]);

paragrafo("Filtros: por tipo e por motorista.");

// ============================================================================
// 4 — Rollout da foto
// ============================================================================
doc.addPage();
tituloPagina("4. Rollout da foto (importante!)");

paragrafo("A ideia é começar SEM foto e ligar pra cada motorista gradualmente.");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Por quê?")
  .moveDown(0.3);

paragrafo(
  "Pra não dar a sensação inicial de 'estão me vigiando' / 'querem me substituir'. Quando eles já estiverem usando o app de boa e sentindo que é uma ferramenta deles, aí a foto entra naturalmente."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Plano sugerido")
  .moveDown(0.3);

listaBullet([
  "Semana 1 a 3: TODOS com 'exige foto' OFF.",
  "Semana 4: liga em UM motorista só (canário). Acompanha 3-4 dias se reclama, se a foto fica útil.",
  "Semana 5: liga nos outros dois.",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Como ligar")
  .moveDown(0.3);

paragrafo(
  "Vai em Motoristas → encontra o motorista → marca o checkbox na coluna 'Exige foto'. Pronto."
);

paragrafo(
  "O motorista vê o efeito automaticamente na próxima vez que abrir o app — sem precisar reinstalar nada."
);

// ============================================================================
// 5 — Operação semanal
// ============================================================================
doc.addPage();
tituloPagina("5. Operação semanal — sua rotina");

paragrafo("O mínimo pra manter o app funcionando bem:");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Diariamente (1-2 min)")
  .moveDown(0.3);

listaBullet([
  "Abre o Dashboard.",
  "Olha se entrou coleta hoje (KPI 'Coletas').",
  "Vê o R$/litro médio. Tá razoável?",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Semanalmente (10-15 min)")
  .moveDown(0.3);

listaBullet([
  "Aba Curadoria: cura os clusters da semana.",
  "Aba Mapa: vê se tem coletas 'soltas' (sem local) que precisam atenção.",
  "Confere o ranking 'Custo R$/L por motorista'. Algum motorista pagando bem mais caro? Pode ser hora de conversar.",
  "Confere o ranking 'Certificado emitido'. Algum motorista certificando pouco volume? Vale entender o motivo.",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Mensalmente (5 min)")
  .moveDown(0.3);

listaBullet([
  "Filtra Mês no Dashboard.",
  "Clica em 'Exportar CSV' — salva pra contabilidade / análise.",
  "Confere a comparação 'vs mês anterior'.",
]);

// ============================================================================
// 6 — Editando e deletando
// ============================================================================
doc.addPage();
tituloPagina("6. Editando e deletando coletas");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Editar uma coleta")
  .moveDown(0.3);

listaNumerada([
  "No Dashboard → aba Lista → clica na coleta.",
  "Abre um drawer lateral com os detalhes.",
  "Clica em '✏️ Editar coleta'.",
  "Pode alterar: litros, nome do local, valor pago, certificado, observação.",
  "NÃO pode alterar: motorista, foto, GPS, data (campos de auditoria).",
  "Clica em 'Salvar'.",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Deletar uma coleta")
  .moveDown(0.3);

listaNumerada([
  "Mesmo drawer → embaixo, '🗑 Excluir coleta'.",
  "Confirma digitando o nome do local exato.",
  "Sumiu permanentemente (foto, GPS, registro — tudo).",
]);

destaqueObs(
  "Use com cuidado. Exclusão é definitiva. Se for só um erro de digitação, prefira EDITAR ao invés de deletar."
);

// ============================================================================
// 7 — Problemas comuns
// ============================================================================
doc.addPage();
tituloPagina("7. Problemas comuns e como resolver");

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Motorista esqueceu a senha")
  .moveDown(0.3);

paragrafo(
  "Vai em Motoristas → encontra o nome → clica em 'Resetar senha'. Digita uma nova (pode ser a mesma de antes). Avisa ele."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Motorista trocou de celular e não consegue logar")
  .moveDown(0.3);

paragrafo(
  "Abre o link no celular novo (coleta-inky.vercel.app/motorista), entra com email + senha, e instala o app de novo."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("GPS não está pegando ('sem GPS' na lista)")
  .moveDown(0.3);

paragrafo(
  "Vai em Eventos, filtra por gps_denied / gps_timeout / gps_error pra ver o motivo:"
);

listaBullet([
  "denied: motorista negou permissão. Tem que ir nas Configurações do celular dele e liberar localização pro app.",
  "timeout: GPS demorou >10s. Comum em primeiro uso após instalação OU em lugar com cobertura ruim. Normalmente passa nas próximas coletas.",
  "error: erro técnico raro. Manda print pro Evaner.",
]);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Coleta não chegou no painel")
  .moveDown(0.3);

paragrafo(
  "Provavelmente o motorista lançou offline (sem sinal). Pede pra ele abrir o app e ver se aparece um botão '📤 Enviar agora' na tela inicial. Se sim, ele toca pra forçar."
);

paragrafo(
  "Se mesmo com o botão não funcionar, vê em Eventos se tem sync_failure recente — vai mostrar o motivo no payload."
);

doc
  .fillColor(VERDE_ESCURO)
  .fontSize(12)
  .font("Helvetica-Bold")
  .text("Quero adicionar um quarto motorista")
  .moveDown(0.3);

paragrafo(
  "Vai em Motoristas → '+ Adicionar motorista'. Preenche nome, email (auto-gera), senha temporária. Pronto."
);

// ============================================================================
// 8 — URLs resumo + 9 — Ajuda
// ============================================================================
doc.addPage();
tituloPagina("8. URLs resumo");

caixaInfo([
  { label: "App principal:", valor: "coleta-inky.vercel.app" },
  { label: "Seu login:", valor: "coleta-inky.vercel.app/admin/login" },
  { label: "App motorista:", valor: "coleta-inky.vercel.app/motorista" },
]);

doc.moveDown(1);

tituloPagina("9. Quando precisar de ajuda");

paragrafo(
  "Se algo quebrar, travar ou der erro estranho: manda print no WhatsApp pro Evaner. Inclui:"
);

listaBullet([
  "O que você estava fazendo quando aconteceu.",
  "Print da tela do erro (ou descrição do que apareceu).",
  "Se foi com você (admin) ou com algum motorista (e qual).",
]);

paragrafo("Quanto mais detalhe, mais rápido a gente resolve.");

doc.moveDown(2);

// Bloco final
const startY2 = doc.y;
const altura2 = 80;
doc.rect(60, startY2, 475, altura2).fill(VERDE);
doc
  .fillColor("white")
  .fontSize(13)
  .font("Helvetica-Bold")
  .text("Boa, Jean!", 75, startY2 + 15);
doc
  .fillColor("white")
  .fontSize(11)
  .font("Helvetica")
  .text(
    "Te ajudei a montar uma ferramenta que vai economizar muito tempo de planilha e dar visibilidade real do negócio. Aproveita.",
    75,
    startY2 + 38,
    { width: 445, lineGap: 3 }
  );

doc
  .fillColor(CINZA_SUAVE)
  .fontSize(9)
  .font("Helvetica")
  .text(
    "Manual gerado em 2026-06-06 · Versão v1 do app Coleta · Feito pelo Evaner",
    60,
    770,
    { align: "center", width: 475 }
  );

doc.end();

console.log(`✓ PDF gerado em: ${SAIDA}`);
