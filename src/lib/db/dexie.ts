"use client";

import Dexie, { type EntityTable } from "dexie";
import type { ColetaLocal, EventoLocal } from "@/lib/types";

class ColetaDatabase extends Dexie {
  coletas_locais!: EntityTable<ColetaLocal, "client_id">;
  eventos_locais!: EntityTable<EventoLocal, "id">;

  constructor() {
    super("coleta");
    this.version(1).stores({
      coletas_locais: "client_id, motorista_id, criado_em, registro_subido, foto_subida",
      eventos_locais: "id, motorista_id, criado_em, enviado, event_type",
    });
    // v2: adiciona carga_id como campo indexável em coletas_locais
    // (não quebra registros antigos — coletas antigas ficam com carga_id undefined)
    this.version(2).stores({
      coletas_locais: "client_id, motorista_id, carga_id, criado_em, registro_subido, foto_subida",
      eventos_locais: "id, motorista_id, criado_em, enviado, event_type",
    });
  }
}

let _db: ColetaDatabase | null = null;

export function getLocalDB(): ColetaDatabase {
  if (typeof window === "undefined") {
    throw new Error("getLocalDB() só pode rodar no browser");
  }
  if (!_db) {
    _db = new ColetaDatabase();
  }
  return _db;
}
