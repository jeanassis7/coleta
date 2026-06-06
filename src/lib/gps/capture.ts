"use client";

export interface GpsResult {
  ok: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** Razão da falha — usar pra log estruturado */
  failure?: {
    kind: "denied" | "unavailable" | "timeout" | "unsupported";
    code?: number;
    message?: string;
  };
}

// Aumentado pra 10s pra dar margem em laptops Windows (wifi-based positioning é lento).
// No celular com GPS de hardware fica instantâneo, raramente passa de 1-2s.
const TIMEOUT_MS = 10000;

/**
 * Captura GPS com timeout de 5s. Nunca rejeita — sempre resolve com result.
 * Não usa watchPosition (custo de bateria).
 */
export function captureGPS(): Promise<GpsResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({
        ok: false,
        latitude: null,
        longitude: null,
        accuracy: null,
        failure: { kind: "unsupported" },
      });
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        latitude: null,
        longitude: null,
        accuracy: null,
        failure: { kind: "timeout" },
      });
    }, TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const kind =
          err.code === 1
            ? "denied"
            : err.code === 2
            ? "unavailable"
            : "timeout";
        resolve({
          ok: false,
          latitude: null,
          longitude: null,
          accuracy: null,
          failure: { kind, code: err.code, message: err.message },
        });
      },
      {
        enableHighAccuracy: true,
        timeout: TIMEOUT_MS,
        maximumAge: 30_000, // aceita posição cacheada de até 30s
      }
    );
  });
}

export async function checkPermissionsState(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.permissions) return "unknown";
  try {
    const res = await navigator.permissions.query({ name: "geolocation" });
    return res.state;
  } catch {
    return "unknown";
  }
}
