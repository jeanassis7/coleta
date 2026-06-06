"use client";

import { v4 as uuid } from "uuid";

const DEVICE_KEY = "coleta_device_id";
const SESSION_KEY = "coleta_session_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuid();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function rotateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const id = uuid();
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
