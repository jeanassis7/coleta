"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { getLocalDB } from "@/lib/db/dexie";
import { captureGPS, checkPermissionsState, type GpsResult } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { triggerSyncAfterSave } from "@/lib/sync/trigger";
import { getDeviceId, getSessionId, APP_VERSION } from "@/lib/device/device-id";
import { formatBRL } from "@/lib/format";
import { InputInteiro } from "@/components/InputInteiro";
import { CertificadoPicker } from "@/components/motorista/CertificadoPicker";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import { SugestaoLocal } from "@/components/motorista/SugestaoLocal";
import { getCargaAtivaCached } from "@/lib/motorista/carga";
import type { CertificadoTipo, ColetaLocal } from "@/lib/types";

/**
 * Nome do local sem acento, sem caixa e sem espaço sobrando.
 *
 * "Mateus", "mateus " e "MATEÚS" são o mesmo cliente na cabeça dele — e
 * comparar cru deixaria a duplicata passar por causa de um espaço.
 */
function normalizarLocal(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/s+/g, " ");
}

/** "hoje às 15:41", "ontem às 15:41" ou "31/08 às 15:41". */
function quandoFoi(ts: number): string {
  const d = new Date(ts);
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const dia = (x: Date) =>
    x.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  if (dia(d) === dia(hoje)) return `hoje às ${hora}`;
  if (dia(d) === dia(ontem)) return `ontem às ${hora}`;
  return `${d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  })} às ${hora}`;
}

