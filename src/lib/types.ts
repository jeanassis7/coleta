export type CertificadoTipo = "integral" | "parcial" | "nao";

export type EventType =
  // Lifecycle
  | "app_loaded"
  | "app_focused"
  | "app_blurred"
  // Rede
  | "network_online"
  | "network_offline"
  // Auth
  | "login"
  | "logout"
  | "session_expired"
  // Permissões
  | "permission_geolocation_changed"
  // Ações do usuário
  | "nova_coleta_opened"
  | "coleta_saved_local"
  | "enviar_agora_clicked"
  | "foto_capture_started"
  | "foto_capture_cancelled"
  | "foto_compress_completed"
  | "foto_compress_failed"
  // GPS
  | "gps_success"
  | "gps_timeout"
  | "gps_denied"
  | "gps_error"
  // Sync
  | "sync_started"
  | "sync_completed"
  | "sync_failure"
  | "sync_skipped_wrong_motorista"
  // JS
  | "js_error"
  | "js_unhandled_rejection"
  // PWA / admin
  | "app_install"
  | "foto_toggle_changed";

export interface Profile {
  id: string;
  nome: string;
  role: "motorista" | "admin";
  ativo: boolean;
  exige_foto: boolean;
  senha_visivel: string | null;
  criado_em: string;
}

export interface Coleta {
  id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  local_id: string | null;
  valor_pago: number;
  certificado_tipo: CertificadoTipo;
  litros_certificado: number | null;
  observacao: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  foto_path: string | null;
  foto_url_cached: string | null;
  device_id: string | null;
  session_id: string | null;
  app_version: string | null;
  criado_em: string;
  sincronizado_em: string | null;
  client_id: string;
}

export interface ColetaLocal {
  client_id: string;
  litros: number;
  local_nome: string;
  local_id: string | null;
  valor_pago: number;
  certificado_tipo: CertificadoTipo;
  litros_certificado: number | null;
  observacao: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  device_id: string;
  session_id: string;
  app_version: string;
  motorista_id: string;
  criado_em: number;
  foto_blob: Blob | null;
  foto_subida: boolean;
  registro_subido: boolean;
  gps_pendente: boolean;          // true enquanto GPS ainda não resolveu (sucesso ou timeout)
  tentativas: number;
  ultimo_erro: string | null;
}

export interface EventoLocal {
  id: string;
  motorista_id: string | null;
  event_type: EventType;
  payload: Record<string, unknown>;
  session_id: string;
  device_id: string;
  app_version: string;
  criado_em: number;
  enviado: boolean;
}

export interface AppEvent {
  id: string;
  motorista_id: string | null;
  session_id: string | null;
  device_id: string | null;
  event_type: EventType;
  payload: Record<string, unknown> | null;
  app_version: string | null;
  criado_em: string;
}

export interface Local {
  id: string;
  nome_canonico: string;
  apelidos: string[];
  latitude: number;
  longitude: number;
  raio_match_m: number;
  ativo: boolean;
  notas_internas: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface LocalComStats extends Local {
  total_visitas: number;
  total_litros: number;
  total_pago: number;
  ultima_visita: string | null;
  primeira_visita: string | null;
}

export interface LocalProximo {
  id: string;
  nome_canonico: string;
  latitude: number;
  longitude: number;
  distancia_m: number;
}
