"use client";

import { useEffect } from "react";
import { logEvent } from "@/lib/events/log";

/**
 * Componente invisível que escuta eventos globais do browser e loga
 * pra que o admin consiga debugar problemas dos motoristas remotamente.
 *
 * Capta:
 *  - app_loaded (mount)
 *  - app_focused / app_blurred (visibilitychange)
 *  - network_online / network_offline (com tipo de conexão)
 *  - permission_geolocation_changed
 *  - js_error / js_unhandled_rejection
 */
export function EventLogger({ motoristaId }: { motoristaId: string | null }) {
  useEffect(() => {
    if (!motoristaId) return;

    // app_loaded
    logEvent(motoristaId, "app_loaded", {
      url: window.location.pathname,
      connection: getConnectionInfo(),
      online: navigator.onLine,
    });

    // Visibilidade
    const onVisibility = () => {
      logEvent(
        motoristaId,
        document.visibilityState === "visible" ? "app_focused" : "app_blurred",
        {}
      );
    };

    // Rede
    const onOnline = () =>
      logEvent(motoristaId, "network_online", {
        connection: getConnectionInfo(),
      });
    const onOffline = () =>
      logEvent(motoristaId, "network_offline", {
        connection: getConnectionInfo(),
      });

    // Erros JS não tratados — fonte clássica de bugs invisíveis
    const onError = (e: ErrorEvent) => {
      logEvent(motoristaId, "js_error", {
        message: e.message,
        filename: e.filename?.slice(-80) ?? null,
        lineno: e.lineno ?? null,
        colno: e.colno ?? null,
        stack: e.error?.stack?.slice(0, 800) ?? null,
        url: window.location.pathname,
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const reasonStr =
        reason instanceof Error
          ? `${reason.message}\n${reason.stack?.slice(0, 600) ?? ""}`
          : String(reason).slice(0, 600);
      logEvent(motoristaId, "js_unhandled_rejection", {
        reason: reasonStr,
        url: window.location.pathname,
      });
    };

    // Permissão de localização — quando o status muda (autorizou/negou)
    let permListener: { state: string; change?: () => void } | null = null;
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((res) => {
          permListener = { state: res.state };
          const onChange = () => {
            logEvent(motoristaId, "permission_geolocation_changed", {
              state: res.state,
            });
          };
          res.addEventListener("change", onChange);
          permListener.change = onChange;
        })
        .catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [motoristaId]);

  return null;
}

/**
 * Pega info da conexão de rede via navigator.connection (NetworkInformation API).
 * Disponível em Android Chrome. Retorna null se não suportado.
 */
function getConnectionInfo(): Record<string, unknown> | null {
  type Conn = {
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  const conn = (navigator as unknown as { connection?: Conn }).connection;
  if (!conn) return null;
  return {
    type: conn.type ?? null,
    effectiveType: conn.effectiveType ?? null,
    downlink: conn.downlink ?? null,
    rtt: conn.rtt ?? null,
    saveData: conn.saveData ?? null,
  };
}
