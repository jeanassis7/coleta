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
  | "foto_toggle_changed"
  // Módulo 1: cargas
  | "carga_iniciada"
  | "carga_encerrada"
  | "carga_cancelada"
  | "descarga_saved_local"
  | "despesa_saved_local"
  | "abastecimento_saved_local"
  // Adiantamentos
  | "adiantamento_aceito"
  | "adiantamento_pulado";

export interface Profile {
  id: string;
  nome: string;
  role: "motorista" | "admin" | "dev";
  ativo: boolean;
  exige_foto: boolean;
  senha_visivel: string | null;
  is_teste?: boolean;
  features?: Record<string, unknown> | null;
  mostra_saldo_app?: boolean;
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
  carga_id?: string | null;       // Módulo 1: coleta vinculada à carga ativa
}

/** Info da carga ativa em cache local do motorista (pra funcionar offline). */
export interface CargaAtivaCache {
  id: string;
  /** Dono da carga — valida que o cache não vazou de outro login no mesmo celular. */
  motorista_id: string;
  caminhao_id: string;
  caminhao_placa: string;
  caminhao_marca: string;
  caminhao_cor: string;
  capacidade_l: number;
  tara_kg: number;
  km_inicial: number;
  iniciada_em: string;
}

/**
 * Lançamentos offline-first do Módulo 1 (mesmo padrão de ColetaLocal):
 * salvam no IndexedDB com GPS capturado na hora e sincronizam quando
 * houver sinal. client_id garante idempotência no servidor.
 */
export interface DespesaLocal {
  client_id: string;
  motorista_id: string;
  carga_id: string;
  valor: number;
  descricao: string;
  latitude: number | null;
  longitude: number | null;
  gps_pendente: boolean;
  criado_em: number;
  foto_blob: Blob | null; // obrigatória na UI
  foto_subida: boolean;
  registro_subido: boolean;
  tentativas: number;
  ultimo_erro: string | null;
}

export interface AbastecimentoLocal {
  client_id: string;
  motorista_id: string;
  carga_id: string;
  posto_nome: string;
  litros: number;
  valor: number;
  km_atual: number;
  latitude: number | null;
  longitude: number | null;
  gps_pendente: boolean;
  criado_em: number;
  foto_blob: Blob | null; // obrigatória na UI
  foto_subida: boolean;
  registro_subido: boolean;
  tentativas: number;
  ultimo_erro: string | null;
}

export interface DescargaLocal {
  client_id: string;
  motorista_id: string;
  carga_id: string;
  peso_bruto_kg: number;
  peso_tara_kg: number;
  litros_estimados: number;
  /** Km do painel ao encerrar — o sync grava em cargas.km_final */
  km_final: number;
  latitude: number | null;
  longitude: number | null;
  gps_pendente: boolean;
  criado_em: number;
  foto_blob: Blob | null; // opcional (papel da balança)
  foto_subida: boolean;
  registro_subido: boolean;
  /** true depois que o sync marcou cargas.status='encerrada' no servidor */
  carga_encerrada_servidor: boolean;
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