export default function NovaColetaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [exigeFoto, setExigeFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [litros, setLitros] = useState<number | null>(null);
  const [cert, setCert] = useState<{
    tipo: CertificadoTipo | null;
    litrosCert: number | null;
  }>({ tipo: null, litrosCert: null });
  const [localNome, setLocalNome] = useState("");
  const [localId, setLocalId] = useState<string | null>(null);
  const [valor, setValor] = useState<number | null>(null);
  const [valorFormatado, setValorFormatado] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [observacao, setObservacao] = useState("");

  // GPS começa a ser capturado já na abertura da tela (em paralelo ao preenchimento).
  // Quando motorista termina de digitar, geralmente o GPS já resolveu.
  const [gpsResultado, setGpsResultado] = useState<GpsResult | null>(null);

  useEffect(() => {
    if (!motoristaId) return;
    let cancelado = false;
    captureGPS().then((r) => {
      if (!cancelado) setGpsResultado(r);
    });
    return () => {
      cancelado = true;
    };
  }, [motoristaId]);

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    const ef = sessionStorage.getItem("coleta_exige_foto");
    if (!id) {
      router.push("/motorista");
      return;
    }

    // Gate do fluxo de carga: se a feature tá ligada e NÃO há carga ativa,
    // não pode coletar (coleta ficaria órfã de carga). A home resolve o
    // estado e manda pro "Iniciar carga". Cobre acesso direto por URL.
    try {
      const featuresRaw = localStorage.getItem("coleta_perfil_features");
      const features = featuresRaw
        ? (JSON.parse(featuresRaw) as Record<string, unknown>)
        : {};
      if (features.carga && !getCargaAtivaCached(id)) {
        router.push("/motorista");
        return;
      }
    } catch {
      // features ilegível — segue fluxo antigo
    }

    setMotoristaId(id);
    setExigeFoto(ef === "true");
    logEvent(id, "nova_coleta_opened", {
      exige_foto: ef === "true",
    });
  }, [router]);

  // ---------------------------------------------------------------------
  // CADEIA DE AVISOS (validada pelo Evaner em 22/08/2026)
  // ---------------------------------------------------------------------
  // Regra dele: "ele vai chegar, digitar e ir embora". Então:
  //  - o aviso NUNCA aparece enquanto digita — só ao tocar SALVAR;
  //  - aqui não existe mais TRAVA nenhuma: o campo já rejeita ponto e
  //    vírgula (InputInteiro), então o que sobra é estranho-mas-possível,
  //    e estranho-mas-possível se confirma no segundo toque;
  //  - cada confirmação vale só pro aviso que está na tela: a cadeia roda
  //    de novo e o próximo aviso ainda aparece (senão um engole o outro).
  const [avisosConfirmados, setAvisosConfirmados] = useState<string[]>([]);
  const [aviso, setAviso] = useState<{
    tipo: string;
    texto: string;
    /** Sem isto todo aviso vira "Confere o lançamento" — e o de duplicata
     *  precisa dizer na cara o que ele é. */
    titulo?: string;
  } | null>(null);
  // "Falta a foto" é diferente de "confere o lançamento": falta não se
  // confirma, se preenche. Por isso é um estado separado — senão o botão
  // ofereceria "SALVAR ASSIM MESMO" com campo obrigatório vazio.
  const [falta, setFalta] = useState<string | null>(null);

  /** Editou qualquer campo: os avisos voltam do zero. */
  function limparAvisos() {
    setAviso(null);
    setFalta(null);
    setAvisosConfirmados([]);
  }

  const podeSalvar =
    !!motoristaId &&
    litros !== null &&
    cert.tipo !== null &&
    (cert.tipo !== "parcial" || (cert.litrosCert !== null && cert.litrosCert > 0)) &&
    localNome.trim().length > 0 &&
    valor !== null &&
    (!exigeFoto || foto !== null) &&
    !salvando;

  /** O que falta pra poder salvar — o botão diz, em vez de ficar cinza mudo. */
  function oQueFalta(): string | null {
    if (litros === null) return "Falta dizer quantos litros.";
    if (cert.tipo === null) return "Falta dizer o certificado.";
    if (cert.tipo === "parcial" && !cert.litrosCert)
      return "Falta os litros do certificado.";
    if (localNome.trim().length === 0) return "Falta o nome do local.";
    if (valor === null) return "Falta quanto você pagou.";
    if (exigeFoto && foto === null) return "Falta a foto.";
    return null;
  }

  // Abaixo disso não existe coleta de verdade — mas AVISA, não trava:
  // oficina pequena com 15 L acontece (decisão do Evaner, 22/08).
  const LITROS_MINIMO = 20;
  // A maior coleta real da operação foi 2.225 L. Acima de 3.000 é quase
  // sempre um zero a mais (300 digitado como 3000).
  const LITROS_MAXIMO = 3000;
  // Faixa de preço praticada. Nos lançamentos reais quase tudo cai entre
  // R$ 1,25 e R$ 1,85 por litro — fora dessa faixa, ou os litros ou o
  // valor está errado. Só AVISA: preço envelhece, bloqueio antigo travaria
  // o motorista na estrada.
  const RS_POR_LITRO_MINIMO = 0.5;
  const RS_POR_LITRO_MAXIMO = 4;

  async function salvar() {
    if (salvando) return;
    if (!podeSalvar || !motoristaId || litros === null || valor === null || !cert.tipo) {
      setFalta(oQueFalta() ?? "Confere os campos antes de salvar.");
      return;
    }
    setFalta(null);

    // Confirma o aviso que está na tela e roda a cadeia de novo — cada
    // "SALVAR ASSIM MESMO" vale só pro aviso que ele está vendo.
    const confirmados = aviso
      ? [...avisosConfirmados, aviso.tipo]
      : avisosConfirmados;
    if (aviso) {
      setAvisosConfirmados(confirmados);
      setAviso(null);
    }
    const L = (n: number) => n.toLocaleString("pt-BR");

    // -----------------------------------------------------------------
    // DUPLICATA — o primeiro aviso da cadeia, porque é o mais caro
    // -----------------------------------------------------------------
    // Caso real (01/09/2026): o Lucimar lançou "Mateus, 800 L, R$ 1.280"
    // às 15:41 e de novo às 17:38, de outra cidade, 8,5 km depois. Não foi
    // toque duplo — foram 1h58 de intervalo, e no meio disso o app dele
    // recarregou 12 vezes: ele conferiu, não viu a coleta na lista e
    // lançou de novo. Por isso a regra NÃO tem janela de tempo: é o trio
    // exato (local + litros + valor) dentro da MESMA carga. Repetir os
    // três por acaso numa carga é raro; quando acontece de verdade, o
    // segundo toque passa.
    //
    // Lê a fila local — funciona offline. O histórico da carga é
    // reabastecido do servidor na home (reabastecerHistoricoLocal), então
    // pega também os dias anteriores da mesma carga. Se não achar, não
    // avisa: errar pra menos aqui é só perder um aviso, nunca travar.
    if (!confirmados.includes("duplicada")) {
      try {
        const cargaAgora = getCargaAtivaCached(motoristaId);
        const alvo = normalizarLocal(localNome);
        const iguais = await getLocalDB()
          .coletas_locais.filter(
            (c) =>
              c.motorista_id === motoristaId &&
              (cargaAgora ? c.carga_id === cargaAgora.id : true) &&
              Number(c.litros) === litros &&
              Number(c.valor_pago) === valor &&
              normalizarLocal(c.local_nome) === alvo
          )
          .toArray();
        if (iguais.length > 0) {
          const ant = iguais.sort((a, b) => b.criado_em - a.criado_em)[0];
          setAviso({
            tipo: "duplicada",
            titulo: "⚠️ Você já lançou isso nessa carga",
            texto:
              `${ant.local_nome} · ${L(ant.litros)} L · ${formatBRL(ant.valor_pago)}, ` +
              `${quandoFoi(ant.criado_em)}. Se for uma coleta nova mesmo, aperta de novo.`,
          });
          return;
        }
      } catch {
        // Banco local indisponível: segue sem o aviso.
      }
    }

    if (!confirmados.includes("litros_baixo") && litros < LITROS_MINIMO) {
      setAviso({ tipo: "litros_baixo", texto: `Você digitou ${L(litros)} L de óleo.` });
      return;
    }
    if (!confirmados.includes("litros_alto") && litros > LITROS_MAXIMO) {
      setAviso({ tipo: "litros_alto", texto: `Você digitou ${L(litros)} L de óleo.` });
      return;
    }
    if (
      !confirmados.includes("cert_maior") &&
      cert.litrosCert !== null &&
      cert.litrosCert > litros
    ) {
      setAviso({
        tipo: "cert_maior",
        texto: `Você digitou ${L(cert.litrosCert)} L no certificado e ${L(litros)} L de óleo.`,
      });
      return;
    }
    const rsPorLitro = valor / litros;
    if (
      !confirmados.includes("preco") &&
      (rsPorLitro < RS_POR_LITRO_MINIMO || rsPorLitro > RS_POR_LITRO_MAXIMO)
    ) {
      setAviso({
        tipo: "preco",
        texto: `Tem certeza que foi ${L(litros)} L e você pagou ${formatBRL(valor)} nessa coleta?`,
      });
      return;
    }

    setSalvando(true);

    const client_id = uuid();
    const criado_em = Date.now();

    // Se GPS já resolveu durante o preenchimento, usa de cara. Senão marca pendente.
    const gpsJaResolvido = gpsResultado;
    // Se motorista tem carga ativa (features.carga=true), vincula coleta a ela.
    // Se não tem features ligado, cargaAtiva volta null e carga_id fica null.
    const cargaAtiva = getCargaAtivaCached(motoristaId);
    const coleta: ColetaLocal = {
      client_id,
      motorista_id: motoristaId,
      litros,
      local_nome: localNome.trim(),
      local_id: localId,
      valor_pago: valor,
      certificado_tipo: cert.tipo,
      litros_certificado: cert.litrosCert,
      observacao: observacao.trim() || null,
      latitude: gpsJaResolvido?.ok ? gpsJaResolvido.latitude : null,
      longitude: gpsJaResolvido?.ok ? gpsJaResolvido.longitude : null,
      gps_accuracy: gpsJaResolvido?.ok ? gpsJaResolvido.accuracy : null,
      gps_capturado: gpsJaResolvido?.ok ?? false,
      gps_pendente: gpsJaResolvido === null, // só pendente se ainda não resolveu
      device_id: getDeviceId(),
      session_id: getSessionId(),
      app_version: APP_VERSION,
      criado_em,
      foto_blob: foto,
      foto_subida: false,
      registro_subido: false,
      tentativas: 0,
      ultimo_erro: null,
      carga_id: cargaAtiva?.id ?? null,
    };

    const db = getLocalDB();
    try {
      await db.coletas_locais.add(coleta);
    } catch (e) {
      // O celular recusou gravar (memória cheia, duas janelas do app
      // abertas durante uma atualização). Sem isto o botão ficava
      // travado em "Salvando..." e nada aparecia na tela.
      setSalvando(false);
      setFalta(
        "O celular não conseguiu guardar o lançamento. Feche o aplicativo e abra de novo — se continuar, fala com o Jean."
      );
      return;
    }

    // Loga o save local — útil pra debug
    await logEvent(motoristaId, "coleta_saved_local", {
      client_id,
      tem_foto: foto !== null,
      gps_ja_resolvido: gpsJaResolvido !== null,
      gps_ok: gpsJaResolvido?.ok ?? false,
      gps_accuracy: gpsJaResolvido?.ok ? gpsJaResolvido.accuracy : null,
      tem_local_id: localId !== null,
      tem_observacao: observacao.trim().length > 0,
      certificado_tipo: cert.tipo,
    });

    // Loga GPS bem-sucedido se já tinha
    if (gpsJaResolvido && gpsJaResolvido.ok) {
      await logEvent(motoristaId, "gps_success", {
        coleta_client_id: client_id,
        accuracy: gpsJaResolvido.accuracy,
      });
    }

    // Se GPS já falhou na captura inicial, loga
    if (gpsJaResolvido && !gpsJaResolvido.ok) {
      const permState = await checkPermissionsState();
      await logEvent(
        motoristaId,
        gpsJaResolvido.failure?.kind === "denied"
          ? "gps_denied"
          : gpsJaResolvido.failure?.kind === "timeout"
          ? "gps_timeout"
          : "gps_error",
        {
          coleta_client_id: client_id,
          permissions_state: permState,
          code: gpsJaResolvido.failure?.code,
          message: gpsJaResolvido.failure?.message,
          kind: gpsJaResolvido.failure?.kind,
        }
      );
    }

    // Navega já — GPS pendente e sync ficam em background.
    // O código vai por sessionStorage e a URL fica fixa: com parâmetro na
    // URL, o Service Worker não achava a página no cache e o motorista
    // sem sinal via erro do navegador (bug real de campo).
    sessionStorage.setItem("coleta_ultima_cid", client_id);
    router.push("/motorista/confirmacao");

    // Se ainda não tinha GPS no momento do save, continua tentando
    if (!gpsJaResolvido) {
      (async () => {
        const gps = await captureGPS();
        if (gps.ok) {
          await db.coletas_locais.update(client_id, {
            latitude: gps.latitude,
            longitude: gps.longitude,
            gps_accuracy: gps.accuracy,
            gps_capturado: true,
            gps_pendente: false,
          });
          await logEvent(motoristaId, "gps_success", {
            coleta_client_id: client_id,
            accuracy: gps.accuracy,
            via: "background_after_save",
          });
        } else {
          await db.coletas_locais.update(client_id, {
            gps_pendente: false,
          });
          const permState = await checkPermissionsState();
          await logEvent(
            motoristaId,
            gps.failure?.kind === "denied"
              ? "gps_denied"
              : gps.failure?.kind === "timeout"
              ? "gps_timeout"
              : "gps_error",
            {
              coleta_client_id: client_id,
              permissions_state: permState,
              code: gps.failure?.code,
              message: gps.failure?.message,
              kind: gps.failure?.kind,
            }
          );
        }
        triggerSyncAfterSave();
      })();
    } else {
      // GPS já estava pronto — dispara sync direto
      triggerSyncAfterSave();
    }
  }

  // Editou litros ou valor: a cadeia de avisos recomeça do zero — senão o
  // segundo toque passaria batido com o número novo ainda errado.
  function trocarLitros(v: number | null) {
    setLitros(v);
    limparAvisos();
  }
  function trocarValor(v: number | null) {
    setValor(v);
    limparAvisos();
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <header className="flex items-center mb-6 mt-2">
        <button
          onClick={() => router.back()}
          className="text-cinza-suave text-lg p-2 -ml-2"
        >
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold ml-2">Nova Coleta</h1>
      </header>

      <div className="space-y-6">
        {/* 1. LITROS */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Quantos litros?
          </label>
          <InputInteiro
            valor={litros}
            onChange={trocarLitros}
            autoFocus
            sufixo="L"
          />
        </div>

        {/* 2. CERTIFICADO */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Entregou certificado?
          </label>
          <CertificadoPicker
            litros={litros}
            valor={cert}
            onChange={setCert}
          />
        </div>

        {/* 3. LOCAL */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Nome do local?
          </label>
          <SugestaoLocal
            nomeAtual={localNome}
            setNomeAtual={setLocalNome}
            onSelecionar={({ local_id, nome }) => {
              setLocalId(local_id);
              setLocalNome(nome);
            }}
          />
        </div>

        {/* 4. VALOR */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Quanto pagou no total?
          </label>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-cinza-texto">R$</span>
            <div className="flex-1">
              {/* Valor de coleta é VALOR CHEIO (decisão do Evaner: 100, 125,
                  200). O campo não aceita vírgula nem ponto — o erro do
                  "520,12 virando 52.012" deixa de ser digitável. */}
              <InputInteiro valor={valor} onChange={trocarValor} />
            </div>
          </div>
          {valor !== null && (
            <p className="text-base text-cinza-suave mt-1 text-right">
              {formatBRL(valor)}
            </p>
          )}
        </div>

        {/* 5. FOTO (condicional) */}
        {exigeFoto && motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              Foto da fachada/portão
            </label>
            <FotoPicker onChange={setFoto} motoristaId={motoristaId} />
          </div>
        )}

        {/* 6. OBSERVAÇÃO */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Algo a observar? <span className="text-cinza-suave text-base">(opcional)</span>
          </label>
          <textarea
            className="input-grande min-h-[100px] resize-none"
            placeholder=""
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
          />
        </div>

        {/* O aviso nasce ACIMA do botão e empurra ele pra baixo: duplo
            toque acidental não confirma nada sem ele ver. */}
        {falta && (
          <div className="bg-alerta/10 border-2 border-alerta rounded-2xl p-4">
            <p className="text-lg font-bold text-alerta">{falta}</p>
          </div>
        )}

        {aviso && !falta && (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4">
            <p className="text-xl font-bold mb-1">
              {aviso.titulo ?? "⚠️ Confere o lançamento"}
            </p>
            <p className="text-lg">{aviso.texto}</p>
          </div>
        )}

        {/* SALVAR — nunca fica cinza mudo: se falta campo, ele diz qual. */}
        <button
          onClick={salvar}
          disabled={salvando}
          className={
            aviso && !falta
              ? "btn-primario text-2xl bg-amber-500 active:bg-amber-600"
              : "btn-primario text-2xl"
          }
        >
          {salvando
            ? "Salvando..."
            : aviso && !falta
              ? "SALVAR ASSIM MESMO"
              : "✅ SALVAR COLETA"}
        </button>
      </div>
    </main>
  );
}
