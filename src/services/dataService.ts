// Firebase Data Service for Ameta Telecom (100% Client-Side Firestore & Auth)

import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  addDoc,
  onSnapshot,
  query,
  where,
  writeBatch,
  deleteField,
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
} from 'firebase/auth';

import {
  AmetaUser,
  AmetaNotification,
  TelecomSite,
  TssrRow,
  EngineeringFolder,
  EngineeringFile,
  EricssonRow,
  EricssonEngineeringRow,
  UserRole,
  AssignedPlatformScope,
  UserSituacao,
  isOwnerAdmUser,
  ensureUserMandatoryDocuments,
  AuditLogEntry,
  UserPrivateData,
  VendorType,
  Acionamento,
  AcionamentoStatus,
  AcionamentoHistorico,
  buildAcionamentoId,
  normalizeSiteIdForDoc,
  ImportHistoryEntry,
  ClaroSiteRow,
  ClaroEngenhariaRow,
  ClaroSheetMeta,
  VivoActivityRow,
  VivoSheetMeta,
} from '../types/telecom';
import { hashString, createSaltedHash } from '../utils/authUtils';
import {
  doesSiteMatchResponsible,
  doesEricssonRowMatchResponsible,
  getCanonicalDuplaName,
  normalizeAccents,
  matchesDuplaName,
  normalizeNokiaSitesSheetName,
  resolveClaroSiteIdFromFields,
  resolveClaroExecutorFromFields,
  isClaroSiteRecord,
} from '../utils/spreadsheetUtils';
import { showToast } from '../utils/toast';
import { INITIAL_SITES } from '../data/initialSites';
import { INITIAL_ERICSSON_SITES } from '../data/initialEricssonSites';

const initialNokiaSitesMap = new Map<string, TelecomSite>();
INITIAL_SITES.forEach((s) => {
  if (s.id) initialNokiaSitesMap.set(s.id.trim().toUpperCase(), s);
  if (s.siteId && s.sheetName === 'Controle Geral') {
    initialNokiaSitesMap.set(s.siteId.trim().toUpperCase(), s);
  }
  if (s.rowKey) initialNokiaSitesMap.set(s.rowKey.trim().toUpperCase(), s);
});

const initialEricssonSitesMap = new Map<string, EricssonRow>();
INITIAL_ERICSSON_SITES.forEach((r) => {
  if (r.id) initialEricssonSitesMap.set(r.id, r);
});

const initialEricssonEngMap = new Map<string, EricssonEngineeringRow>();

export type Unsubscribe = () => void;
let hasShownPermissionAcionamentosToast = false;
const warnedPermissionDeniedCollections = new Set<string>();

export const FIRESTORE_COLLECTIONS = {
  USUARIOS: 'usuarios',
  NOKIA_SITES: 'nokia_sites',
  NOKIA_TSSR: 'nokia_tssr',
  NOKIA_PASTAS: 'nokia_pastas',
  NOKIA_ARQUIVOS: 'nokia_arquivos',
  ERICSSON_SITES: 'ericsson_sites',
  ERICSSON_PASTAS: 'ericsson_pastas',
  ERICSSON_ARQUIVOS: 'ericsson_arquivos',
  ERICSSON_ENGENHARIA: 'ericsson_engenharia',
  ERICSSON_REPROVACOES: 'ericsson_reprovacoes',
  NOTIFICACOES: 'notificacoes',
  DUPLAS_CONFIG: 'duplas_config',
  CHAMADOS: 'chamados',
  APP_META: 'app_meta',
  AUDIT_LOGS: 'audit_logs',
  ACIONAMENTOS: 'acionamentos',
  HISTORICO_IMPORTACOES: 'historico_importacoes',
  CLARO_SITES: 'claro_sites',
  CLARO_ENGENHARIA: 'claro_engenharia',
  CLARO_META: 'claro_meta',
  ERICSSON_VIVO: 'ericsson_vivo',
  ERICSSON_VIVO_META: 'ericsson_vivo_meta',
} as const;

export function sanitizeFirestoreData<T>(data: T): T {
  if (data === undefined) return null as unknown as T;
  if (data === null) return null as unknown as T;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeFirestoreData(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data as Record<string, any>)) {
      if (v !== undefined) {
        clean[k] = sanitizeFirestoreData(v);
      }
    }
    return clean as unknown as T;
  }
  return data;
}

export function sanitizeSiteDocId(rawSiteId: string, sheetName?: string): string {
  const cleanSite = (rawSiteId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const baseId = cleanSite || `SITE_${Date.now()}`;
  if (sheetName && sheetName !== 'Controle Geral') {
    const cleanSheet = sheetName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_')
      .slice(0, 24);
    return `${cleanSheet}__${baseId}`.slice(0, 120);
  }
  return baseId.slice(0, 120);
}

export function sanitizeEricssonDocId(row: Partial<EricssonRow>): string {
  const cleanA = (row.siteIdA || row.fields?.['01.21.Site ID A'] || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');
  const cleanB = (row.siteIdB || row.fields?.['01.21.Site ID B'] || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');
  const cleanChaves = (row.chaves || row.fields?.['01.00. Chaves'] || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');

  if (cleanA && cleanB) {
    return `${cleanA}__${cleanB}`.slice(0, 120);
  }
  if (cleanA) {
    return cleanChaves ? `${cleanA}__${cleanChaves}`.slice(0, 120) : cleanA.slice(0, 120);
  }
  if (cleanB) {
    return cleanChaves ? `${cleanB}__${cleanChaves}`.slice(0, 120) : cleanB.slice(0, 120);
  }
  return (row.id || `ERIC_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export const sanitizarSiteIdParaFirestore = sanitizeSiteDocId;
export const gerarDocIdEricsson = sanitizeEricssonDocId;

export function generateImportCode(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${y}${m}${d}_${h}${min}${s}`;
}

export function formatImportDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const dateStr = d.toLocaleDateString('pt-BR');
    const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} às ${timeStr}`;
  } catch {
    return isoString;
  }
}

export function resolveNokiaSiteResponsaveis(
  site: TelecomSite,
  users: AmetaUser[],
  duplaEmailsMap?: Record<string, string[]>
): { responsaveisUids: string[]; responsaveisEmails: string[] } {
  const uids = new Set<string>();
  const emails = new Set<string>();

  const rawEmailField =
    site.customFields?.['E-MAIL DUPLA'] || site.customFields?.['EMAIL_DUPLA'] || '';
  if (rawEmailField) {
    rawEmailField
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'))
      .forEach((e) => emails.add(e));
  }

  const equipeName = (
    site.equipeParceira ||
    site.customFields?.['EQUIPE EXECUTANTE'] ||
    site.responsavelCampo ||
    ''
  ).trim();

  if (equipeName && duplaEmailsMap && duplaEmailsMap[equipeName]) {
    duplaEmailsMap[equipeName].forEach((em) => {
      if (em) emails.add(em.trim().toLowerCase());
    });
  }

  for (const u of users) {
    const uEmail = (u.email || '').trim().toLowerCase();
    const uUid = u.uid || u.id;
    if (emails.has(uEmail) || doesSiteMatchResponsible(site, u)) {
      if (uEmail) emails.add(uEmail);
      if (uUid) uids.add(uUid);
    }
  }

  return {
    responsaveisUids: Array.from(uids).slice(0, 20),
    responsaveisEmails: Array.from(emails).slice(0, 20),
  };
}

export function resolveEricssonRowResponsaveis(
  row: EricssonRow,
  users: AmetaUser[],
  duplaEmailsMap?: Record<string, string[]>
): { responsaveisUids: string[]; responsaveisEmails: string[] } {
  const uids = new Set<string>();
  const emails = new Set<string>();

  const rawEmailField = row.fields?.['E-MAIL DUPLA'] || '';
  if (rawEmailField) {
    rawEmailField
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'))
      .forEach((e) => emails.add(e));
  }

  const equipeName = (row.equipe || row.fields?.['EQUIPE'] || '').trim();
  if (equipeName && duplaEmailsMap && duplaEmailsMap[equipeName]) {
    duplaEmailsMap[equipeName].forEach((em) => {
      if (em) emails.add(em.trim().toLowerCase());
    });
  }

  for (const u of users) {
    const uEmail = (u.email || '').trim().toLowerCase();
    const uUid = u.uid || u.id;
    if (emails.has(uEmail) || doesEricssonRowMatchResponsible(row, u)) {
      if (uEmail) emails.add(uEmail);
      if (uUid) uids.add(uUid);
    }
  }

  return {
    responsaveisUids: Array.from(uids).slice(0, 20),
    responsaveisEmails: Array.from(emails).slice(0, 20),
  };
}

export interface ErroAbaNokiaSitesDiagnostico {
  total: number;
  porAba: Record<string, number>;
  docs: Array<{ id: string; data: TelecomSite }>;
}

export interface ResultadoCorrecaoAbaNokiaSites {
  movidos: number;
  novosSites: TelecomSite[];
  idsRemovidos: string[];
  detalhesPorAba: Record<string, number>;
}

export interface DiagnosticoClaroEmNokiaSites {
  total: number;
  docs: Array<{ id: string; siteId: string; sheetName?: string }>;
}

export interface ResultadoMoverClaroDeNokiaSites {
  movidos: number;
  novosClaroSites: TelecomSite[];
  idsRemovidosNokia: string[];
}

export interface IDataService {
  isConfigured(): boolean;
  verificarLinhasAbaErradaNokiaSites(): Promise<ErroAbaNokiaSitesDiagnostico>;
  corrigirLinhasAbaErradaNokiaSites(): Promise<ResultadoCorrecaoAbaNokiaSites>;
  verificarRegistrosClaroEmNokiaSites(): Promise<DiagnosticoClaroEmNokiaSites>;
  moverRegistrosClaroDeNokiaSites(): Promise<ResultadoMoverClaroDeNokiaSites>;
  sincronizarUsuariosIniciais(): Promise<number>;
  registrarAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void>;
  garantirUsuarioAoAutenticar(params: {
    uid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<AmetaUser>;
  obterUsuarioPorUid(uid: string): Promise<AmetaUser | null>;
  listarTodosUsuarios(): Promise<AmetaUser[]>;
  obterDadosPrivadosUsuario(uid: string): Promise<UserPrivateData | null>;
  salvarDadosPrivadosUsuario(uid: string, dados: UserPrivateData): Promise<void>;
  atualizarPermissaoUsuarioPeloDono(params: {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
    plataforma: 'NOKIA' | 'ERICSSON' | 'AMBAS';
    situacao: UserSituacao;
    equipe?: string;
    ownerEmail?: string;
  }): Promise<AmetaUser>;
  importarSitesNokiaEmLote(
    sites: TelecomSite[],
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only';
      vendor?: 'NOKIA' | 'CLARO_TIM';
      sourceFileName?: string;
      fileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: TelecomSite[];
    errorMessage?: string;
  }>;
  importarSitesEricssonEmLote(
    rows: EricssonRow[],
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      fileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: EricssonRow[];
    errorMessage?: string;
  }>;
  importarTssrNokiaEmLote(
    rows: TssrRow[],
    users?: AmetaUser[],
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      fileName?: string;
      sheetName?: string;
      tabName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: TssrRow[];
    errorMessage?: string;
  }>;
  salvarSiteNokia(
    site: TelecomSite,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirSiteNokia(siteId: string, vendor?: VendorType): Promise<void>;
  carregarSitesNokia(): Promise<TelecomSite[]>;
  salvarSiteEricsson(
    row: EricssonRow,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  atualizarMetaEricssonSite(row: EricssonRow, novaMeta: string): Promise<void>;
  excluirSiteEricsson(rowId: string): Promise<void>;
  carregarSitesEricsson(): Promise<EricssonRow[]>;
  salvarTssrNokia(row: TssrRow): Promise<void>;
  excluirTssrNokia(rowId: string): Promise<void>;
  importarEricssonEngenhariaEmLote(
    rows: any[],
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      fileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: EricssonEngineeringRow[];
    errorMessage?: string;
  }>;
  formatImportDate(isoString?: string): string;
  verificarHistoricoArquivo(
    fileName: string,
    target:
      | 'NOKIA_SITES'
      | 'NOKIA_TSSR'
      | 'ERICSSON_SITES'
      | 'ERICSSON_ENGENHARIA'
      | 'CLARO_SITES'
      | 'CLARO_ENGENHARIA'
  ): Promise<{
    isPreviouslyImported: boolean;
    jaImportado: boolean;
    lastImportedAt?: string;
    dataFormatada?: string;
    entry?: ImportHistoryEntry;
  }>;
  registrarHistoricoImportacao(entry: ImportHistoryEntry): Promise<void>;
  carregarEricssonEngenharia(): Promise<any[]>;
  carregarEricssonReprovacoes(): Promise<any[]>;
  salvarEricssonEngenhariaRow(row: any): Promise<void>;
  atualizarMetaEricssonEngenharia(row: EricssonEngineeringRow, novaMeta: string): Promise<void>;
  atualizarStatusEricssonEngenharia(row: EricssonEngineeringRow, novoStatus: string): Promise<void>;
  excluirEricssonEngenhariaRow(rowId: string): Promise<void>;
  salvarEricssonReprovacao(record: any): Promise<void>;
  excluirEricssonReprovacao(recordId: string): Promise<void>;
  salvarClaroMeta(meta: ClaroSheetMeta): Promise<void>;
  importarSitesClaroEmLote(
    rowsInput: Array<Partial<TelecomSite> | Partial<ClaroSiteRow>>,
    options?: {
      columns?: string[];
      fileName?: string;
      sheetName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: ClaroSiteRow[];
    errorMessage?: string;
  }>;
  importarEngenhariaClaroEmLote(
    rowsInput: Array<Partial<TelecomSite> | Partial<ClaroEngenhariaRow>>,
    options?: {
      columns?: string[];
      fileName?: string;
      sheetName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: ClaroEngenhariaRow[];
    errorMessage?: string;
  }>;
  salvarClaroSiteRow(row: ClaroSiteRow): Promise<void>;
  excluirClaroSiteRow(rowId: string): Promise<void>;
  salvarClaroEngenhariaRow(row: ClaroEngenhariaRow): Promise<void>;
  excluirClaroEngenhariaRow(rowId: string): Promise<void>;
  importarVivoAtividadesEmLote(
    rows: VivoActivityRow[],
    options?: {
      fileName?: string;
      columns?: string[];
      baseLoaded?: boolean;
      skipHistory?: boolean;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{ totalGravados: number; lotesExecutados: number }>;
  salvarVivoAtividade(row: VivoActivityRow): Promise<void>;
  excluirVivoAtividade(rowId: string): Promise<void>;
  criarVivoRegistrosEmLote(
    rows: VivoActivityRow[],
    options?: {
      executorUser?: { id?: string; name: string; email?: string } | null;
      actorName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{ totalGravados: number; acionamentosCriados: number }>;
  atualizarCamposVivoAtividade(
    rowId: string,
    patch: Record<string, any>,
    demandSync?: {
      action: 'assign' | 'remove';
      siteName: string;
      tipoDoc?: string;
      dataDemanda?: string;
      executorName?: string;
      executorEmail?: string;
      actorName?: string;
      actorEmail?: string;
    }
  ): Promise<void>;
  atualizarCampoVivoEmLote(
    updates: Array<{
      id: string;
      patch: Record<string, any>;
      siteName?: string;
      tipoDoc?: string;
      dataDemanda?: string;
    }>,
    options?: {
      demandSync?: {
        action: 'assign' | 'remove';
        executorName?: string;
        executorEmail?: string;
        actorName?: string;
        actorEmail?: string;
      };
      onProgress?: (info: { gravados: number; total: number }) => void;
    }
  ): Promise<{ totalAtualizados: number }>;
  salvarPastaNokia(folder: EngineeringFolder): Promise<void>;
  excluirPastaNokia(folderId: string): Promise<void>;
  salvarArquivoNokia(
    file: EngineeringFile,
    users?: AmetaUser[],
    sites?: TelecomSite[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirArquivoNokia(fileId: string): Promise<void>;
  salvarPastaEricsson(folder: EngineeringFolder): Promise<void>;
  excluirPastaEricsson(folderId: string): Promise<void>;
  salvarArquivoEricsson(
    file: EngineeringFile,
    users?: AmetaUser[],
    rows?: EricssonRow[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirArquivoEricsson(fileId: string): Promise<void>;
  salvarMapaDuplas(
    duplaEmailsMap: Record<string, string[]>,
    customDuplas?: string[]
  ): Promise<void>;
  carregarMapaDuplas(): Promise<{
    duplaEmailsMap?: Record<string, string[]>;
    customDuplas?: string[];
  }>;
  criarNotificacao(notif: AmetaNotification): Promise<void>;
  marcarNotificacaoLida(notificationId?: string, markAll?: boolean, userEmail?: string): Promise<void>;
  excluirNotificacao(id: string): Promise<void>;
  bloquearUsuario(uid: string, motivo?: string): Promise<void>;
  atribuirDemandaSites(params: {
    siteTokens: string[];
    responsibleName: string;
    linkedEmails?: string[];
    vendor: VendorType;
    actorEmail?: string;
    actorName?: string;
    allowTransfer?: boolean;
    demandDate?: string;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number; sitesWithoutEmailCount?: number }>;
  resolverIdsAcionamentoEricsson(
    docId: string,
    tipoDestinatario: 'EXECUTOR' | 'VISTORIA'
  ): Promise<string[]>;
  desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: VendorType;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }>;
  limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: VendorType;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }>;
  renomearEquipeDupla(params: {
    oldName: string;
    newName: string;
    vendor?: VendorType;
  }): Promise<void>;
  vincularEmailsDupla(params: {
    duplaName: string;
    emails: string[];
    vendor?: VendorType;
  }): Promise<void>;
  desvincularEmailsDupla(params: {
    duplaName: string;
    vendor?: VendorType;
  }): Promise<void>;
  renomearEmailsDupla(params: {
    oldName: string;
    newName: string;
    vendor?: VendorType;
  }): Promise<void>;
  renomearExecutorEngenharia(params: {
    oldName: string;
    newName: string;
    vendor: VendorType;
  }): Promise<{ updatedCount: number }>;
  adicionarEquipeExcluida(params: {
    duplaName: string;
    vendor: VendorType;
  }): Promise<void>;
  removerEquipeExcluida(params: {
    duplaName: string;
    vendor: VendorType;
  }): Promise<void>;
  limparTodasLinhasEquipeDupla(params: {
    duplaName: string;
    vendor: VendorType;
    siteIds?: string[];
  }): Promise<{ updatedCount: number }>;
  importarDadosIniciais(onProgress?: (msg: string) => void): Promise<{
    totalSites: number;
    totalEricsson: number;
    totalUsers: number;
  }>;
  registrarNovoUsuarioCorporativo(params: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    equipe?: string;
    telefone?: string;
    plataforma?: AssignedPlatformScope;
  }): Promise<AmetaUser>;
  autenticarUsuarioCorporativo(params: {
    email: string;
    password: string;
  }): Promise<AmetaUser | null>;
  salvarDocumentosUsuario(params: {
    uidOrId: string;
    email: string;
    documents: any[];
    dispensadoDocumentos?: boolean;
    statusRecurso?: string;
  }): Promise<void>;
  garantirDocumentoUsuarioNoCadastro(
    uid: string,
    email: string,
    name: string
  ): Promise<AmetaUser>;
  obterPerfilUsuario(uid: string): Promise<AmetaUser | null>;
  atualizarPermissoesUsuario(
    uid: string,
    payload: {
      email: string;
      name: string;
      situacao: UserSituacao;
      role: UserRole;
      plataforma: AssignedPlatformScope;
      equipe?: string;
      telefone?: string;
      atividade?: string;
    }
  ): Promise<AmetaUser>;
  excluirUsuario(uidOrId: string, email?: string): Promise<void>;
  observarPerfilUsuario(uid: string, onUpdate: (user: AmetaUser | null) => void): Unsubscribe;
  observarColecoesPlataforma(
    user: AmetaUser,
    callbacks: {
      onNokiaSites?: (sites: TelecomSite[]) => void;
      onNokiaTssr?: (rows: TssrRow[]) => void;
      onNokiaFolders?: (folders: EngineeringFolder[]) => void;
      onNokiaFiles?: (files: EngineeringFile[]) => void;
      onEricssonSites?: (rows: EricssonRow[]) => void;
      onEricssonEngineering?: (rows: EricssonEngineeringRow[]) => void;
      onEricssonFolders?: (folders: EngineeringFolder[]) => void;
      onEricssonFiles?: (files: EngineeringFile[]) => void;
      onUsuarios?: (users: AmetaUser[]) => void;
      onDuplasConfig?: (config: {
        duplaEmailsMap?: Record<string, string[]>;
        ericssonDuplaEmailsMap?: Record<string, string[]>;
        customDuplas?: string[];
        customDuplasEricsson?: string[];
        excludedDuplasNokia?: string[];
        excludedDuplasEricsson?: string[];
      }) => void;
      onNotificacoes?: (notifs: AmetaNotification[]) => void;
      onAcionamentos?: (acionamentos: Acionamento[]) => void;
      onClaroSites?: (rows: TelecomSite[]) => void;
      onClaroEngenharia?: (rows: ClaroEngenhariaRow[]) => void;
      onClaroMeta?: (meta: { sites?: ClaroSheetMeta; engenharia?: ClaroSheetMeta }) => void;
      onEricssonVivo?: (rows: VivoActivityRow[]) => void;
      onEricssonVivoMeta?: (meta: VivoSheetMeta | null) => void;
    }
  ): Unsubscribe;
  salvarOuAtualizarAcionamento(
    payload: Partial<Acionamento> & {
      siteId: string;
      vendor: VendorType;
      tipoDestinatario: 'EXECUTOR' | 'VISTORIA';
      equipe: string;
      dataDemanda?: string;
    }
  ): Promise<Acionamento & { hasNoEmail: boolean }>;
  cancelarAcionamento(
    acionamentoId: string,
    actor?: { nome?: string; email?: string; motivo?: string }
  ): Promise<void>;
  obterAcionamentoPorId(id: string): Promise<Acionamento | null>;
  observarAcionamentos(
    params: {
      role: UserRole;
      email: string;
      isSimulating?: boolean;
      onErrorToast?: (msg: string) => void;
    },
    callback: (acionamentos: Acionamento[]) => void
  ): Unsubscribe;
  resolverDestinatariosEmails(params: {
    responsibleName: string;
    linkedEmails?: string[];
    vendor?: VendorType;
    tipoDestinatario: 'VISTORIA' | 'EXECUTOR';
  }): Promise<string[]>;
}

export function buildAmetaUserProfile(params: {
  uid: string;
  email: string;
  name?: string;
  role?: UserRole;
  equipe?: string;
  telefone?: string;
  plataforma?: AssignedPlatformScope;
}): AmetaUser {
  const cleanEmail = params.email.trim().toLowerCase();
  const isOwner = isOwnerAdmUser(cleanEmail);
  const safeRole: UserRole = isOwner
    ? 'ADM'
    : (params.role && params.role !== 'ADM')
    ? params.role
    : 'Vistoriador';

  const assignedScope: AssignedPlatformScope = isOwner
    ? 'BOTH'
    : params.plataforma || 'NOKIA';
  const legacyPlat: 'NOKIA' | 'ERICSSON' | 'AMBAS' =
    assignedScope === 'BOTH' || assignedScope === 'AMBAS'
      ? 'AMBAS'
      : assignedScope === 'ERICSSON'
      ? 'ERICSSON'
      : 'NOKIA';

  return {
    id: params.uid,
    uid: params.uid,
    name: (params.name || cleanEmail.split('@')[0]).trim() || 'Usuário',
    email: cleanEmail,
    tipo: isOwner ? 'admin' : 'usuario',
    role: safeRole,
    situacao: isOwner ? 'dono' : 'aguardando',
    plataforma: legacyPlat,
    assignedPlatform: assignedScope,
    accessReleased: isOwner ? true : false,
    documents: ensureUserMandatoryDocuments(),
    emailVerified: true,
    equipe: (params.equipe || '').trim(),
    telefone: (params.telefone || '').trim(),
    createdAt: new Date().toISOString(),
  };
}

class FirebaseDataService implements IDataService {
  isConfigured(): boolean {
    return true; // 100% Firebase Cloud Firestore & Auth
  }

  async garantirUsuarioAoAutenticar(params: {
    uid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<AmetaUser> {
    const cleanEmail = params.email.trim().toLowerCase();
    const isOwner = isOwnerAdmUser(cleanEmail);
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const existing = snap.data() as AmetaUser;
      if (isOwner && existing.situacao !== 'dono') {
        const updated: AmetaUser = {
          ...existing,
          role: 'ADM',
          situacao: 'dono',
          plataforma: 'AMBAS',
          assignedPlatform: 'BOTH',
          accessReleased: true,
          emailVerified: true,
        };
        await setDoc(userRef, sanitizeFirestoreData(updated), { merge: true });
        return updated;
      }
      return { id: params.uid, uid: params.uid, ...existing };
    }

    const newUser = buildAmetaUserProfile({
      uid: params.uid,
      email: cleanEmail,
      name: params.name,
    });

    await setDoc(userRef, sanitizeFirestoreData(newUser));
    return newUser;
  }

  async obterUsuarioPorUid(uid: string): Promise<AmetaUser | null> {
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid));
      if (snap.exists()) {
        return { id: snap.id, uid: snap.id, ...snap.data() } as AmetaUser;
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `${FIRESTORE_COLLECTIONS.USUARIOS}/${uid}`);
    }
  }

  async listarTodosUsuarios(): Promise<AmetaUser[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      return snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() } as AmetaUser));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, FIRESTORE_COLLECTIONS.USUARIOS);
    }
  }

  async atualizarPermissaoUsuarioPeloDono(params: {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
    plataforma: 'NOKIA' | 'ERICSSON' | 'AMBAS';
    situacao: UserSituacao;
    equipe?: string;
    ownerEmail?: string;
  }): Promise<AmetaUser> {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.uid);
    const snap = await getDoc(userRef);
    const existing = snap.exists() ? (snap.data() as AmetaUser) : {};
    const accessReleased = params.situacao === 'ativo' || params.situacao === 'dono';

    const payload = {
      ...existing,
      ...params,
      accessReleased,
      assignedPlatform: params.plataforma === 'AMBAS' ? 'BOTH' : params.plataforma,
    };

    await setDoc(userRef, sanitizeFirestoreData(payload), { merge: true });
    return { id: params.uid, uid: params.uid, ...payload } as AmetaUser;
  }

  formatImportDate(isoString?: string): string {
    return formatImportDate(isoString);
  }

  async verificarHistoricoArquivo(
    fileName: string,
    target:
      | 'NOKIA_SITES'
      | 'NOKIA_TSSR'
      | 'ERICSSON_SITES'
      | 'ERICSSON_ENGENHARIA'
      | 'CLARO_SITES'
      | 'CLARO_ENGENHARIA'
  ): Promise<{
    isPreviouslyImported: boolean;
    jaImportado: boolean;
    lastImportedAt?: string;
    dataFormatada?: string;
    entry?: ImportHistoryEntry;
  }> {
    const cleanName = (fileName || '').trim().toLowerCase();
    if (!cleanName) return { isPreviouslyImported: false, jaImportado: false };

    // 1. Check local cache
    try {
      const local = localStorage.getItem('ameta_import_history');
      if (local) {
        const parsed: ImportHistoryEntry[] = JSON.parse(local);
        const match = parsed.find(
          (p) => p.target === target && (p.fileName || '').trim().toLowerCase() === cleanName
        );
        if (match) {
          return {
            isPreviouslyImported: true,
            jaImportado: true,
            lastImportedAt: match.importedAt,
            dataFormatada: formatImportDate(match.importedAt),
            entry: match,
          };
        }
      }
    } catch {}

    // 2. Check Firestore historico_importacoes
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.HISTORICO_IMPORTACOES));
      for (const d of snap.docs) {
        const data = d.data() as ImportHistoryEntry;
        if (data.target === target && (data.fileName || '').trim().toLowerCase() === cleanName) {
          return {
            isPreviouslyImported: true,
            jaImportado: true,
            lastImportedAt: data.importedAt,
            dataFormatada: formatImportDate(data.importedAt),
            entry: data,
          };
        }
      }
    } catch (err) {
      console.warn('Aviso ao consultar historico_importacoes:', err);
    }

    // 3. Fallback: check matching documents in target collection
    try {
      let colName: string = FIRESTORE_COLLECTIONS.NOKIA_SITES;
      if (target === 'NOKIA_TSSR') colName = FIRESTORE_COLLECTIONS.NOKIA_TSSR;
      else if (target === 'ERICSSON_SITES') colName = FIRESTORE_COLLECTIONS.ERICSSON_SITES;
      else if (target === 'ERICSSON_ENGENHARIA') colName = FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA;
      else if (target === 'CLARO_SITES') colName = FIRESTORE_COLLECTIONS.CLARO_SITES;
      else if (target === 'CLARO_ENGENHARIA') colName = FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA;

      const snap = await getDocs(collection(db, colName));
      for (const d of snap.docs) {
        const data = d.data();
        const fn = (data.fileName || data.sourceFileName || '').trim().toLowerCase();
        if (fn && fn === cleanName) {
          const at = data.createdAt || data.updatedAt || new Date().toISOString();
          return {
            isPreviouslyImported: true,
            jaImportado: true,
            lastImportedAt: at,
            dataFormatada: formatImportDate(at),
          };
        }
      }
    } catch {}

    return { isPreviouslyImported: false, jaImportado: false };
  }

  async registrarHistoricoImportacao(entry: ImportHistoryEntry): Promise<void> {
    try {
      const docRef = doc(db, FIRESTORE_COLLECTIONS.HISTORICO_IMPORTACOES, entry.id);
      await setDoc(docRef, sanitizeFirestoreData(entry));

      try {
        const local = localStorage.getItem('ameta_import_history');
        const list: ImportHistoryEntry[] = local ? JSON.parse(local) : [];
        const next = [entry, ...list.filter((x) => x.id !== entry.id)].slice(0, 100);
        localStorage.setItem('ameta_import_history', JSON.stringify(next));
      } catch {}
    } catch (err) {
      console.warn('Aviso ao registrar histórico de importação:', err);
    }
  }

  async importarSitesNokiaEmLote(
    sites: TelecomSite[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only';
      vendor?: 'NOKIA' | 'CLARO_TIM';
      sourceFileName?: string;
      fileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: TelecomSite[];
    errorMessage?: string;
  }> {
    const isClaro =
      options?.vendor === 'CLARO_TIM' ||
      (!options?.vendor && sites.some((s) => s?.vendor === 'CLARO_TIM'));
    const targetVendor: VendorType = isClaro ? 'CLARO_TIM' : 'NOKIA';
    const targetCollection = isClaro
      ? FIRESTORE_COLLECTIONS.CLARO_SITES
      : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const importCode = options?.importCode || generateImportCode();
    const fileName =
      options?.sourceFileName ||
      options?.fileName ||
      (isClaro ? 'Planilha Claro Sites' : 'Planilha Nokia Sites');
    let comErro = 0;
    let lotes = 0;
    let totalGravados = 0;

    try {
      // 1. Fetch from Firestore existing IDs
      const snap = await getDocs(collection(db, targetCollection));
      const existingIds = new Set<string>(snap.docs.map((d) => d.id));

      const usedIdsInThisImport = new Set<string>();
      const docsToWrite: Array<{ id: string; data: TelecomSite }> = [];

      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        const rowNumberInFile = site.rowNumberInFile || (i + 2);

        // REGRA 5: Ignore ONLY completely empty rows
        const hasContent = Boolean(
          (site.siteId && String(site.siteId).trim()) ||
          (site.siteName && String(site.siteName).trim()) ||
          (site.customFields && Object.values(site.customFields).some((v) => String(v ?? '').trim().length > 0))
        );

        if (!hasContent) {
          comErro++;
          continue;
        }

        // Nunca gravar registro marcado como CLARO_TIM dentro de nokia_sites
        if (!isClaro && site?.vendor === 'CLARO_TIM') {
          comErro++;
          continue;
        }

        const normalizedSheet = isClaro
          ? 'Controle Geral'
          : normalizeNokiaSitesSheetName(site.sheetName || options?.sheetName || 'Controle Geral');
        const cleanSiteId = (site.customFields?.['SITE ID'] || site.siteId || site.id || '').toString().trim();
        const fallbackPrefix = isClaro ? 'CLA' : 'NK';
        const baseDocId = sanitizeSiteDocId(cleanSiteId || `${fallbackPrefix}_${rowNumberInFile}`, normalizedSheet);

        // REGRA 2: If base ID does NOT exist yet and not used by another line in same import, use base ID.
        // Otherwise, create unique ID: baseDocId + "__" + importCode + "_" + rowNumberInFile.
        let finalDocId = baseDocId;
        if (existingIds.has(baseDocId) || usedIdsInThisImport.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        usedIdsInThisImport.add(finalDocId);

        // REGRA 4: Preserve cell texts exactly as they are without alterations
        const newSiteRecord: TelecomSite = {
          ...site,
          id: finalDocId,
          vendor: targetVendor,
          siteId: site.siteId || cleanSiteId || finalDocId,
          fileName,
          sheetName: normalizedSheet,
          rowNumberInFile,
          importCode,
          createdAt: site.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: 'Importação de Planilha',
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newSiteRecord),
        });
      }

      // REGRA 3: Grave os novos registros com set simples, SEM merge, nunca escrevendo em um ID que já existia
      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, targetCollection, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_${isClaro ? 'claro_sites' : 'nokia_sites'}`,
        fileName,
        target: isClaro ? 'CLARO_SITES' : 'NOKIA_SITES',
        sheetName: isClaro ? 'Controle Geral' : (options?.sheetName || 'Controle Geral'),
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: sites.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: sites.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error(`Erro no lote ${targetCollection}:`, err);
      const errMsg = `[Coleção: ${targetCollection}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: sites.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async importarSitesEricssonEmLote(
    rows: EricssonRow[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: EricssonRow[];
    errorMessage?: string;
  }> {
    const importCode = options?.importCode || generateImportCode();
    const fileName = options?.sourceFileName || 'Planilha Ericsson Sites';
    let comErro = 0;
    let lotes = 0;
    let totalGravados = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES));
      const existingIds = new Set<string>(snap.docs.map((d) => d.id));

      const usedIdsInThisImport = new Set<string>();
      const docsToWrite: Array<{ id: string; data: EricssonRow }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumberInFile = row.rowNumberInFile || (i + 2);

        const cleanA = (row.siteIdA || row.fields?.['01.21.Site ID A'] || row.fields?.['Site ID A'] || '').trim().toUpperCase();
        const cleanB = (row.siteIdB || row.fields?.['01.21.Site ID B'] || row.fields?.['Site ID B'] || '').trim().toUpperCase();
        const isPlaceholder = (s: string) =>
          !s || s === '—' || s === '-' || s === '--' || s === 'N/A' || s === '#N/A' ||
          s === 'TOTAL' || s === 'TOTAL GERAL' || s === 'SOMA' || s === 'SUBTOTAL' || s === '0' || s === 'LEGENDA';

        const fieldsList = row.fields ? Object.values(row.fields) : [];
        const hasAnyContent = fieldsList.some((v) => String(v ?? '').trim().length > 0);

        // REGRA 5: Na Ericsson, ignore linhas totalmente vazias e também linhas de total, subtotal e legenda
        const isTotalOrLegend = fieldsList.some((v) => {
          const u = String(v ?? '').trim().toUpperCase();
          return u === 'TOTAL GERAL' || u === 'SUBTOTAL' || u === 'LEGENDA';
        });

        if (!hasAnyContent || (isPlaceholder(cleanA) && isPlaceholder(cleanB)) || isTotalOrLegend) {
          comErro++;
          continue;
        }

        const baseDocId = sanitizeEricssonDocId(row) || `ERIC_${rowNumberInFile}`;

        // REGRA 2: If base ID does NOT exist yet and not used by another line in same import, use base ID.
        // Otherwise, create unique ID: baseDocId + "__" + importCode + "_" + rowNumberInFile.
        let finalDocId = baseDocId;
        if (existingIds.has(baseDocId) || usedIdsInThisImport.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        usedIdsInThisImport.add(finalDocId);

        // REGRA 4: Grave os textos das células exatamente como estão
        const newRecord: EricssonRow = {
          ...row,
          id: finalDocId,
          fileName,
          sheetName: row.sheetName || options?.sheetName || 'ERICSSON CLARO TX',
          rowNumberInFile,
          importCode,
          createdAt: row.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newRecord),
        });
      }

      // REGRA 3: set simples SEM merge
      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_ericsson_sites`,
        fileName,
        target: 'ERICSSON_SITES',
        sheetName: options?.sheetName || 'ERICSSON CLARO TX',
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: rows.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: rows.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error('Erro no lote ericsson_sites:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.ERICSSON_SITES}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async importarTssrNokiaEmLote(
    rows: TssrRow[],
    _users?: AmetaUser[],
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      sheetName?: string;
      tabName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: TssrRow[];
    errorMessage?: string;
  }> {
    const importCode = options?.importCode || generateImportCode();
    const fileName = options?.sourceFileName || 'Planilha Nokia TSSR';
    let comErro = 0;
    let lotes = 0;
    let totalGravados = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      const existingIds = new Set<string>(snap.docs.map((d) => d.id));

      const usedIdsInThisImport = new Set<string>();
      const docsToWrite: Array<{ id: string; data: TssrRow }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumberInFile = row.rowNumberInFile || (i + 2);

        const fieldsList = row.fields ? Object.values(row.fields) : [];
        const hasContent = Boolean(
          (row.siteId && String(row.siteId).trim()) ||
          (row.sigla && String(row.sigla).trim()) ||
          (row.ocSitePre && String(row.ocSitePre).trim()) ||
          fieldsList.some((v) => String(v ?? '').trim().length > 0)
        );

        if (!hasContent) {
          comErro++;
          continue;
        }

        const cleanKey = (row.siteId || row.sigla || row.id || `TSSR_${rowNumberInFile}`).toString().trim();
        const baseDocId = row.id || `TSSR_${cleanKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        // REGRA 2: If base ID does NOT exist yet and not used by another line in same import, use base ID.
        // Otherwise, create unique ID: baseDocId + "__" + importCode + "_" + rowNumberInFile.
        let finalDocId = baseDocId;
        if (existingIds.has(baseDocId) || usedIdsInThisImport.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        usedIdsInThisImport.add(finalDocId);

        // REGRA 4: Grave os textos das células exatamente como estão
        const newRecord: TssrRow = {
          ...row,
          id: finalDocId,
          fileName,
          sheetName: row.sheetName || options?.sheetName || options?.tabName || 'TSSR TIM Nokia',
          tabName: row.tabName || options?.tabName || options?.sheetName || 'TSSR TIM Nokia',
          rowNumberInFile,
          importCode,
          createdAt: row.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newRecord),
        });
      }

      // REGRA 3: set simples SEM merge
      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_nokia_tssr`,
        fileName,
        target: 'NOKIA_TSSR',
        sheetName: options?.sheetName || options?.tabName || 'TSSR TIM Nokia',
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: rows.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: rows.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error('Erro no lote nokia_tssr:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.NOKIA_TSSR}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async excluirTssrNokia(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, rowId));
  }

  async importarEricssonEngenhariaEmLote(
    rows: any[],
    options?: {
      mode?: 'append_only';
      sourceFileName?: string;
      sheetName?: string;
      importCode?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: EricssonEngineeringRow[];
    errorMessage?: string;
  }> {
    const importCode = options?.importCode || generateImportCode();
    const fileName = options?.sourceFileName || 'Planilha Ericsson Engenharia';
    let comErro = 0;
    let lotes = 0;
    let totalGravados = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA));
      const existingIds = new Set<string>(snap.docs.map((d) => d.id));

      const usedIdsInThisImport = new Set<string>();
      const docsToWrite: Array<{ id: string; data: EricssonEngineeringRow }> = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNumberInFile = r.rowNumberInFile || (i + 2);

        const fieldsList = r.fields ? Object.values(r.fields) : [];
        const hasContent = Boolean(
          (r.intervencaoClaro && String(r.intervencaoClaro).trim()) ||
          (r.siteIdA && String(r.siteIdA).trim()) ||
          fieldsList.some((v) => String(v ?? '').trim().length > 0)
        );

        // REGRA 5: Na Ericsson, ignore também linhas de total, subtotal e legenda
        const isTotalOrLegend = fieldsList.some((v) => {
          const u = String(v ?? '').trim().toUpperCase();
          return u === 'TOTAL GERAL' || u === 'SUBTOTAL' || u === 'LEGENDA' || u === 'TOTAL';
        });

        if (!hasContent || isTotalOrLegend) {
          comErro++;
          continue;
        }

        const cleanIntervencao = (r.intervencaoClaro || r.fields?.['Intervencao Claro'] || r.siteIdA || r.id || `ENG_${rowNumberInFile}`).toString().trim();
        const uniqueKey = (r.rowKey || `${cleanIntervencao}__${r.tipoDoc || r.fields?.['Tipo doc'] || ''}__${rowNumberInFile}`).toString().trim().toUpperCase();
        const baseDocId = r.id || `eric_eng_${uniqueKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        // REGRA 2: If base ID does NOT exist yet and not used by another line in same import, use base ID.
        // Otherwise, create unique ID: baseDocId + "__" + importCode + "_" + rowNumberInFile.
        let finalDocId = baseDocId;
        if (existingIds.has(baseDocId) || usedIdsInThisImport.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        usedIdsInThisImport.add(finalDocId);

        // REGRA 4: Grave os textos das células exatamente como estão
        const newRecord: EricssonEngineeringRow = {
          ...r,
          id: finalDocId,
          fileName,
          sheetName: r.sheetName || options?.sheetName || 'Site List',
          rowNumberInFile,
          importCode,
          updatedAt: r.updatedAt || new Date().toISOString(),
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newRecord),
        });
      }

      // REGRA 3: set simples SEM merge
      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_ericsson_eng`,
        fileName,
        target: 'ERICSSON_ENGENHARIA',
        sheetName: options?.sheetName || 'Site List',
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: rows.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: rows.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error('Erro no lote ericsson_engenharia:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async carregarEricssonEngenharia(): Promise<any[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('Erro ao carregar ericsson_engenharia:', err);
      return [];
    }
  }

  async carregarEricssonReprovacoes(): Promise<any[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_REPROVACOES));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('Erro ao carregar ericsson_reprovacoes:', err);
      return [];
    }
  }

  async salvarEricssonEngenhariaRow(row: any): Promise<void> {
    const docId = row.id || `eric_eng_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId), sanitizeFirestoreData({
      ...row,
      id: docId,
    }), { merge: true });
  }

  async atualizarMetaEricssonEngenharia(row: EricssonEngineeringRow, novaMeta: string): Promise<void> {
    const docId = row.id;
    const nowIso = new Date().toISOString();
    const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
    try {
      await updateDoc(docRef, {
        meta: novaMeta,
        'fields.Meta': novaMeta,
        updatedAt: nowIso,
      });
    } catch {
      await setDoc(
        docRef,
        sanitizeFirestoreData({
          ...row,
          meta: novaMeta,
          fields: {
            ...(row.fields || {}),
            Meta: novaMeta,
          },
          updatedAt: nowIso,
        }),
        { merge: true }
      );
    }
  }

  async atualizarStatusEricssonEngenharia(row: EricssonEngineeringRow, novoStatus: string): Promise<void> {
    const docId = row.id;
    const nowIso = new Date().toISOString();
    const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
    try {
      await updateDoc(docRef, {
        status: novoStatus,
        'fields.Status': novoStatus,
        updatedAt: nowIso,
      });
    } catch {
      await setDoc(
        docRef,
        sanitizeFirestoreData({
          ...row,
          status: novoStatus,
          fields: {
            ...(row.fields || {}),
            Status: novoStatus,
          },
          updatedAt: nowIso,
        }),
        { merge: true }
      );
    }
  }

  async excluirEricssonEngenhariaRow(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, rowId));
  }

  async salvarEricssonReprovacao(record: any): Promise<void> {
    const docId = record.id || `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_REPROVACOES, docId), sanitizeFirestoreData({
      ...record,
      id: docId,
      createdAt: record.createdAt || new Date().toISOString(),
    }), { merge: true });
  }

  async excluirEricssonReprovacao(recordId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_REPROVACOES, recordId));
  }

  async salvarClaroMeta(meta: ClaroSheetMeta): Promise<void> {
    await setDoc(
      doc(db, FIRESTORE_COLLECTIONS.CLARO_META, meta.id),
      sanitizeFirestoreData({
        ...meta,
        lastSyncAt: meta.lastSyncAt || new Date().toISOString(),
      }),
      { merge: true }
    );
  }

  async importarSitesClaroEmLote(
    rowsInput: Array<Partial<TelecomSite> | Partial<ClaroSiteRow>>,
    options?: {
      columns?: string[];
      fileName?: string;
      sheetName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: ClaroSiteRow[];
    errorMessage?: string;
  }> {
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;
    const importCode = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.random().toString(36).slice(2, 6);
    const fileName = options?.fileName || 'Planilha Claro Sites';
    const sheetName = options?.sheetName || 'Claro – Sites';

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.CLARO_SITES));
      const existingById = new Set<string>(snap.docs.map((d) => d.id));
      const seenInBatch = new Set<string>();
      const orderedColumns: string[] = options?.columns ? [...options.columns] : [];

      const docsToWrite: Array<{ id: string; data: ClaroSiteRow }> = [];

      for (let idx = 0; idx < rowsInput.length; idx++) {
        const raw = rowsInput[idx] as any;
        const fields: Record<string, string> = {
          ...(raw.fields || raw.customFields || {}),
        };

        // Ignore completely empty rows; all other rows enter
        const hasAnyContent = Object.values(fields).some(
          (val) => val !== undefined && val !== null && String(val).trim() !== ''
        );
        if (!hasAnyContent) {
          comErro++;
          continue;
        }

        // Ensure any new headers in fields are tracked in orderedColumns
        for (const k of Object.keys(fields)) {
          if (k && !orderedColumns.includes(k)) {
            orderedColumns.push(k);
          }
        }

        const rowNumberInFile = raw.rowNumberInFile || idx + 2;
        const resolvedSiteId =
          resolveClaroSiteIdFromFields(fields, orderedColumns, rowNumberInFile) ||
          String(raw.siteId || rowNumberInFile).trim();
        const resolvedExecutor =
          resolveClaroExecutorFromFields(fields, orderedColumns) ||
          (raw.executor || raw.responsavelCampo || raw.equipe || '').trim();

        const cleanSiteKey = resolvedSiteId
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        const baseDocId = `CLARO_SITE_${cleanSiteKey || `ROW_${rowNumberInFile}`}`;

        // Repeated rows are independent (unique ID with suffix)
        let finalDocId = baseDocId;
        if (existingById.has(baseDocId) || seenInBatch.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        seenInBatch.add(finalDocId);

        const nowIso = new Date().toISOString();
        const newRecord: ClaroSiteRow = {
          id: finalDocId,
          siteId: resolvedSiteId,
          vendor: 'CLARO_TIM',
          sheetName,
          fields,
          executor: resolvedExecutor,
          equipe: resolvedExecutor,
          responsavelDemand: raw.responsavelDemand || '',
          responsaveisUids: Array.isArray(raw.responsaveisUids) ? raw.responsaveisUids : [],
          responsaveisEmails: Array.isArray(raw.responsaveisEmails) ? raw.responsaveisEmails : [],
          fileName,
          rowNumberInFile,
          importCode,
          createdAt: raw.createdAt || nowIso,
          updatedAt: nowIso,
          updatedBy: options?.actorEmail || raw.updatedBy || 'Importação Claro',
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newRecord),
        });
      }

      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.CLARO_SITES, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      // Save column order metadata in claro_meta/sites
      if (orderedColumns.length > 0) {
        await this.salvarClaroMeta({
          id: 'sites',
          columns: orderedColumns,
          sourceFileName: fileName,
          sheetName,
          lastSyncAt: new Date().toISOString(),
          totalRows: snap.size + docsToWrite.length,
        });
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_claro_sites`,
        fileName,
        target: 'CLARO_SITES',
        sheetName,
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: rowsInput.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: rowsInput.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error('Erro no lote claro_sites:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.CLARO_SITES}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rowsInput.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async importarEngenhariaClaroEmLote(
    rowsInput: Array<Partial<TelecomSite> | Partial<ClaroEngenhariaRow>>,
    options?: {
      columns?: string[];
      fileName?: string;
      sheetName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    novosRegistros: ClaroEngenhariaRow[];
    errorMessage?: string;
  }> {
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;
    const importCode = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.random().toString(36).slice(2, 6);
    const fileName = options?.fileName || 'Planilha Claro Engenharia';
    const sheetName = options?.sheetName || 'Claro – Engenharia';

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA));
      const existingById = new Set<string>(snap.docs.map((d) => d.id));
      const seenInBatch = new Set<string>();
      const orderedColumns: string[] = options?.columns ? [...options.columns] : [];

      const docsToWrite: Array<{ id: string; data: ClaroEngenhariaRow }> = [];

      for (let idx = 0; idx < rowsInput.length; idx++) {
        const raw = rowsInput[idx] as any;
        const fields: Record<string, string> = {
          ...(raw.fields || raw.customFields || {}),
        };

        // Ignore completely empty rows; all other rows enter
        const hasAnyContent = Object.values(fields).some(
          (val) => val !== undefined && val !== null && String(val).trim() !== ''
        );
        if (!hasAnyContent) {
          comErro++;
          continue;
        }

        for (const k of Object.keys(fields)) {
          if (k && !orderedColumns.includes(k)) {
            orderedColumns.push(k);
          }
        }

        const rowNumberInFile = raw.rowNumberInFile || idx + 2;
        const resolvedSiteId =
          resolveClaroSiteIdFromFields(fields, orderedColumns, rowNumberInFile) ||
          String(raw.siteId || rowNumberInFile).trim();
        const resolvedExecutor =
          resolveClaroExecutorFromFields(fields, orderedColumns) ||
          (raw.executor || raw.responsavelCampo || raw.equipe || '').trim();

        const cleanSiteKey = resolvedSiteId
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        const baseDocId = `CLARO_ENG_${cleanSiteKey || `ROW_${rowNumberInFile}`}`;

        // Repeated rows are independent (unique ID with suffix)
        let finalDocId = baseDocId;
        if (existingById.has(baseDocId) || seenInBatch.has(baseDocId)) {
          finalDocId = `${baseDocId}__${importCode}_${rowNumberInFile}`;
        }
        seenInBatch.add(finalDocId);

        const nowIso = new Date().toISOString();
        const newRecord: ClaroEngenhariaRow = {
          id: finalDocId,
          siteId: resolvedSiteId,
          vendor: 'CLARO_TIM',
          sheetName,
          fields,
          executor: resolvedExecutor,
          equipe: resolvedExecutor,
          responsavelDemand: raw.responsavelDemand || '',
          responsaveisUids: Array.isArray(raw.responsaveisUids) ? raw.responsaveisUids : [],
          responsaveisEmails: Array.isArray(raw.responsaveisEmails) ? raw.responsaveisEmails : [],
          fileName,
          rowNumberInFile,
          importCode,
          createdAt: raw.createdAt || nowIso,
          updatedAt: nowIso,
          updatedBy: options?.actorEmail || raw.updatedBy || 'Importação Claro',
        };

        docsToWrite.push({
          id: finalDocId,
          data: sanitizeFirestoreData(newRecord),
        });
      }

      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA, item.id), item.data);
        }
        await batch.commit();
        totalGravados += chunk.length;
        lotes++;
        if (options?.onProgress) {
          options.onProgress({
            gravados: totalGravados,
            total: docsToWrite.length,
            lote: lotes,
            totalLotes,
          });
        }
      }

      // Save column order metadata in claro_meta/engenharia
      if (orderedColumns.length > 0) {
        await this.salvarClaroMeta({
          id: 'engenharia',
          columns: orderedColumns,
          sourceFileName: fileName,
          sheetName,
          lastSyncAt: new Date().toISOString(),
          totalRows: snap.size + docsToWrite.length,
        });
      }

      await this.registrarHistoricoImportacao({
        id: `imp_${importCode}_claro_eng`,
        fileName,
        target: 'CLARO_ENGENHARIA',
        sheetName,
        importCode,
        importedAt: new Date().toISOString(),
        totalLidas: rowsInput.length,
        totalAdicionadas: docsToWrite.length,
        totalIgnoradas: comErro,
      });

      return {
        totalAnalisados: rowsInput.length,
        novas: docsToWrite.length,
        jaExistiam: 0,
        comErro,
        totalGravados: docsToWrite.length,
        lotesExecutados: lotes || 1,
        novosRegistros: docsToWrite.map((d) => d.data),
      };
    } catch (err: any) {
      console.error('Erro no lote claro_engenharia:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rowsInput.length,
        novas: 0,
        jaExistiam: 0,
        comErro,
        totalGravados: 0,
        lotesExecutados: lotes,
        novosRegistros: [],
        errorMessage: errMsg,
      };
    }
  }

  async salvarClaroSiteRow(row: ClaroSiteRow): Promise<void> {
    const docId = row.id || `CLARO_SITE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(
      doc(db, FIRESTORE_COLLECTIONS.CLARO_SITES, docId),
      sanitizeFirestoreData({
        ...row,
        id: docId,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  }

  async excluirClaroSiteRow(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CLARO_SITES, rowId));
  }

  async salvarClaroEngenhariaRow(row: ClaroEngenhariaRow): Promise<void> {
    const docId = row.id || `CLARO_ENG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(
      doc(db, FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA, docId),
      sanitizeFirestoreData({
        ...row,
        id: docId,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  }

  async excluirClaroEngenhariaRow(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA, rowId));
  }

  async salvarSiteNokia(
    site: TelecomSite,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const isClaro = site.vendor === 'CLARO_TIM';
    const targetCollection = isClaro
      ? FIRESTORE_COLLECTIONS.CLARO_SITES
      : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const docId =
      site.id && site.id.includes('__')
        ? site.id
        : sanitizeSiteDocId(site.id || site.siteId, isClaro ? 'Controle Geral' : site.sheetName);
    await setDoc(
      doc(db, targetCollection, docId),
      sanitizeFirestoreData({
        ...site,
        id: docId,
        vendor: isClaro ? 'CLARO_TIM' : (site.vendor || 'NOKIA'),
        sheetName: isClaro ? 'Controle Geral' : (site.sheetName || 'Controle Geral'),
      }),
      { merge: true }
    );
  }

  async excluirSiteNokia(siteId: string, vendor?: VendorType): Promise<void> {
    if (vendor === 'CLARO_TIM') {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CLARO_SITES, siteId));
    } else {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, siteId));
    }
  }

  async carregarSitesNokia(): Promise<TelecomSite[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TelecomSite));
    } catch (err) {
      console.error('Erro ao carregar nokia_sites:', err);
      return [];
    }
  }

  async salvarSiteEricsson(
    row: EricssonRow,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const docId = sanitizeEricssonDocId(row);
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId), sanitizeFirestoreData({
      ...row,
      id: docId,
    }), { merge: true });
  }

  async atualizarMetaEricssonSite(row: EricssonRow, novaMeta: string): Promise<void> {
    const docId = row.id || sanitizeEricssonDocId(row);
    const nowIso = new Date().toISOString();
    const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
    try {
      await updateDoc(docRef, {
        meta: novaMeta,
        'fields.Meta': novaMeta,
        updatedAt: nowIso,
      });
    } catch {
      await setDoc(
        docRef,
        sanitizeFirestoreData({
          ...row,
          meta: novaMeta,
          fields: {
            ...(row.fields || {}),
            Meta: novaMeta,
          },
          updatedAt: nowIso,
        }),
        { merge: true }
      );
    }
  }

  async excluirSiteEricsson(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, rowId));
  }

  async carregarSitesEricsson(): Promise<EricssonRow[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EricssonRow));
    } catch (err) {
      console.error('Erro ao carregar ericsson_sites:', err);
      return [];
    }
  }

  async salvarTssrNokia(row: TssrRow): Promise<void> {
    const docId = row.id || `TSSR_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, docId), sanitizeFirestoreData({
      ...row,
      id: docId,
    }), { merge: true });
  }

  async salvarPastaNokia(folder: EngineeringFolder): Promise<void> {
    const docId = folder.id || `FOLDER_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS, docId), sanitizeFirestoreData({
      ...folder,
      id: docId,
    }), { merge: true });
  }

  async excluirPastaNokia(folderId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS, folderId));
  }

  async salvarArquivoNokia(
    file: EngineeringFile,
    _users?: AmetaUser[],
    _sites?: TelecomSite[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const docId = file.id || `FILE_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, docId), sanitizeFirestoreData({
      ...file,
      id: docId,
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    }), { merge: true });

    if (file.fileName) {
      try {
        const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
        await setDoc(notifRef, sanitizeFirestoreData({
          id: notifRef.id,
          type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
          vendor: 'NOKIA',
          title: `Novo Arquivo: ${file.fileName}`,
          message: `Arquivo ${file.fileName} disponibilizado no site/pasta ${file.siteId || ''}.`,
          siteId: file.siteId || '',
          fileName: file.fileName,
          actorName: file.uploadedByName || 'Engenharia',
          actorEmail: file.uploadedByEmail || '',
          targetRoles: ['Vistoriador', 'Executor', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
          readByEmails: [],
          createdAt: new Date().toISOString(),
        }));
      } catch (err) {
        console.warn('Erro ao criar notificacao de arquivo Nokia:', err);
      }
    }
  }

  async excluirArquivoNokia(fileId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, fileId));
  }

  async salvarPastaEricsson(folder: EngineeringFolder): Promise<void> {
    const docId = folder.id || `FOLDER_ERIC_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS, docId), sanitizeFirestoreData({
      ...folder,
      id: docId,
    }), { merge: true });
  }

  async excluirPastaEricsson(folderId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS, folderId));
  }

  async salvarArquivoEricsson(
    file: EngineeringFile,
    _users?: AmetaUser[],
    _rows?: EricssonRow[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const docId = file.id || `FILE_ERIC_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, docId), sanitizeFirestoreData({
      ...file,
      id: docId,
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    }), { merge: true });

    if (file.fileName) {
      try {
        const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
        await setDoc(notifRef, sanitizeFirestoreData({
          id: notifRef.id,
          type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
          vendor: 'ERICSSON',
          title: `Novo Arquivo Ericsson: ${file.fileName}`,
          message: `Arquivo ${file.fileName} disponibilizado no site/pasta ${file.siteId || ''}.`,
          siteId: file.siteId || '',
          fileName: file.fileName,
          actorName: file.uploadedByName || 'Engenharia Ericsson',
          actorEmail: file.uploadedByEmail || '',
          targetRoles: ['Vistoriador', 'Executor', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
          readByEmails: [],
          createdAt: new Date().toISOString(),
        }));
      } catch (err) {
        console.warn('Erro ao criar notificacao de arquivo Ericsson:', err);
      }
    }
  }

  async excluirArquivoEricsson(fileId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, fileId));
  }

  async salvarMapaDuplas(
    duplaEmailsMap: Record<string, string[]>,
    customDuplas?: string[]
  ): Promise<void> {
    await setDoc(doc(db, 'duplas_config', 'main'), sanitizeFirestoreData({
      duplaEmailsMap,
      customDuplas,
      updatedAt: new Date().toISOString(),
    }), { merge: true });
  }

  async carregarMapaDuplas(): Promise<{
    duplaEmailsMap?: Record<string, string[]>;
    customDuplas?: string[];
  }> {
    try {
      const snap = await getDoc(doc(db, 'duplas_config', 'main'));
      if (snap.exists()) {
        return snap.data() as any;
      }
    } catch {
      // ignore
    }
    return {};
  }

  async criarNotificacao(notif: AmetaNotification): Promise<void> {
    const docId = notif.id || `NOTIF_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, docId), sanitizeFirestoreData({
      ...notif,
      id: docId,
      createdAt: notif.createdAt || new Date().toISOString(),
    }), { merge: true });
  }

  async registrarNovoUsuarioCorporativo(params: {
    name: string;
    email: string;
    password: string;
    cpf?: string;
    role?: UserRole;
    equipe?: string;
    telefone?: string;
    plataforma?: AssignedPlatformScope;
  }): Promise<AmetaUser> {
    const cred = await createUserWithEmailAndPassword(auth, params.email, params.password);
    const uid = cred.user.uid;
    const cleanEmail = params.email.trim().toLowerCase();

    const newUser = buildAmetaUserProfile({
      uid,
      email: cleanEmail,
      name: params.name,
      role: params.role,
      equipe: params.equipe,
      telefone: params.telefone,
      plataforma: params.plataforma,
    });

    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid), sanitizeFirestoreData(newUser));

      // Gravar dados sensíveis (cpf, hash inicial, sal) na subcoleção privada
      if (params.cpf || params.password) {
        const { hash, salt } = await createSaltedHash(params.password);
        await setDoc(
          doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid, 'privado', 'dados'),
          sanitizeFirestoreData({
            cpf: params.cpf ? params.cpf.trim() : '',
            initialPasswordHash: hash,
            salt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        );
      }
    } catch (dbError: any) {
      let authDeleteStatus = 'Conta recém-criada no Authentication foi excluída com sucesso.';
      try {
        await deleteUser(cred.user);
      } catch (delErr: any) {
        authDeleteStatus = `Falha ao excluir conta no Authentication: ${delErr?.code || delErr?.message || delErr}`;
      }
      const code = dbError?.code || 'firestore/error';
      const msg = dbError?.message || String(dbError);
      throw new Error(
        `[Erro ao gravar perfil em usuarios/${uid}] Etapa: gravação do documento inicial do usuário no Firestore (setDoc). Código: ${code}. Detalhe: ${msg}. Ação compensatória: ${authDeleteStatus}`
      );
    }

    return newUser;
  }

  async obterDadosPrivadosUsuario(
    uid: string
  ): Promise<UserPrivateData | null> {
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid, 'privado', 'dados'));
      if (snap.exists()) {
        return snap.data() as UserPrivateData;
      }
      return null;
    } catch (err) {
      console.warn(`[dataService] Não foi possível obter usuarios/${uid}/privado/dados:`, err);
      return null;
    }
  }

  async salvarDadosPrivadosUsuario(
    uid: string,
    dados: UserPrivateData
  ): Promise<void> {
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid, 'privado', 'dados'),
        sanitizeFirestoreData({
          ...dados,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `${FIRESTORE_COLLECTIONS.USUARIOS}/${uid}/privado/dados`
      );
    }
  }

  async autenticarUsuarioCorporativo(params: {
    email: string;
    password: string;
  }): Promise<AmetaUser | null> {
    const cred = await signInWithEmailAndPassword(auth, params.email, params.password);
    const uid = cred.user.uid;
    const userDoc = await this.obterUsuarioPorUid(uid);
    if (userDoc) return userDoc;

    return this.garantirUsuarioAoAutenticar({
      uid,
      email: params.email,
      name: params.email.split('@')[0],
      emailVerified: true,
    });
  }

  async salvarDocumentosUsuario(params: {
    uidOrId: string;
    email: string;
    documents: any[];
    dispensadoDocumentos?: boolean;
    statusRecurso?: string;
  }): Promise<void> {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.uidOrId);
    await updateDoc(
      userRef,
      sanitizeFirestoreData({
        documents: params.documents,
        dispensadoDocumentos: params.dispensadoDocumentos ?? false,
        statusRecurso: params.statusRecurso || 'analise',
      })
    );
  }

  async garantirDocumentoUsuarioNoCadastro(
    uid: string,
    email: string,
    name: string
  ): Promise<AmetaUser> {
    return this.garantirUsuarioAoAutenticar({
      uid,
      email,
      name,
      emailVerified: true,
    });
  }

  async obterPerfilUsuario(uid: string): Promise<AmetaUser | null> {
    return this.obterUsuarioPorUid(uid);
  }

  async atualizarPermissoesUsuario(
    uid: string,
    payload: {
      email: string;
      name: string;
      situacao: UserSituacao;
      role: UserRole;
      plataforma: AssignedPlatformScope;
      equipe?: string;
      telefone?: string;
      atividade?: string;
    }
  ): Promise<AmetaUser> {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid);
    const snap = await getDoc(userRef);
    const existing = snap.exists() ? (snap.data() as AmetaUser) : {};
    const accessReleased = payload.situacao === 'ativo' || payload.situacao === 'dono';

    const rawPlat = String(payload.plataforma || '').trim().toUpperCase();
    const normalizedPlat = (rawPlat === 'BOTH' ? 'AMBAS' : rawPlat) as AssignedPlatformScope;

    const merged = {
      ...existing,
      ...payload,
      plataforma: normalizedPlat,
      assignedPlatform: normalizedPlat,
      accessReleased,
    };

    await setDoc(userRef, sanitizeFirestoreData(merged), { merge: true });
    return { id: uid, uid, ...merged } as AmetaUser;
  }

  async excluirUsuario(uidOrId: string, _email?: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uidOrId));
  }

  observarPerfilUsuario(uid: string, onUpdate: (user: AmetaUser | null) => void): Unsubscribe {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid);
    return onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        onUpdate({ id: snap.id, uid: snap.id, ...snap.data() } as AmetaUser);
      } else {
        onUpdate(null);
      }
    }, (err) => {
      console.error('Perfil user snapshot error:', err);
      onUpdate(null);
    });
  }

  async marcarNotificacaoLida(notificationId?: string, markAll = false, userEmail?: string): Promise<void> {
    const cleanEmail = (userEmail || '').trim().toLowerCase();
    if (markAll && cleanEmail) {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        const data = d.data();
        const currentRead = Array.isArray(data.readByEmails) ? [...data.readByEmails] : [];
        if (!currentRead.includes(cleanEmail)) {
          currentRead.push(cleanEmail);
          batch.update(d.ref, {
            read: true,
            readByEmails: currentRead,
          });
        }
      });
      await batch.commit();
    } else if (notificationId) {
      const notifRef = doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, notificationId);
      const snap = await getDoc(notifRef);
      if (snap.exists()) {
        const data = snap.data();
        const currentRead = Array.isArray(data.readByEmails) ? [...data.readByEmails] : [];
        if (cleanEmail && !currentRead.includes(cleanEmail)) {
          currentRead.push(cleanEmail);
        }
        await updateDoc(notifRef, sanitizeFirestoreData({
          read: true,
          readByEmails: currentRead,
        }));
      }
    }
  }

  async excluirNotificacao(id: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, id));
  }

  async bloquearUsuario(uid: string, motivo?: string): Promise<void> {
    await updateDoc(
      doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid),
      sanitizeFirestoreData({
        situacao: 'bloqueado',
        accessReleased: false,
        bloqueadoEm: new Date().toISOString(),
        motivoBloqueio: motivo || 'Acesso bloqueado pelo administrador (conta Auth preservada)',
      })
    );
  }

  // Audit Log recording
  async registrarAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
    try {
      const docRef = doc(collection(db, FIRESTORE_COLLECTIONS.AUDIT_LOGS));
      await setDoc(
        docRef,
        sanitizeFirestoreData({
          ...entry,
          id: docRef.id,
          createdAt: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error('Erro ao gravar log de auditoria:', err);
    }
  }

  async obterAuditLogs(): Promise<AuditLogEntry[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.AUDIT_LOGS));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogEntry));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return list;
    } catch {
      return [];
    }
  }

  // Desativar ou Reativar usuário garantindo a proteção de pelo menos 2 ADMs ativos
  async desativarOuReativarUsuario(params: {
    targetUid: string;
    desativar: boolean;
    actorEmail: string;
  }): Promise<void> {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.targetUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      throw new Error('Usuário não encontrado.');
    }
    const user = snap.data() as AmetaUser;

    // Regra de segurança: Garantir pelo menos dois ADMs ativos
    if (params.desativar && (user.role === 'ADM' || isOwnerAdmUser(user.email, user.situacao))) {
      const allUsers = await this.listarTodosUsuarios();
      const activeAdms = allUsers.filter(
        (u) =>
          (u.role === 'ADM' || isOwnerAdmUser(u.email, u.situacao)) &&
          u.situacao !== 'bloqueado' &&
          !u.desativado &&
          u.id !== params.targetUid &&
          u.uid !== params.targetUid
      );

      if (activeAdms.length < 1) {
        throw new Error(
          'Operação recusada: É obrigatório manter pelo menos dois administradores ativos no sistema. Não é permitido desativar o último ADM ativo.'
        );
      }
    }

    const nextSituacao: UserSituacao = params.desativar ? 'bloqueado' : 'ativo';
    await updateDoc(
      userRef,
      sanitizeFirestoreData({
        situacao: nextSituacao,
        desativado: params.desativar,
        accessReleased: !params.desativar,
        updatedAt: new Date().toISOString(),
      })
    );

    await this.registrarAuditLog({
      action: params.desativar ? 'DISABLE_USER' : 'REACTIVATE_USER',
      actorEmail: params.actorEmail,
      targetEmail: user.email,
      targetName: user.name,
      details: params.desativar
        ? `Usuário/Equipe ${user.name} (${user.email}) foi desativado(a). Histórico e demandas mantidos.`
        : `Usuário/Equipe ${user.name} (${user.email}) foi reativado(a).`,
    });
  }

  // Redefinir senha inicial pelo ADM
  async redefinirSenhaUsuario(params: {
    targetUid: string;
    newInitialPassword: string;
    actorEmail: string;
  }): Promise<void> {
    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.targetUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      throw new Error('Usuário não encontrado.');
    }
    const user = snap.data() as AmetaUser;
    const { hash: pwdHash, salt } = await createSaltedHash(params.newInitialPassword);

    // Gravar o hash com sal na subcoleção privada
    await setDoc(
      doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.targetUid, 'privado', 'dados'),
      sanitizeFirestoreData({
        initialPasswordHash: pwdHash,
        salt,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );

    await updateDoc(
      userRef,
      sanitizeFirestoreData({
        mustChangePassword: true,
        batchStatus: 'Aguardando primeiro acesso',
        failedAttempts: 0,
        lockoutUntil: null,
        updatedAt: new Date().toISOString(),
      })
    );

    await this.registrarAuditLog({
      action: 'RESET_PASSWORD',
      actorEmail: params.actorEmail,
      targetEmail: user.email,
      targetName: user.name,
      details: `Senha inicial redefinida para ${user.name} (${user.email}). Troca obrigatória no primeiro acesso ativada.`,
    });
  }

  // Encerrar senha inicial do lote (ADM)
  async encerrarSenhaInicialLote(params: {
    batchId: string;
    actorEmail: string;
  }): Promise<{ updatedCount: number }> {
    const snap = await getDocs(
      query(
        collection(db, FIRESTORE_COLLECTIONS.USUARIOS),
        where('batchId', '==', params.batchId)
      )
    );

    let count = 0;
    const batch = writeBatch(db);

    for (const docSnap of snap.docs) {
      const u = docSnap.data() as AmetaUser;
      if (u.mustChangePassword && u.batchStatus !== 'Concluído') {
        batch.update(docSnap.ref, sanitizeFirestoreData({
          batchStatus: 'Pendente de liberação',
          updatedAt: new Date().toISOString(),
        }));
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    await this.registrarAuditLog({
      action: 'END_BATCH_PASSWORD',
      actorEmail: params.actorEmail,
      details: `Senha inicial do lote "${params.batchId}" encerrada pelo ADM. ${count} conta(s) alteradas para 'Pendente de liberação'.`,
    });

    return { updatedCount: count };
  }

  async atribuirDemandaSites(params: {
    siteTokens: string[];
    responsibleName: string;
    linkedEmails?: string[];
    vendor: VendorType;
    actorEmail?: string;
    actorName?: string;
    allowTransfer?: boolean;
    demandDate?: string;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number; sitesWithoutEmailCount?: number }> {
    const targetDate = params.demandDate || new Date().toLocaleDateString('pt-BR');
    const nowIso = new Date().toISOString();
    const emailStr = params.linkedEmails && params.linkedEmails.length > 0 ? params.linkedEmails.join(', ') : '';
    let count = 0;
    const isExecutor = params.targetScope === 'executor';
    const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor ? 'EXECUTOR' : 'VISTORIA';

    const destinatariosEmails = await this.resolverDestinatariosEmails({
      responsibleName: params.responsibleName,
      linkedEmails: params.linkedEmails,
      vendor: params.vendor,
      tipoDestinatario,
    });

    if (params.vendor === 'ERICSSON') {
      const rawTokens = Array.from(new Set(params.siteTokens.map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        const acionamentosToSync: string[] = [];

        for (const rawToken of chunk) {
          const docId = rawToken.replace(/^mother-/, '');
          acionamentosToSync.push(docId);

          if (isExecutor) {
            // Write ONLY to ERICSSON_ENGENHARIA
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            const fallback = initialEricssonEngMap.get(docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                ...(fallback || {}),
                id: docId,
                responsavelDemand: params.responsibleName,
                executor: params.responsibleName,
                equipe: params.responsibleName,
                fields: {
                  ...(fallback?.fields || {}),
                  EXECUTOR: params.responsibleName,
                  'EXECUTOR WR': params.responsibleName,
                  'EXECUTOR QRF': params.responsibleName,
                  'EXECUTOR PPI': params.responsibleName,
                  Executor: params.responsibleName,
                  EQUIPE: params.responsibleName,
                  'EQUIPE EXECUTANTE': params.responsibleName,
                  Responsável: params.responsibleName,
                  'TalonView Executor': params.responsibleName,
                  'Data de demanda': targetDate,
                  'Data Demanda': targetDate,
                  ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          } else {
            // Write ONLY to ERICSSON_SITES
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
            const fallback = initialEricssonSitesMap.get(docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                ...(fallback || {}),
                id: docId,
                responsavelDemand: params.responsibleName,
                responsavelCampo: params.responsibleName,
                equipeParceira: params.responsibleName,
                equipe: params.responsibleName,
                ...(params.linkedEmails && params.linkedEmails.length > 0
                  ? { responsaveisEmails: params.linkedEmails }
                  : {}),
                fields: {
                  ...(fallback?.fields || {}),
                  EQUIPE: params.responsibleName,
                  'EQUIPE EXECUTANTE': params.responsibleName,
                  Executor: params.responsibleName,
                  Responsável: params.responsibleName,
                  'TalonView Executor': params.responsibleName,
                  'Data de demanda': targetDate,
                  'Data Demanda': targetDate,
                  ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }
          count++;
        }
        await batch.commit();

        for (const docId of acionamentosToSync) {
          let rowData: any = null;
          try {
            const snap = await getDoc(
              doc(
                db,
                isExecutor
                  ? FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA
                  : FIRESTORE_COLLECTIONS.ERICSSON_SITES,
                docId
              )
            );
            if (snap.exists()) {
              rowData = snap.data();
            }
          } catch (err) {
            // fallback
          }

          const fallback: any = isExecutor ? initialEricssonEngMap.get(docId) : initialEricssonSitesMap.get(docId);
          const canonSiteId =
            rowData?.siteIdA ||
            rowData?.siteId ||
            fallback?.siteIdA ||
            fallback?.siteId ||
            (isExecutor
              ? rowData?.intervencaoClaro || rowData?.fields?.['Intervencao Claro']
              : rowData?.fields?.['01.21.Site ID A'] || rowData?.fields?.['Site ID A']) ||
            docId;

          const canonClean = String(canonSiteId).trim().toUpperCase();

          try {
            const targetAcId = buildAcionamentoId('ERICSSON', canonClean, tipoDestinatario, docId);
            // Cancelar qualquer acionamento antigo com ID diferente para este registro/site
            const candidateOldIds = await this.resolverIdsAcionamentoEricsson(docId, tipoDestinatario);
            for (const oldId of candidateOldIds) {
              if (oldId !== targetAcId) {
                try {
                  await this.cancelarAcionamento(oldId, {
                    motivo: `Demanda reatribuída para "${params.responsibleName}"`,
                  });
                } catch {
                  // ignore
                }
              }
            }

            await this.salvarOuAtualizarAcionamento({
              id: targetAcId,
              siteId: canonClean,
              registroId: docId,
              rowNumberInFile: rowData?.rowNumberInFile || fallback?.rowNumberInFile,
              vendor: 'ERICSSON',
              tipoDestinatario,
              equipe: params.responsibleName,
              destinatariosEmails,
              demandadoPorNome: params.actorName || 'Engenharia Ericsson',
              demandadoPorEmail: params.actorEmail || '',
              demandadoEm: nowIso,
              dataDemanda: targetDate,
            });
          } catch (acErr) {
            console.warn('Erro ao sincronizar acionamento Ericsson:', acErr);
          }
        }
      }
      if (count > 0) {
        const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
        await setDoc(notifRef, sanitizeFirestoreData({
          id: notifRef.id,
          title: `Nova Demanda: ${count} site(s) Ericsson`,
          message: `${count} site(s) atribuído(s) à demanda da equipe "${params.responsibleName}".`,
          type: 'SITE_DEMANDADO_EXECUTOR',
          vendor: 'ERICSSON',
          read: false,
          readByEmails: [],
          createdAt: new Date().toISOString(),
          targetRoles: ['Executor', 'Vistoriador', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
          targetEquipes: [params.responsibleName],
          targetEmails: params.linkedEmails || [],
          actorEmail: params.actorEmail || '',
          actorName: params.actorName || 'Engenharia Ericsson',
        }));
      }
      return {
        updatedCount: count,
        sitesWithoutEmailCount: destinatariosEmails.length === 0 ? count : 0,
      };
    } else {
      // NOKIA or CLARO_TIM
      const isClaro = params.vendor === 'CLARO_TIM';
      const targetSitesCollection = isClaro
        ? FIRESTORE_COLLECTIONS.CLARO_SITES
        : FIRESTORE_COLLECTIONS.NOKIA_SITES;
      const targetVendor: VendorType = isClaro ? 'CLARO_TIM' : 'NOKIA';
      const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
      const recordsToSync: Array<{ siteId: string; registroId: string; rowNumberInFile?: number }> = [];

      if (isExecutor) {
        // Write ONLY to NOKIA_TSSR
        const tssrSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
        const batch = writeBatch(db);
        for (const d of tssrSnap.docs) {
          const data = d.data();
          const docId = d.id.toUpperCase();
          const rowId = (data.id || '').toString().trim().toUpperCase();
          const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
          const sId = (data.siteId || '').toString().trim().toUpperCase();
          if (tokens.has(docId) || (rowId && tokens.has(rowId)) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
            const canonId = sId || rowId || docId;
            recordsToSync.push({ siteId: canonId, registroId: d.id, rowNumberInFile: data.rowNumberInFile });

            batch.set(
              d.ref,
              sanitizeFirestoreData({
                executor: params.responsibleName,
                equipe: params.responsibleName,
                responsavelDemand: params.responsibleName,
                fields: {
                  ...(data.fields || {}),
                  Executor: params.responsibleName,
                  EQUIPE: params.responsibleName,
                  'EQUIPE EXECUTANTE': params.responsibleName,
                  Responsável: params.responsibleName,
                  'TalonView Executor': params.responsibleName,
                  'Data de demanda': targetDate,
                  'Data Demanda': targetDate,
                  ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
            count++;
          }
        }
        if (count > 0) {
          await batch.commit();
        }
      } else {
        // Write ONLY to NOKIA_SITES or CLARO_SITES
        const sitesSnap = await getDocs(collection(db, targetSitesCollection));
        const batch1 = writeBatch(db);
        const matchedTokens = new Set<string>();

        for (const d of sitesSnap.docs) {
          const data = d.data();
          const sId = (data.siteId || data.id || '').toString().trim().toUpperCase();
          const sColBSiteId = (data.customFields?.['SITE ID'] || '').toString().trim().toUpperCase();
          const docId = d.id.toUpperCase();
          const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
          if (
            tokens.has(docId) ||
            (rowKey && tokens.has(rowKey)) ||
            (sId && tokens.has(sId)) ||
            (sColBSiteId && tokens.has(sColBSiteId))
          ) {
            if (tokens.has(docId)) matchedTokens.add(docId);
            if (rowKey && tokens.has(rowKey)) matchedTokens.add(rowKey);
            if (sColBSiteId) matchedTokens.add(sColBSiteId);
            const canonId = sId || sColBSiteId || docId;
            recordsToSync.push({ siteId: canonId, registroId: d.id, rowNumberInFile: data.rowNumberInFile });

            batch1.set(
              d.ref,
              sanitizeFirestoreData({
                responsavelDemand: params.responsibleName,
                equipeParceira: params.responsibleName,
                responsavelCampo: params.responsibleName,
                equipe: params.responsibleName,
                ...(params.linkedEmails && params.linkedEmails.length > 0
                  ? { responsaveisEmails: params.linkedEmails }
                  : {}),
                customFields: {
                  ...(data.customFields || {}),
                  'EQUIPE EXECUTANTE': params.responsibleName,
                  EQUIPE: params.responsibleName,
                  Executor: params.responsibleName,
                  Responsável: params.responsibleName,
                  'TalonView Executor': params.responsibleName,
                  'Data de demanda': targetDate,
                  'Data Demanda': targetDate,
                  ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
            count++;
          }
        }

        // Ensure fallback initial Nokia sites not yet in Firestore are created (only for NOKIA)
        if (!isClaro) {
          for (const tk of tokens) {
            if (matchedTokens.has(tk)) continue;
            const fallback = initialNokiaSitesMap.get(tk);
            if (fallback) {
              const docId = sanitizeSiteDocId(fallback.siteId || fallback.id || tk, fallback.sheetName);
              const docRef = doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId);
              const sId = (fallback.siteId || fallback.id || tk).toString().trim().toUpperCase();
              recordsToSync.push({ siteId: sId, registroId: docId, rowNumberInFile: fallback.rowNumberInFile });

              batch1.set(
                docRef,
                sanitizeFirestoreData({
                  ...fallback,
                  responsavelDemand: params.responsibleName,
                  equipeParceira: params.responsibleName,
                  responsavelCampo: params.responsibleName,
                  equipe: params.responsibleName,
                  ...(params.linkedEmails && params.linkedEmails.length > 0
                    ? { responsaveisEmails: params.linkedEmails }
                    : {}),
                  customFields: {
                    ...(fallback.customFields || {}),
                    'EQUIPE EXECUTANTE': params.responsibleName,
                    EQUIPE: params.responsibleName,
                    Executor: params.responsibleName,
                    Responsável: params.responsibleName,
                    'TalonView Executor': params.responsibleName,
                    'Data de demanda': targetDate,
                    'Data Demanda': targetDate,
                    ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                  },
                  updatedAt: nowIso,
                }),
                { merge: true }
              );
              count++;
            }
          }
        }

        if (count > 0) {
          await batch1.commit();
        }
      }

      for (const rec of recordsToSync) {
        try {
          await this.salvarOuAtualizarAcionamento({
            siteId: rec.siteId,
            registroId: rec.registroId,
            rowNumberInFile: rec.rowNumberInFile,
            vendor: targetVendor,
            tipoDestinatario,
            equipe: params.responsibleName,
            destinatariosEmails,
            demandadoPorNome: params.actorName || (isClaro ? 'Coordenação Claro' : 'Engenharia TIM/Nokia'),
            demandadoPorEmail: params.actorEmail || '',
            demandadoEm: nowIso,
            dataDemanda: targetDate,
          });
        } catch (acErr) {
          console.warn(`Erro ao sincronizar acionamento ${targetVendor}:`, acErr);
        }
      }
    }

    if (count > 0) {
      const isClaro = params.vendor === 'CLARO_TIM';
      const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
      await setDoc(notifRef, sanitizeFirestoreData({
        id: notifRef.id,
        title: `Nova Demanda: ${count} site(s) ${isClaro ? 'Claro' : 'TIM/Nokia'}`,
        message: `${count} site(s) atribuído(s) à demanda da equipe "${params.responsibleName}".`,
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: isClaro ? 'CLARO_TIM' : 'NOKIA',
        read: false,
        readByEmails: [],
        createdAt: new Date().toISOString(),
        targetRoles: ['Executor', 'Vistoriador', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
        targetEquipes: [params.responsibleName],
        targetEmails: params.linkedEmails || [],
        actorEmail: params.actorEmail || '',
        actorName: params.actorName || (isClaro ? 'Coordenação Claro' : 'Engenharia TIM/Nokia'),
      }));
    }

    return {
      updatedCount: count,
      sitesWithoutEmailCount: destinatariosEmails.length === 0 ? count : 0,
    };
  }

  async resolverIdsAcionamentoEricsson(
    docId: string,
    tipoDestinatario: 'EXECUTOR' | 'VISTORIA'
  ): Promise<string[]> {
    const cleanDocId = (docId || '').replace(/^mother-/, '').trim();
    if (!cleanDocId) return [];

    const isExecutor = tipoDestinatario === 'EXECUTOR';
    const collName = isExecutor
      ? FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA
      : FIRESTORE_COLLECTIONS.ERICSSON_SITES;

    let rowData: any = null;
    try {
      const snap = await getDoc(doc(db, collName, cleanDocId));
      if (snap.exists()) {
        rowData = snap.data();
      }
    } catch (err) {
      console.warn(`[resolverIdsAcionamentoEricsson] Erro ao ler doc ${cleanDocId} em ${collName}:`, err);
    }

    const fallback: any = isExecutor
      ? initialEricssonEngMap.get(cleanDocId) || initialEricssonEngMap.get(docId)
      : initialEricssonSitesMap.get(cleanDocId) || initialEricssonSitesMap.get(docId);

    const siteCanonicoRaw =
      rowData?.siteIdA ||
      rowData?.siteId ||
      fallback?.siteIdA ||
      fallback?.siteId ||
      (isExecutor
        ? rowData?.intervencaoClaro || rowData?.fields?.['Intervencao Claro']
        : rowData?.fields?.['01.21.Site ID A'] || rowData?.fields?.['Site ID A']) ||
      cleanDocId;

    const siteCanonico = String(siteCanonicoRaw || cleanDocId).trim().toUpperCase();

    const idsSet = new Set<string>();

    // 1) Candidatos determinísticos montados com buildAcionamentoId
    idsSet.add(buildAcionamentoId('ERICSSON', siteCanonico, tipoDestinatario, cleanDocId));
    idsSet.add(buildAcionamentoId('ERICSSON', siteCanonico, tipoDestinatario));
    idsSet.add(buildAcionamentoId('ERICSSON', cleanDocId, tipoDestinatario));
    if (docId !== cleanDocId) {
      idsSet.add(buildAcionamentoId('ERICSSON', siteCanonico, tipoDestinatario, docId));
      idsSet.add(buildAcionamentoId('ERICSSON', docId, tipoDestinatario));
    }

    const siteIdB = (
      rowData?.siteIdB ||
      fallback?.siteIdB ||
      rowData?.fields?.['01.21.Site ID B'] ||
      rowData?.fields?.['Site ID B'] ||
      ''
    ).toString().trim().toUpperCase();

    if (siteIdB) {
      idsSet.add(buildAcionamentoId('ERICSSON', siteIdB, tipoDestinatario, cleanDocId));
      idsSet.add(buildAcionamentoId('ERICSSON', siteIdB, tipoDestinatario));
    }

    // 2) Consulta a coleção acionamentos filtrando por vendor 'ERICSSON'
    const acionamentosColl = collection(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS);

    const checkAndAddDoc = (d: any) => {
      const data = d.data() as Acionamento;
      if (data && data.tipoDestinatario === tipoDestinatario) {
        idsSet.add(d.id);
      }
    };

    // a. Consulta por siteId == siteCanonico
    try {
      const qSite = query(
        acionamentosColl,
        where('vendor', '==', 'ERICSSON'),
        where('siteId', '==', siteCanonico)
      );
      const snapSite = await getDocs(qSite);
      snapSite.docs.forEach(checkAndAddDoc);
    } catch (err) {
      console.warn('[resolverIdsAcionamentoEricsson] Erro na query por siteId:', err);
    }

    // b. Consulta por siteId == cleanDocId (se diferente de siteCanonico)
    if (cleanDocId.toUpperCase() !== siteCanonico) {
      try {
        const qDoc = query(
          acionamentosColl,
          where('vendor', '==', 'ERICSSON'),
          where('siteId', '==', cleanDocId.toUpperCase())
        );
        const snapDoc = await getDocs(qDoc);
        snapDoc.docs.forEach(checkAndAddDoc);
      } catch (err) {
        console.warn('[resolverIdsAcionamentoEricsson] Erro na query por siteId (cleanDocId):', err);
      }
    }

    // c. Consulta por registroId == cleanDocId
    try {
      const qReg = query(
        acionamentosColl,
        where('vendor', '==', 'ERICSSON'),
        where('registroId', '==', cleanDocId)
      );
      const snapReg = await getDocs(qReg);
      snapReg.docs.forEach(checkAndAddDoc);
    } catch (err) {
      console.warn('[resolverIdsAcionamentoEricsson] Erro na query por registroId:', err);
    }

    // d. Consulta por siteId == siteIdB se existir
    if (siteIdB) {
      try {
        const qB = query(
          acionamentosColl,
          where('vendor', '==', 'ERICSSON'),
          where('siteId', '==', siteIdB)
        );
        const snapB = await getDocs(qB);
        snapB.docs.forEach(checkAndAddDoc);
      } catch (err) {
        console.warn('[resolverIdsAcionamentoEricsson] Erro na query por siteIdB:', err);
      }
    }

    return Array.from(idsSet).filter(Boolean);
  }

  async desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: VendorType;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }> {
    const nowIso = new Date().toISOString();
    let count = 0;
    const isExecutor = params.targetScope === 'executor';
    const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor ? 'EXECUTOR' : 'VISTORIA';

    if (params.vendor === 'ERICSSON') {
      const rawTokens = Array.from(new Set(params.siteTokens.map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);

        // 1. ANTES de limpar as linhas: resolve e cancela acionamentos de cada registro
        for (const rawToken of chunk) {
          const docId = rawToken.replace(/^mother-/, '');
          try {
            const acionamentoIds = await this.resolverIdsAcionamentoEricsson(docId, tipoDestinatario);
            for (const acId of acionamentoIds) {
              try {
                await this.cancelarAcionamento(acId, { motivo: 'Demanda desvinculada / removida' });
              } catch (cErr) {
                console.warn(`[desvincularDemandaSites] Erro ao cancelar acionamento ${acId}:`, cErr);
              }
            }
          } catch (err: any) {
            console.warn(`[desvincularDemandaSites] Erro ao resolver acionamentos do site ${docId}:`, err);
          }
        }

        // 2. Monta e commita o batch para limpar a demanda nas linhas
        const batch = writeBatch(db);
        for (const rawToken of chunk) {
          const docId = rawToken.replace(/^mother-/, '');

          if (isExecutor) {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                executor: '',
                equipe: '',
                responsavelDemand: '',
                fields: {
                  Executor: '',
                  EQUIPE: '',
                  'EQUIPE EXECUTANTE': '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
                  Responsável: '',
                  'TalonView Executor': '',
                  EXECUTOR: '',
                  'EXECUTOR WR': '',
                  'EXECUTOR QRF': '',
                  'EXECUTOR PPI': '',
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          } else {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                responsavelDemand: '',
                responsavelCampo: '',
                equipeParceira: '',
                equipe: '',
                responsaveisEmails: [],
                responsaveisUids: [],
                fields: {
                  'EQUIPE EXECUTANTE': '',
                  EQUIPE: '',
                  Executor: '',
                  'Responsável': '',
                  'TalonView Executor': '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }
          count++;
        }
        await batch.commit();
      }
      return { updatedCount: count };
    } else {
      // NOKIA or CLARO_TIM
      const isClaro = params.vendor === 'CLARO_TIM';
      const targetSitesCollection = isClaro
        ? FIRESTORE_COLLECTIONS.CLARO_SITES
        : FIRESTORE_COLLECTIONS.NOKIA_SITES;
      const targetVendor: VendorType = isClaro ? 'CLARO_TIM' : 'NOKIA';
      const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));

      if (isExecutor) {
        const tssrSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
        const batch = writeBatch(db);
        let tssrCount = 0;
        for (const d of tssrSnap.docs) {
          const data = d.data();
          const docId = d.id.toUpperCase();
          const rowId = (data.id || '').toString().trim().toUpperCase();
          const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
          const sId = (data.siteId || '').toString().trim().toUpperCase();
          if (tokens.has(docId) || (rowId && tokens.has(rowId)) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
            const cancelId = sId || rowId || docId;
            try {
              await this.cancelarAcionamento(buildAcionamentoId('NOKIA', cancelId, 'EXECUTOR', d.id), { motivo: 'Demanda desvinculada / removida' });
            } catch (err: any) {
              showToast(`Não foi possível cancelar o acionamento do site ${cancelId}: ${err?.message || String(err)}`);
            }

            batch.update(d.ref, {
              executor: '',
              equipe: '',
              responsavelDemand: '',
              'fields.Executor': '',
              'fields.EQUIPE': '',
              'fields.EQUIPE EXECUTANTE': '',
              'fields.Responsável': '',
              'fields.TalonView Executor': '',
              'fields.EXECUTOR': '',
              'fields.E-MAIL DUPLA': '',
              'fields.Data de demanda': '',
              'fields.Data Demanda': '',
              updatedAt: nowIso,
            });
            tssrCount++;
          }
        }
        if (tssrCount > 0) {
          await batch.commit();
          count += tssrCount;
        }
      } else {
        const sitesSnap = await getDocs(collection(db, targetSitesCollection));
        const batch1 = writeBatch(db);
        for (const d of sitesSnap.docs) {
          const data = d.data();
          const sId = (data.siteId || data.id || '').toString().trim().toUpperCase();
          const docId = d.id.toUpperCase();
          const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
          if (tokens.has(docId) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
            const cancelId = sId || docId;
            try {
              await this.cancelarAcionamento(buildAcionamentoId(targetVendor, cancelId, 'VISTORIA', d.id), { motivo: 'Demanda desvinculada / removida' });
            } catch (err: any) {
              showToast(`Não foi possível cancelar o acionamento do site ${cancelId}: ${err?.message || String(err)}`);
            }

            batch1.update(d.ref, {
              responsavelDemand: '',
              equipeParceira: '',
              responsavelCampo: '',
              equipe: '',
              responsaveisEmails: [],
              responsaveisUids: [],
              'customFields.EQUIPE EXECUTANTE': '',
              'customFields.EQUIPE': '',
              'customFields.Executor': '',
              'customFields.Responsável': '',
              'customFields.TalonView Executor': '',
              'customFields.E-MAIL DUPLA': '',
              'customFields.Data de demanda': '',
              'customFields.Data Demanda': '',
              updatedAt: nowIso,
            });
            count++;
          }
        }
        if (count > 0) {
          await batch1.commit();
        }
      }
    }

    return { updatedCount: count };
  }

  async limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: VendorType;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }> {
    const isExecutor = params.targetScope === 'executor';
    const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor ? 'EXECUTOR' : 'VISTORIA';
    const nowIso = new Date().toISOString();
    let count = 0;

    if (params.vendor === 'ERICSSON') {
      const rawTokens = Array.from(new Set((params.siteTokens || []).map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);

        // 1. ANTES de limpar as linhas: resolve e cancela acionamentos de cada registro
        for (const rawToken of chunk) {
          const docId = rawToken.replace(/^mother-/, '');
          try {
            const acionamentoIds = await this.resolverIdsAcionamentoEricsson(docId, tipoDestinatario);
            for (const acId of acionamentoIds) {
              try {
                await this.cancelarAcionamento(acId, {
                  motivo: `Demanda de "${params.responsibleName}" desvinculada / removida`,
                });
              } catch (cErr) {
                console.warn(`[limparTodosSitesDemanda] Erro ao cancelar acionamento ${acId}:`, cErr);
              }
            }
          } catch (err: any) {
            console.warn(`[limparTodosSitesDemanda] Erro ao resolver acionamentos do site ${docId}:`, err);
          }
        }

        // 2. Monta e commita o batch para limpar a demanda nas linhas
        const batch = writeBatch(db);
        for (const rawToken of chunk) {
          const docId = rawToken.replace(/^mother-/, '');

          if (isExecutor) {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                executor: '',
                equipe: '',
                responsavelDemand: '',
                fields: {
                  Executor: '',
                  EQUIPE: '',
                  'EQUIPE EXECUTANTE': '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
                  Responsável: '',
                  'TalonView Executor': '',
                  EXECUTOR: '',
                  'EXECUTOR WR': '',
                  'EXECUTOR QRF': '',
                  'EXECUTOR PPI': '',
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          } else {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                responsavelDemand: '',
                responsavelCampo: '',
                equipeParceira: '',
                equipe: '',
                responsaveisEmails: [],
                responsaveisUids: [],
                fields: {
                  'EQUIPE EXECUTANTE': '',
                  EQUIPE: '',
                  Executor: '',
                  'Responsável': '',
                  'TalonView Executor': '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }
          count++;
        }
        await batch.commit();
      }
      return { updatedCount: count };
    }

    // NOKIA or CLARO_TIM
    const isClaro = params.vendor === 'CLARO_TIM';
    const targetSitesCollection = isClaro
      ? FIRESTORE_COLLECTIONS.CLARO_SITES
      : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const targetVendor: VendorType = isClaro ? 'CLARO_TIM' : 'NOKIA';
    const target = params.responsibleName.trim().toUpperCase();

    if (isExecutor) {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      const batch = writeBatch(db);

      for (const d of snap.docs) {
        const data = d.data();
        const resp = (data.responsavelDemand || data.executor || data.equipe || '').trim().toUpperCase();
        if (resp === target || matchesDuplaName(resp, params.responsibleName)) {
          const sId = (data.siteId || data.id || d.id || '').toString().trim().toUpperCase();
          if (sId) {
            try {
              await this.cancelarAcionamento(buildAcionamentoId('NOKIA', sId, 'EXECUTOR', d.id), { motivo: 'Demanda desvinculada / removida' });
            } catch (err: any) {
              showToast(`Não foi possível cancelar o acionamento do site ${sId}: ${err?.message || String(err)}`);
            }
          }
          batch.update(d.ref, {
            executor: '',
            equipe: '',
            responsavelDemand: '',
            'fields.Executor': '',
            'fields.EQUIPE': '',
            'fields.EQUIPE EXECUTANTE': '',
            'fields.Responsável': '',
            'fields.TalonView Executor': '',
            'fields.EXECUTOR': '',
            'fields.E-MAIL DUPLA': '',
            'fields.Data de demanda': '',
            'fields.Data Demanda': '',
            updatedAt: nowIso,
          });
          count++;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } else {
      const snap = await getDocs(collection(db, targetSitesCollection));
      const batch = writeBatch(db);

      for (const d of snap.docs) {
        const data = d.data();
        const resp = (data.responsavelDemand || data.equipe || data.equipeParceira || '').trim().toUpperCase();
        if (resp === target || matchesDuplaName(resp, params.responsibleName)) {
          const sId = (data.siteId || data.id || d.id || '').toString().trim().toUpperCase();
          if (sId) {
            try {
              await this.cancelarAcionamento(buildAcionamentoId(targetVendor, sId, 'VISTORIA', d.id), { motivo: 'Demanda desvinculada / removida' });
            } catch (err: any) {
              showToast(`Não foi possível cancelar o acionamento do site ${sId}: ${err?.message || String(err)}`);
            }
          }
          batch.update(d.ref, {
            responsavelDemand: '',
            equipeParceira: '',
            responsavelCampo: '',
            equipe: '',
            responsaveisEmails: [],
            responsaveisUids: [],
            'customFields.EQUIPE EXECUTANTE': '',
            'customFields.EQUIPE': '',
            'customFields.Executor': '',
            'customFields.Responsável': '',
            'customFields.TalonView Executor': '',
            'customFields.E-MAIL DUPLA': '',
            'customFields.Data de demanda': '',
            'customFields.Data Demanda': '',
            updatedAt: nowIso,
          });
          count++;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    }

    return { updatedCount: count };
  }

  async renomearEquipeDupla(params: {
    oldName: string;
    newName: string;
    vendor?: VendorType;
  }): Promise<void> {
    const vendors = params.vendor ? [params.vendor] : (['NOKIA', 'ERICSSON', 'CLARO_TIM'] as const);
    for (const v of vendors) {
      const colName =
        v === 'ERICSSON'
          ? FIRESTORE_COLLECTIONS.ERICSSON_SITES
          : v === 'CLARO_TIM'
          ? FIRESTORE_COLLECTIONS.CLARO_SITES
          : FIRESTORE_COLLECTIONS.NOKIA_SITES;
      const snap = await getDocs(collection(db, colName));
      const batch = writeBatch(db);
      let count = 0;
      for (const d of snap.docs) {
        const data = d.data();
        const curResp = (data.responsavelDemand || data.equipe || '').trim();
        if (curResp === params.oldName.trim()) {
          if (v === 'ERICSSON') {
            batch.update(d.ref, {
              responsavelDemand: params.newName,
              equipe: params.newName,
              'fields.EQUIPE': params.newName,
              updatedAt: new Date().toISOString(),
            });
          } else {
            batch.update(d.ref, {
              responsavelDemand: params.newName,
              equipeParceira: params.newName,
              'customFields.EQUIPE EXECUTANTE': params.newName,
              updatedAt: new Date().toISOString(),
            });
          }
          count++;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    }
  }

  async vincularEmailsDupla(params: {
    duplaName: string;
    emails: string[];
    vendor?: VendorType;
  }): Promise<void> {
    const isEricsson = params.vendor === 'ERICSSON';
    const fieldName = isEricsson ? 'ericssonDuplaEmailsMap' : 'duplaEmailsMap';
    const cfgRef = doc(db, 'duplas_config', 'main');
    await setDoc(cfgRef, sanitizeFirestoreData({
      [fieldName]: {
        [params.duplaName]: params.emails,
      },
    }), { merge: true });
  }

  async desvincularEmailsDupla(params: {
    duplaName: string;
    vendor?: VendorType;
  }): Promise<void> {
    const isEricsson = params.vendor === 'ERICSSON';
    const fieldName = isEricsson ? 'ericssonDuplaEmailsMap' : 'duplaEmailsMap';
    const cfgRef = doc(db, 'duplas_config', 'main');
    const clean = params.duplaName.trim();
    const canon = getCanonicalDuplaName(clean) || clean;
    try {
      const updates: Record<string, any> = {
        [`${fieldName}.${clean}`]: deleteField(),
      };
      if (canon !== clean) {
        updates[`${fieldName}.${canon}`] = deleteField();
      }
      await updateDoc(cfgRef, updates);
    } catch {
      const snap = await getDoc(cfgRef);
      if (snap.exists()) {
        const data = snap.data();
        const currentMap = data[fieldName] as Record<string, string[]> | undefined;
        if (currentMap) {
          const nextMap = { ...currentMap };
          const pLower = clean.toLowerCase();
          const cLower = canon.toLowerCase();
          Object.keys(nextMap).forEach((k) => {
            const kLower = k.trim().toLowerCase();
            const kCanon = (getCanonicalDuplaName(k) || k).trim().toLowerCase();
            if (kLower === pLower || kLower === cLower || kCanon === cLower || kCanon === pLower) {
              delete nextMap[k];
            }
          });
          await setDoc(cfgRef, { [fieldName]: nextMap }, { merge: true });
        }
      }
    }
  }

  async adicionarEquipeExcluida(params: {
    duplaName: string;
    vendor: VendorType;
  }): Promise<void> {
    const isEricsson = params.vendor === 'ERICSSON';
    const fieldName = isEricsson ? 'excludedDuplasEricsson' : 'excludedDuplasNokia';
    const cfgRef = doc(db, 'duplas_config', 'main');
    const clean = params.duplaName.trim();
    const canon = getCanonicalDuplaName(clean) || clean;
    const snap = await getDoc(cfgRef);
    const currentList: string[] = snap.exists() ? (snap.data()[fieldName] || []) : [];
    const set = new Set(currentList);
    set.add(clean);
    if (canon) set.add(canon);
    await setDoc(cfgRef, { [fieldName]: Array.from(set) }, { merge: true });
  }

  async removerEquipeExcluida(params: {
    duplaName: string;
    vendor: VendorType;
  }): Promise<void> {
    const isEricsson = params.vendor === 'ERICSSON';
    const fieldName = isEricsson ? 'excludedDuplasEricsson' : 'excludedDuplasNokia';
    const cfgRef = doc(db, 'duplas_config', 'main');
    const snap = await getDoc(cfgRef);
    if (!snap.exists()) return;
    const currentList: string[] = snap.data()[fieldName] || [];
    const nextList = currentList.filter((item) => !matchesDuplaName(item, params.duplaName));
    await setDoc(cfgRef, { [fieldName]: nextList }, { merge: true });
  }

  async limparTodasLinhasEquipeDupla(params: {
    duplaName: string;
    vendor: VendorType;
    siteIds?: string[];
  }): Promise<{ updatedCount: number }> {
    const isEricsson = params.vendor === 'ERICSSON';
    const isClaro = params.vendor === 'CLARO_TIM';
    let totalUpdated = 0;
    const nowIso = new Date().toISOString();

    if (isEricsson) {
      // 1. ERICSSON_SITES (Demanda de equipe grava SÓ em ericsson_sites)
      const rawTokens = Array.from(new Set((params.siteIds || []).map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;
      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);

        // 1. ANTES de limpar as linhas: resolve e cancela acionamentos de VISTORIA
        for (const docId of chunk) {
          try {
            const acionamentoIds = await this.resolverIdsAcionamentoEricsson(docId, 'VISTORIA');
            for (const acId of acionamentoIds) {
              try {
                await this.cancelarAcionamento(acId, {
                  motivo: `Equipe "${params.duplaName}" desvinculada / removida`,
                });
              } catch (cErr) {
                console.warn(`[limparTodasLinhasEquipeDupla] Erro ao cancelar acionamento ${acId}:`, cErr);
              }
            }
          } catch (err) {
            console.warn(`[limparTodasLinhasEquipeDupla] Erro ao resolver acionamentos do site ${docId}:`, err);
          }
        }

        const batch = writeBatch(db);
        for (const docId of chunk) {
          batch.set(
            doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId),
            sanitizeFirestoreData({
              responsavelDemand: '',
              equipe: '',
              fields: {
                EQUIPE: '',
                'EQUIPE EXECUTANTE': '',
                'E-MAIL DUPLA': '',
                'Data de demanda': '',
                'Data Demanda': '',
              },
              updatedAt: nowIso,
            }),
            { merge: true }
          );
          totalUpdated++;
        }
        await batch.commit();
      }
      return { updatedCount: totalUpdated };
    } else {
      // 1. NOKIA_SITES or CLARO_SITES
      const targetSitesCol = isClaro
        ? FIRESTORE_COLLECTIONS.CLARO_SITES
        : FIRESTORE_COLLECTIONS.NOKIA_SITES;
      const sitesSnap = await getDocs(collection(db, targetSitesCol));
      let batch = writeBatch(db);
      let batchCount = 0;

      for (const d of sitesSnap.docs) {
        const data = d.data();
        const isMatch =
          matchesDuplaName(data.responsavelDemand, params.duplaName) ||
          matchesDuplaName(data.equipe, params.duplaName) ||
          matchesDuplaName(data.equipeParceira, params.duplaName) ||
          matchesDuplaName(data.responsavelCampo, params.duplaName) ||
          matchesDuplaName(data.customFields?.['EQUIPE'], params.duplaName) ||
          matchesDuplaName(data.customFields?.['EQUIPE EXECUTANTE'], params.duplaName);

        if (isMatch) {
          batch.update(d.ref, {
            responsavelDemand: '',
            equipe: '',
            equipeParceira: '',
            responsavelCampo: '',
            responsaveisEmails: [],
            'customFields.EQUIPE': '',
            'customFields.EQUIPE EXECUTANTE': '',
            'customFields.E-MAIL DUPLA': '',
            updatedAt: nowIso,
          });
          batchCount++;
          totalUpdated++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
          }
        }
      }
      if (batchCount > 0) {
        await batch.commit();
      }

      // 2. NOKIA_TSSR
      const tssrSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      let tssrBatch = writeBatch(db);
      let tssrBatchCount = 0;

      for (const d of tssrSnap.docs) {
        const data = d.data();
        const isMatch =
          matchesDuplaName(data.equipe, params.duplaName) ||
          matchesDuplaName(data.fields?.['EQUIPE'], params.duplaName) ||
          matchesDuplaName(data.fields?.['EQUIPE EXECUTANTE'], params.duplaName);

        if (isMatch) {
          tssrBatch.update(d.ref, {
            equipe: '',
            'fields.EQUIPE': '',
            'fields.EQUIPE EXECUTANTE': '',
            'fields.E-MAIL DUPLA': '',
            updatedAt: nowIso,
          });
          tssrBatchCount++;
          totalUpdated++;
          if (tssrBatchCount >= 400) {
            await tssrBatch.commit();
            tssrBatch = writeBatch(db);
            tssrBatchCount = 0;
          }
        }
      }
      if (tssrBatchCount > 0) {
        await tssrBatch.commit();
      }
    }

    return { updatedCount: totalUpdated };
  }

  async renomearEmailsDupla(params: {
    oldName: string;
    newName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void> {
    const isEricsson = params.vendor === 'ERICSSON';
    const fieldName = isEricsson ? 'ericssonDuplaEmailsMap' : 'duplaEmailsMap';
    const cfgRef = doc(db, 'duplas_config', 'main');
    const snap = await getDoc(cfgRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const currentMap = data[fieldName] as Record<string, string[]> | undefined;
    if (currentMap && currentMap[params.oldName]) {
      const emails = currentMap[params.oldName];
      try {
        await updateDoc(cfgRef, {
          [`${fieldName}.${params.oldName}`]: deleteField(),
          [`${fieldName}.${params.newName}`]: emails,
        });
      } catch {
        const nextMap = { ...currentMap };
        delete nextMap[params.oldName];
        nextMap[params.newName] = emails;
        await setDoc(cfgRef, { [fieldName]: nextMap }, { merge: true });
      }
    }
  }

  async renomearExecutorEngenharia(params: {
    oldName: string;
    newName: string;
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }> {
    const cleanOld = params.oldName.trim().toLowerCase();
    const cleanNew = params.newName.trim();
    const isEricsson = params.vendor === 'ERICSSON';
    const colName = isEricsson
      ? FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA
      : FIRESTORE_COLLECTIONS.NOKIA_TSSR;
    const snap = await getDocs(collection(db, colName));
    const batch = writeBatch(db);
    let count = 0;
    const nowIso = new Date().toISOString();

    for (const d of snap.docs) {
      const data = d.data();
      const exec = (data.executor || '').trim().toLowerCase();
      const fieldExec = isEricsson
        ? (data.fields?.['EXECUTOR'] || '').trim().toLowerCase()
        : (data.fields?.['Executor'] || '').trim().toLowerCase();

      if (exec === cleanOld || fieldExec === cleanOld) {
        if (isEricsson) {
          batch.update(d.ref, {
            executor: cleanNew,
            'fields.EXECUTOR': cleanNew,
            updatedAt: nowIso,
          });
        } else {
          batch.update(d.ref, {
            executor: cleanNew,
            'fields.Executor': cleanNew,
            updatedAt: nowIso,
          });
        }
        count++;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
    return { updatedCount: count };
  }

  async importarDadosIniciais(onProgress?: (msg: string) => void): Promise<{
    totalSites: number;
    totalEricsson: number;
    totalUsers: number;
  }> {
    if (onProgress) onProgress('Baixando dados iniciais de public/initial-db.json...');
    const res = await window.fetch('/initial-db.json');
    if (!res.ok) {
      throw new Error(`Falha ao ler initial-db.json: status ${res.status}`);
    }
    const seed = await res.json();
    let totalSites = 0;
    let totalEricsson = 0;
    let totalUsers = 0;

    // 1. Nokia Sites em lotes de até 400
    if (Array.isArray(seed.sites) && seed.sites.length > 0) {
      if (onProgress) onProgress(`Gravando ${seed.sites.length} sites Nokia no Firestore em lotes...`);
      const chunkSize = 400;
      for (let i = 0; i < seed.sites.length; i += chunkSize) {
        const chunk = seed.sites.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const s of chunk) {
          const docId = sanitizeSiteDocId(s.siteId || s.id, s.sheetName);
          batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId), {
            ...s,
            id: docId,
          }, { merge: true });
        }
        await batch.commit();
        totalSites += chunk.length;
        if (onProgress) onProgress(`Nokia sites: ${totalSites}/${seed.sites.length} gravados...`);
      }
    }

    // 2. Ericsson Sites em lotes de até 400
    if (Array.isArray(seed.ericssonRows) && seed.ericssonRows.length > 0) {
      if (onProgress) onProgress(`Gravando ${seed.ericssonRows.length} sites Ericsson no Firestore...`);
      const chunkSize = 400;
      for (let i = 0; i < seed.ericssonRows.length; i += chunkSize) {
        const chunk = seed.ericssonRows.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const r of chunk) {
          const docId = sanitizeEricssonDocId(r);
          batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId), {
            ...r,
            id: docId,
          }, { merge: true });
        }
        await batch.commit();
        totalEricsson += chunk.length;
        if (onProgress) onProgress(`Ericsson sites: ${totalEricsson}/${seed.ericssonRows.length} gravados...`);
      }
    }

    // 3. Usuários (desativado gravação automática de seed.users)
    totalUsers = 0;

    // 4. Configuração de Duplas
    if (seed.duplaEmailsMap) {
      await setDoc(doc(db, 'duplas_config', 'main'), sanitizeFirestoreData({
        duplaEmailsMap: seed.duplaEmailsMap,
      }), { merge: true });
    }

    // 5. Notificações
    if (Array.isArray(seed.notifications) && seed.notifications.length > 0) {
      const batch = writeBatch(db);
      for (const n of seed.notifications.slice(0, 100)) {
        const docId = n.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, docId), sanitizeFirestoreData({
          ...n,
          id: docId,
        }), { merge: true });
      }
      await batch.commit();
    }

    if (onProgress) onProgress(`Importação inicial concluída com sucesso! (${totalSites} Nokia, ${totalEricsson} Ericsson)`);
    return { totalSites, totalEricsson, totalUsers };
  }

  async sincronizarUsuariosIniciais(): Promise<number> {
    return 0;
  }

  observarColecoesPlataforma(
    user: AmetaUser,
    callbacks: {
      onNokiaSites?: (sites: TelecomSite[]) => void;
      onNokiaTssr?: (rows: TssrRow[]) => void;
      onNokiaFolders?: (folders: EngineeringFolder[]) => void;
      onNokiaFiles?: (files: EngineeringFile[]) => void;
      onEricssonSites?: (rows: EricssonRow[]) => void;
      onEricssonEngineering?: (rows: EricssonEngineeringRow[]) => void;
      onEricssonFolders?: (folders: EngineeringFolder[]) => void;
      onEricssonFiles?: (files: EngineeringFile[]) => void;
      onClaroSites?: (rows: TelecomSite[]) => void;
      onClaroEngenharia?: (rows: ClaroEngenhariaRow[]) => void;
      onClaroMeta?: (metaMap: { sites?: ClaroSheetMeta; engenharia?: ClaroSheetMeta }) => void;
      onEricssonVivo?: (rows: VivoActivityRow[]) => void;
      onEricssonVivoMeta?: (meta: VivoSheetMeta | null) => void;
      onUsuarios?: (users: AmetaUser[]) => void;
      onDuplasConfig?: (config: {
        duplaEmailsMap?: Record<string, string[]>;
        ericssonDuplaEmailsMap?: Record<string, string[]>;
        customDuplas?: string[];
        customDuplasEricsson?: string[];
        excludedDuplasNokia?: string[];
        excludedDuplasEricsson?: string[];
      }) => void;
      onNotificacoes?: (notifs: AmetaNotification[]) => void;
      onAcionamentos?: (acionamentos: Acionamento[]) => void;
    }
  ): Unsubscribe {
    const unsubs: Unsubscribe[] = [];

    const notificarPermissaoNegadaUmaVez = (colecao: string) => {
      const sessionKey = `ameta_warned_perm_${colecao}`;
      if (warnedPermissionDeniedCollections.has(colecao)) return;
      try {
        if (typeof sessionStorage !== 'undefined') {
          if (sessionStorage.getItem(sessionKey)) {
            warnedPermissionDeniedCollections.add(colecao);
            return;
          }
          sessionStorage.setItem(sessionKey, '1');
        }
      } catch {
        // ignore sessionStorage errors
      }
      warnedPermissionDeniedCollections.add(colecao);
      showToast(
        `Sem permissão para ler ${colecao}. Peça à coordenação para conferir sua plataforma (Nokia/Ericsson/Ambas) e sua situação.`
      );
    };

    if (callbacks.onNokiaSites) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES),
          (snap) => {
            const pureNokiaList: TelecomSite[] = [];

            snap.docs.forEach((docSnap) => {
              const item = { id: docSnap.id, ...docSnap.data() } as TelecomSite;
              // Guarda: ignorar documentos de nokia_sites que tenham vendor === 'CLARO_TIM' (não devem aparecer na TIM)
              if (item.vendor === 'CLARO_TIM' || isClaroSiteRecord(item)) {
                return;
              }
              pureNokiaList.push({ ...item, vendor: 'NOKIA' });
            });

            callbacks.onNokiaSites!(pureNokiaList);
          },
          (err: any) => {
            console.error('Nokia sites snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('nokia_sites');
            }
          }
        )
      );
    }
    if (callbacks.onNokiaTssr) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TssrRow));
            callbacks.onNokiaTssr!(list);
          },
          (err: any) => {
            console.error('Nokia TSSR snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('nokia_tssr');
            }
          }
        )
      );
    }
    if (callbacks.onNokiaFolders) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EngineeringFolder));
          callbacks.onNokiaFolders!(list);
        }, (err) => console.error('Nokia folders snapshot error:', err))
      );
    }
    if (callbacks.onNokiaFiles) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EngineeringFile));
          callbacks.onNokiaFiles!(list);
        }, (err) => console.error('Nokia files snapshot error:', err))
      );
    }
    if (callbacks.onEricssonSites) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EricssonRow));
            callbacks.onEricssonSites!(list);
          },
          (err: any) => {
            console.error('Ericsson sites snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('ericsson_sites');
            }
          }
        )
      );
    }
    if (callbacks.onEricssonEngineering) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EricssonEngineeringRow));
            callbacks.onEricssonEngineering!(list);
          },
          (err: any) => {
            console.error('Ericsson engenharia snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('ericsson_engenharia');
            }
          }
        )
      );
    }
    if (callbacks.onEricssonFolders) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EngineeringFolder));
          callbacks.onEricssonFolders!(list);
        }, (err) => console.error('Ericsson folders snapshot error:', err))
      );
    }
    if (callbacks.onEricssonFiles) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EngineeringFile));
          callbacks.onEricssonFiles!(list);
        }, (err) => console.error('Ericsson files snapshot error:', err))
      );
    }
    if (callbacks.onClaroSites) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.CLARO_SITES),
          (snap) => {
            const list = snap.docs.map((d) => {
              const raw = d.data() as Record<string, any>;
              const customFields = (raw.customFields || raw.fields || {}) as Record<string, string>;
              const siteId = (
                raw.siteId ||
                customFields['SITE ID'] ||
                customFields['Site ID'] ||
                d.id
              )
                .toString()
                .trim();
              return {
                ...raw,
                id: d.id,
                siteId,
                siteName: raw.siteName || customFields['END ID'] || siteId,
                vendor: 'CLARO_TIM' as VendorType,
                sheetName: 'Controle Geral',
                uf: raw.uf || customFields['UF'] || '',
                municipio: raw.municipio || customFields['MUNICÍPIO'] || customFields['CIDADE'] || '',
                regional: raw.regional || customFields['REG.'] || '',
                status: raw.status || customFields['STATUS'] || 'Vistoria - A Executar',
                progressoRollout: typeof raw.progressoRollout === 'number' ? raw.progressoRollout : 65,
                customFields,
              } as TelecomSite;
            });
            callbacks.onClaroSites!(list);
          },
          (err: any) => {
            console.error('Claro sites snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('claro_sites');
            }
          }
        )
      );
    }
    if (callbacks.onClaroEngenharia) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClaroEngenhariaRow));
            callbacks.onClaroEngenharia!(list);
          },
          (err: any) => {
            console.error('Claro engenharia snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('claro_engenharia');
            }
          }
        )
      );
    }
    if (callbacks.onClaroMeta) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.CLARO_META),
          (snap) => {
            const map: { sites?: ClaroSheetMeta; engenharia?: ClaroSheetMeta } = {};
            snap.docs.forEach((d) => {
              const data = { id: d.id as 'sites' | 'engenharia', ...d.data() } as ClaroSheetMeta;
              if (d.id === 'sites') map.sites = data;
              else if (d.id === 'engenharia') map.engenharia = data;
            });
            callbacks.onClaroMeta!(map);
          },
          (err) => console.error('Claro meta snapshot error:', err)
        )
      );
    }
    if (callbacks.onEricssonVivo) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO),
          (snap) => {
            const list = snap.docs.map((d) => {
              const raw = d.data() as Record<string, any>;
              return {
                ...raw,
                id: d.id,
                vendor: 'ERICSSON_VIVO' as const,
                fields: (raw.fields || {}) as Record<string, string>,
              } as VivoActivityRow;
            });
            callbacks.onEricssonVivo!(list);
          },
          (err: any) => {
            console.error('Ericsson Vivo snapshot error:', err);
            if (err?.code === 'permission-denied') {
              notificarPermissaoNegadaUmaVez('ericsson_vivo');
            }
          }
        )
      );
    }
    if (callbacks.onEricssonVivoMeta) {
      unsubs.push(
        onSnapshot(
          doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO_META, 'default'),
          (snap) => {
            if (snap.exists()) {
              callbacks.onEricssonVivoMeta!({ id: 'default', ...snap.data() } as VivoSheetMeta);
            } else {
              callbacks.onEricssonVivoMeta!(null);
            }
          },
          (err) => console.error('Ericsson Vivo meta snapshot error:', err)
        )
      );
    }
    if (callbacks.onUsuarios) {
      const isCoordOrAdmin =
        user.role === 'ADM' ||
        user.role === 'Coordenador Geral' ||
        user.role === 'Coordenador Engenharia' ||
        isOwnerAdmUser(user.email, user.situacao);

      if (isCoordOrAdmin) {
        unsubs.push(
          onSnapshot(
            collection(db, FIRESTORE_COLLECTIONS.USUARIOS),
            (snap) => {
              const list = snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() } as AmetaUser));
              callbacks.onUsuarios!(list);
            },
            (err) => console.error('Usuarios snapshot error:', err)
          )
        );
      } else {
        const myUid = user.uid || user.id;
        if (myUid) {
          unsubs.push(
            onSnapshot(
              doc(db, FIRESTORE_COLLECTIONS.USUARIOS, myUid),
              (snap) => {
                if (snap.exists()) {
                  callbacks.onUsuarios!([{ id: snap.id, uid: snap.id, ...snap.data() } as AmetaUser]);
                }
              },
              (err) => console.error('Usuario snapshot error:', err)
            )
          );
        }
      }
    }
    if (callbacks.onDuplasConfig) {
      unsubs.push(
        onSnapshot(doc(db, 'duplas_config', 'main'), (snap) => {
          if (snap.exists()) {
            callbacks.onDuplasConfig!(snap.data() as any);
          } else {
            callbacks.onDuplasConfig!({});
          }
        }, (err) => console.error('Duplas config snapshot error:', err))
      );
    }
    if (callbacks.onNotificacoes) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AmetaNotification));
          callbacks.onNotificacoes!(list);
        }, (err) => console.error('Notificacoes snapshot error:', err))
      );
    }
    if (callbacks.onAcionamentos) {
      unsubs.push(
        this.observarAcionamentos(
          { role: user.role, email: user.email },
          callbacks.onAcionamentos
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }

  async resolverDestinatariosEmails(params: {
    responsibleName: string;
    linkedEmails?: string[];
    vendor?: VendorType;
    tipoDestinatario: 'VISTORIA' | 'EXECUTOR';
  }): Promise<string[]> {
    const candidateEmails = new Set<string>();
    (params.linkedEmails || []).forEach((e) => {
      const clean = String(e || '').trim().toLowerCase();
      if (clean && clean.includes('@')) candidateEmails.add(clean);
    });

    const cleanResp = (params.responsibleName || '').trim();

    // 1. Consultar duplas_config/main
    if (cleanResp) {
      try {
        const cfgSnap = await getDoc(doc(db, 'duplas_config', 'main'));
        if (cfgSnap.exists()) {
          const data = cfgSnap.data();
          const mapNokia = (data?.duplaEmailsMap || {}) as Record<string, string[]>;
          const mapEric = (data?.ericssonDuplaEmailsMap || {}) as Record<string, string[]>;

          const checkMap = (map: Record<string, string[]>) => {
            for (const [name, list] of Object.entries(map)) {
              if (matchesDuplaName(name, cleanResp)) {
                (list || []).forEach((em) => {
                  const c = String(em || '').trim().toLowerCase();
                  if (c && c.includes('@')) candidateEmails.add(c);
                });
              }
            }
          };
          checkMap(mapNokia);
          checkMap(mapEric);
        }
      } catch (err) {
        console.warn('Erro ao ler duplas_config para destinatários:', err);
      }
    }

    // 2. Consultar coleção usuarios cadastrados
    const userByEmailMap = new Map<string, AmetaUser>();
    try {
      const usersSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      usersSnap.docs.forEach((d) => {
        const u = d.data() as AmetaUser;
        const uEmail = (u.email || '').trim().toLowerCase();
        if (!uEmail || !uEmail.includes('@')) return;

        userByEmailMap.set(uEmail, u);

        if (cleanResp) {
          const isMatch =
            matchesDuplaName(u.equipe, cleanResp) ||
            matchesDuplaName(u.name, cleanResp) ||
            matchesDuplaName((u as any).dupla, cleanResp);

          if (isMatch) {
            candidateEmails.add(uEmail);
          }
        }
      });
    } catch (err) {
      console.warn('Erro ao consultar usuarios para destinatários:', err);
    }

    // 3. Filtrar pelo cargo cadastrado em usuarios:
    // - E-mails sem cadastro em usuarios são removidos.
    // - Não inclua coordenação como destinatária.
    // - Para 'VISTORIA', mantenha somente quem tem role contendo 'Vistoriador';
    // - Para 'EXECUTOR', somente quem tem role contendo 'Executor'.
    // - Quem tem os dois cargos fica nos dois.
    const finalEmails: string[] = [];
    for (const email of candidateEmails) {
      const u = userByEmailMap.get(email);
      if (!u) {
        // E-mails sem cadastro em usuarios são removidos.
        continue;
      }

      const roleRaw = String(u.role || '').toLowerCase();
      const isCoordOrAdmin =
        roleRaw.includes('coord') ||
        roleRaw.includes('adm') ||
        roleRaw.includes('admin') ||
        isOwnerAdmUser(u.email, u.situacao);

      if (isCoordOrAdmin) {
        // Não inclua coordenação como destinatária.
        continue;
      }

      const hasVistoriador = roleRaw.includes('vistoriador');
      const hasExecutor = roleRaw.includes('executor');

      if (params.tipoDestinatario === 'VISTORIA') {
        if (hasVistoriador) {
          finalEmails.push(email);
        }
      } else if (params.tipoDestinatario === 'EXECUTOR') {
        if (hasExecutor) {
          finalEmails.push(email);
        }
      }
    }

    return finalEmails;
  }

  async salvarOuAtualizarAcionamento(
    payload: Partial<Acionamento> & {
      siteId: string;
      registroId?: string;
      rowNumberInFile?: number;
      vendor: VendorType;
      tipoDestinatario: 'EXECUTOR' | 'VISTORIA';
      equipe: string;
      dataDemanda?: string;
    }
  ): Promise<Acionamento & { hasNoEmail: boolean }> {
    const targetRegistroId = payload.registroId || payload.id;
    const docId = payload.id || buildAcionamentoId(payload.vendor, payload.siteId, payload.tipoDestinatario, targetRegistroId);
    const nowIso = new Date().toISOString();
    const docRef = doc(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS, docId);

    let existing: Acionamento | null = null;
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existing = { id: snap.id, ...snap.data() } as Acionamento;
      }
    } catch (err) {
      console.warn('Erro ao verificar acionamento existente:', err);
    }

    const cleanEmails = Array.from(
      new Set(
        (payload.destinatariosEmails || [])
          .map((e) => String(e || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const hasNoEmail = cleanEmails.length === 0;

    const cleanEquipe = (payload.equipe || '').trim();
    const autorNome = payload.demandadoPorNome || 'Coordenação Telecom';
    const autorEmail = (payload.demandadoPorEmail || '').trim().toLowerCase();
    const targetDataDemanda = payload.dataDemanda || existing?.dataDemanda;

    // Se já existir acionamento não cancelado
    if (existing && existing.status !== 'Cancelado') {
      const existingStatus = existing.status;
      const sameEquipe = existing.equipe.trim().toLowerCase() === cleanEquipe.toLowerCase();
      const existingEmailsList = (existing.destinatariosEmails || []).map((e) => String(e || '').trim().toLowerCase());
      const existingEmailsSet = new Set(existingEmailsList);
      const sameEmails =
        cleanEmails.length === existingEmailsSet.size &&
        cleanEmails.every((e) => existingEmailsSet.has(e));

      // 2.a) se o status for 'Recusado': voltar para 'Aguardando aceite', limpar recusadoPorEmail, recusadoPorNome, recusadoEm e motivoRecusa, atualizar destinatariosEmails e equipe, e adicionar ao historico "Demanda reenviada após recusa"
      if (existingStatus === 'Recusado') {
        const historicoAtualizado: AcionamentoHistorico[] = [
          ...(existing.historico || []),
          {
            data: nowIso,
            autor: autorNome,
            email: autorEmail,
            acao: 'Demanda reenviada após recusa',
            status: 'Aguardando aceite',
            detalhes: payload.observacao || `Demanda reenviada para a equipe "${cleanEquipe}"`,
          },
        ];

        const updated: Acionamento = {
          ...existing,
          equipe: cleanEquipe,
          destinatariosEmails: cleanEmails,
          demandadoEm: nowIso,
          dataDemanda: targetDataDemanda,
          demandadoPorNome: autorNome,
          demandadoPorEmail: autorEmail,
          status: 'Aguardando aceite',
          recusadoPorEmail: '',
          recusadoPorNome: '',
          recusadoEm: '',
          motivoRecusa: '',
          planilhaAtualizadaEm: '',
          planilhaAtualizadaPor: '',
          planilhaResumo: '',
          atualizadoEm: nowIso,
          historico: historicoAtualizado,
          observacao: payload.observacao !== undefined ? payload.observacao : existing.observacao,
        };

        await setDoc(docRef, sanitizeFirestoreData(updated), { merge: true });
        return { ...updated, hasNoEmail };
      }

      // 2.b) se a equipe for a mesma mas destinatariosEmails mudou: atualizar destinatariosEmails (substituir pela lista nova) sem alterar o status, e registrar no historico "Destinatários atualizados"
      if (sameEquipe && !sameEmails) {
        const historicoAtualizado: AcionamentoHistorico[] = [
          ...(existing.historico || []),
          {
            data: nowIso,
            autor: autorNome,
            email: autorEmail,
            acao: 'Destinatários atualizados',
            status: existingStatus,
            detalhes: `Destinatários atualizados para: ${cleanEmails.join(', ') || 'nenhum e-mail'}`,
          },
        ];

        const updated: Acionamento = {
          ...existing,
          destinatariosEmails: cleanEmails,
          dataDemanda: targetDataDemanda,
          atualizadoEm: nowIso,
          historico: historicoAtualizado,
          observacao: payload.observacao !== undefined ? payload.observacao : existing.observacao,
        };

        await setDoc(docRef, sanitizeFirestoreData(updated), { merge: true });
        return { ...updated, hasNoEmail };
      }

      // 2.c) status Aceito, Em deslocamento, No local, Em atendimento, Pausado e Concluído continuam sem mudar de status (se for mesma equipe e mesmos e-mails)
      if (sameEquipe && sameEmails) {
        const merged: Acionamento = {
          ...existing,
          siteNome: payload.siteNome || existing.siteNome,
          endereco: payload.endereco || existing.endereco,
          cidade: payload.cidade || existing.cidade,
          uf: payload.uf || existing.uf,
          dataDemanda: targetDataDemanda,
          observacao: payload.observacao !== undefined ? payload.observacao : existing.observacao,
          atualizadoEm: nowIso,
        };
        await setDoc(docRef, sanitizeFirestoreData(merged), { merge: true });
        return { ...merged, hasNoEmail };
      }

      // Reatribuição para uma equipe diferente
      const historicoAtualizado: AcionamentoHistorico[] = [
        ...(existing.historico || []),
        {
          data: nowIso,
          autor: autorNome,
          email: autorEmail,
          acao: `Demanda reatribuída para "${cleanEquipe}"`,
          status: 'Aguardando aceite',
          detalhes: payload.observacao || `Reatribuído de "${existing.equipe}" para "${cleanEquipe}"`,
        },
      ];

      const updated: Acionamento = {
        ...existing,
        equipe: cleanEquipe,
        destinatariosEmails: cleanEmails,
        demandadoEm: nowIso,
        dataDemanda: targetDataDemanda,
        demandadoPorNome: autorNome,
        demandadoPorEmail: autorEmail,
        status: 'Aguardando aceite',
        aceitoPorEmail: '',
        aceitoPorNome: '',
        aceitoEm: '',
        recusadoPorEmail: '',
        recusadoPorNome: '',
        recusadoEm: '',
        motivoRecusa: '',
        planilhaAtualizadaEm: '',
        planilhaAtualizadaPor: '',
        planilhaResumo: '',
        atualizadoEm: nowIso,
        historico: historicoAtualizado,
        observacao: payload.observacao !== undefined ? payload.observacao : existing.observacao,
      };

      await setDoc(docRef, sanitizeFirestoreData(updated), { merge: true });
      return { ...updated, hasNoEmail };
    }

    // NOVO ACIONAMENTO (não existia ou estava cancelado)
    const vPrefix =
      payload.vendor === 'ERICSSON'
        ? 'ERI'
        : payload.vendor === 'CLARO_TIM'
        ? 'CLA'
        : 'NOK';
    const sClean = normalizeSiteIdForDoc(payload.siteId);
    const protoRandom = Math.floor(1000 + Math.random() * 9000);
    const protocolo = existing?.protocolo || `AC-${vPrefix}-${sClean.slice(-8)}-${protoRandom}`;

    const novoEvento: AcionamentoHistorico = {
      data: nowIso,
      autor: autorNome,
      email: autorEmail,
      acao: existing?.status === 'Cancelado'
        ? `Demanda reativada para "${cleanEquipe}"`
        : `Demanda criada e enviada ao acionamento (${payload.tipoDestinatario})`,
      status: 'Aguardando aceite',
      detalhes: payload.observacao || '',
    };

    const historicoAtualizado: AcionamentoHistorico[] = [
      ...(existing?.historico || []),
      novoEvento,
    ];

    const novoAcionamento: Acionamento = {
      id: docId,
      registroId: targetRegistroId || payload.siteId,
      rowNumberInFile: payload.rowNumberInFile || existing?.rowNumberInFile,
      protocolo,
      origem: 'telecom',
      vendor: payload.vendor,
      siteId: payload.siteId,
      siteNome: payload.siteNome || payload.siteId,
      endereco: payload.endereco || '',
      cidade: payload.cidade || '',
      uf: payload.uf || '',
      tipoDestinatario: payload.tipoDestinatario,
      equipe: cleanEquipe,
      destinatariosEmails: cleanEmails,
      demandadoPorNome: autorNome,
      demandadoPorEmail: autorEmail,
      demandadoEm: nowIso,
      dataDemanda: targetDataDemanda,
      observacao: payload.observacao || '',
      atualizadoEm: nowIso,
      status: 'Aguardando aceite',
      historico: historicoAtualizado,
      aceitoPorEmail: '',
      aceitoPorNome: '',
      aceitoEm: '',
      recusadoPorEmail: '',
      recusadoPorNome: '',
      recusadoEm: '',
      motivoRecusa: '',
      planilhaAtualizadaEm: '',
      planilhaAtualizadaPor: '',
      planilhaResumo: '',
    };

    await setDoc(docRef, sanitizeFirestoreData(novoAcionamento), { merge: true });
    return { ...novoAcionamento, hasNoEmail };
  }

  async cancelarAcionamento(
    acionamentoId: string,
    actor?: { nome?: string; email?: string; motivo?: string }
  ): Promise<void> {
    const docRef = doc(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS, acionamentoId);
    let snap;
    try {
      snap = await getDoc(docRef);
    } catch (err) {
      console.warn('Erro ao obter acionamento para cancelamento:', err);
      return;
    }
    if (!snap.exists()) return;

    const data = snap.data() as Acionamento;
    if (data.status === 'Cancelado') return;

    const nowIso = new Date().toISOString();
    const prevEmails = (data.destinatariosEmails || []).join(', ') || 'nenhum';
    const motivoBase = actor?.motivo || 'Demanda desvinculada';
    const detalhes = `${motivoBase} (Destinatários removidos: ${prevEmails})`;

    const evento: AcionamentoHistorico = {
      data: nowIso,
      autor: actor?.nome || 'Coordenação Telecom',
      email: (actor?.email || '').toLowerCase(),
      acao: 'Demanda cancelada / removida no Telecom',
      status: 'Cancelado',
      detalhes,
    };

    const updatedHistorico = [...(data.historico || []), evento];
    await updateDoc(
      docRef,
      sanitizeFirestoreData({
        status: 'Cancelado',
        destinatariosEmails: [],
        atualizadoEm: nowIso,
        historico: updatedHistorico,
      })
    );
  }

  async obterAcionamentoPorId(id: string): Promise<Acionamento | null> {
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS, id));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() } as Acionamento;
      }
    } catch (err) {
      console.warn('Erro ao obter acionamento por id:', err);
    }
    return null;
  }

  observarAcionamentos(
    params: {
      role: UserRole;
      email: string;
      isSimulating?: boolean;
      onErrorToast?: (msg: string) => void;
    },
    callback: (acionamentos: Acionamento[]) => void
  ): Unsubscribe {
    const isCoordOrAdmin =
      params.role === 'ADM' ||
      params.role === 'Coordenador Geral' ||
      params.role === 'Coordenador Engenharia' ||
      isOwnerAdmUser(params.email);

    let q;
    if (isCoordOrAdmin && !params.isSimulating) {
      q = collection(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    } else {
      const emailLower = (params.email || '').trim().toLowerCase();
      q = query(
        collection(db, FIRESTORE_COLLECTIONS.ACIONAMENTOS),
        where('destinatariosEmails', 'array-contains', emailLower)
      );
    }

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Acionamento));
        callback(list);
      },
      (err) => {
        console.error('Erro no snapshot de acionamentos:', err);
        callback([]);
        if (!hasShownPermissionAcionamentosToast) {
          hasShownPermissionAcionamentosToast = true;
          if (typeof params.onErrorToast === 'function') {
            params.onErrorToast('Sem permissão para ler acionamentos');
          }
        }
      }
    );
  }

  async verificarLinhasAbaErradaNokiaSites(): Promise<ErroAbaNokiaSitesDiagnostico> {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
    const docsToFix: Array<{ id: string; data: TelecomSite }> = [];
    const porAba: Record<string, number> = {};
    const validSheets = new Set(['Controle Geral', 'Controle Cancelados', 'Equipes']);

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as TelecomSite;
      if (data.vendor === 'CLARO_TIM') continue;
      const rawSheet = (data.sheetName || '').trim();
      if (!validSheets.has(rawSheet)) {
        const displaySheet = rawSheet || '(em branco / sem aba)';
        porAba[displaySheet] = (porAba[displaySheet] || 0) + 1;
        docsToFix.push({ id: docSnap.id, data: { ...data, id: docSnap.id } });
      }
    }

    return {
      total: docsToFix.length,
      porAba,
      docs: docsToFix,
    };
  }

  async corrigirLinhasAbaErradaNokiaSites(): Promise<ResultadoCorrecaoAbaNokiaSites> {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
    const existingIds = new Set<string>(snap.docs.map((d) => d.id));
    const validSheets = new Set(['Controle Geral', 'Controle Cancelados', 'Equipes']);

    const docsToFix: Array<{ id: string; data: TelecomSite }> = [];
    const detalhesPorAba: Record<string, number> = {};

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as TelecomSite;
      if (data.vendor === 'CLARO_TIM') continue;
      const rawSheet = (data.sheetName || '').trim();
      if (!validSheets.has(rawSheet)) {
        const displaySheet = rawSheet || '(em branco / sem aba)';
        detalhesPorAba[displaySheet] = (detalhesPorAba[displaySheet] || 0) + 1;
        docsToFix.push({ id: docSnap.id, data: { ...data, id: docSnap.id } });
      }
    }

    if (docsToFix.length === 0) {
      return {
        movidos: 0,
        novosSites: [],
        idsRemovidos: [],
        detalhesPorAba: {},
      };
    }

    const usedIds = new Set<string>(existingIds);
    const novosSites: TelecomSite[] = [];
    const idsRemovidos: string[] = [];

    const batchOperations: Array<
      | { type: 'set'; id: string; data: TelecomSite }
      | { type: 'delete'; id: string }
    > = [];

    let corrigidoCounter = 1;

    for (const item of docsToFix) {
      const oldId = item.id;
      const oldData = item.data;

      const rawSiteId = (
        oldData.customFields?.['SITE ID'] ||
        oldData.siteId ||
        oldId
      ).toString().trim();

      let cleanedSiteId = rawSiteId;
      if (cleanedSiteId.includes('__')) {
        cleanedSiteId = cleanedSiteId.split('__').slice(1).join('__').trim();
      }
      if (!cleanedSiteId) {
        cleanedSiteId = oldId.includes('__') ? oldId.split('__').slice(1).join('__').trim() : oldId;
      }

      const baseDocId = sanitizeSiteDocId(cleanedSiteId, 'Controle Geral');

      let finalDocId = baseDocId;
      if (usedIds.has(finalDocId) && finalDocId !== oldId) {
        while (usedIds.has(`${baseDocId}__corrigido_${corrigidoCounter}`)) {
          corrigidoCounter++;
        }
        finalDocId = `${baseDocId}__corrigido_${corrigidoCounter}`;
        corrigidoCounter++;
      }

      usedIds.add(finalDocId);

      const newRecord: TelecomSite = {
        ...oldData,
        id: finalDocId,
        vendor: oldData.vendor || 'NOKIA',
        siteId: oldData.siteId || cleanedSiteId || finalDocId,
        sheetName: 'Controle Geral',
        updatedAt: new Date().toISOString(),
        updatedBy: 'Correção de Aba Errada',
      };

      novosSites.push(newRecord);
      batchOperations.push({
        type: 'set',
        id: finalDocId,
        data: sanitizeFirestoreData(newRecord),
      });

      if (oldId !== finalDocId) {
        idsRemovidos.push(oldId);
        batchOperations.push({
          type: 'delete',
          id: oldId,
        });
        usedIds.delete(oldId);
      }
    }

    // Executa no Firestore em lotes de 20 operações
    const chunkSize = 20;
    for (let i = 0; i < batchOperations.length; i += chunkSize) {
      const chunk = batchOperations.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.type === 'set') {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, op.id), op.data);
        } else if (op.type === 'delete') {
          batch.delete(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, op.id));
        }
      }
      await batch.commit();
    }

    return {
      movidos: docsToFix.length,
      novosSites,
      idsRemovidos,
      detalhesPorAba,
    };
  }

  async verificarRegistrosClaroEmNokiaSites(): Promise<DiagnosticoClaroEmNokiaSites> {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
    const docs: Array<{ id: string; siteId: string; sheetName?: string }> = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as TelecomSite;
      // Considera exclusivamente documentos com vendor === 'CLARO_TIM'
      if (data?.vendor === 'CLARO_TIM') {
        docs.push({
          id: docSnap.id,
          siteId: String(data.siteId || data.customFields?.['SITE ID'] || docSnap.id),
          sheetName: data.sheetName,
        });
      }
    }

    return {
      total: docs.length,
      docs,
    };
  }

  async moverRegistrosClaroDeNokiaSites(): Promise<ResultadoMoverClaroDeNokiaSites> {
    const nokiaSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
    // Não toca em documentos sem vendor === 'CLARO_TIM'
    const claroDocsInNokia = nokiaSnap.docs.filter(
      (docSnap) => (docSnap.data() as TelecomSite)?.vendor === 'CLARO_TIM'
    );

    if (claroDocsInNokia.length === 0) {
      return {
        movidos: 0,
        novosClaroSites: [],
        idsRemovidosNokia: [],
      };
    }

    const claroSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.CLARO_SITES));
    const usedClaroIds = new Set<string>(claroSnap.docs.map((d) => d.id));

    const plannedMoves: Array<{
      oldId: string;
      targetId: string;
      data: TelecomSite;
    }> = [];

    for (const docSnap of claroDocsInNokia) {
      const oldId = docSnap.id;
      const rawData = docSnap.data() as Record<string, any>;

      let targetId = oldId;
      if (usedClaroIds.has(targetId)) {
        let suffix = 1;
        while (usedClaroIds.has(`${oldId}__movido_${suffix}`)) {
          suffix++;
        }
        targetId = `${oldId}__movido_${suffix}`;
      }
      usedClaroIds.add(targetId);

      // Mantém TODOS os campos originais, garantindo vendor = 'CLARO_TIM'
      const movedRecord: TelecomSite = {
        ...(rawData as TelecomSite),
        id: targetId,
        vendor: 'CLARO_TIM' as VendorType,
      };

      plannedMoves.push({
        oldId,
        targetId,
        data: sanitizeFirestoreData(movedRecord),
      });
    }

    const novosClaroSites: TelecomSite[] = [];
    const idsRemovidosNokia: string[] = [];

    // Executa em lotes: PRIMEIRO copia para claro_sites, SÓ DEPOIS apaga o original em nokia_sites
    const chunkSize = 20;
    for (let i = 0; i < plannedMoves.length; i += chunkSize) {
      const chunk = plannedMoves.slice(i, i + chunkSize);

      // 1) Copiar para claro_sites
      const copyBatch = writeBatch(db);
      for (const item of chunk) {
        copyBatch.set(doc(db, FIRESTORE_COLLECTIONS.CLARO_SITES, item.targetId), item.data);
      }
      await copyBatch.commit();

      // 2) Só após a cópia ter sucesso, apagar o original em nokia_sites
      const deleteBatch = writeBatch(db);
      for (const item of chunk) {
        deleteBatch.delete(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, item.oldId));
      }
      await deleteBatch.commit();

      chunk.forEach((item) => {
        novosClaroSites.push(item.data);
        idsRemovidosNokia.push(item.oldId);
      });
    }

    return {
      movidos: novosClaroSites.length,
      novosClaroSites,
      idsRemovidosNokia,
    };
  }

  async importarVivoAtividadesEmLote(
    rows: VivoActivityRow[],
    options?: {
      fileName?: string;
      columns?: string[];
      baseLoaded?: boolean;
      skipHistory?: boolean;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    const cleanRows = (rows || []).filter((r) => r && r.id);
    const chunkSize = 250;
    const totalLotes = Math.max(1, Math.ceil(cleanRows.length / chunkSize));
    let totalGravados = 0;

    for (let i = 0; i < cleanRows.length; i += chunkSize) {
      const chunk = cleanRows.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const row of chunk) {
        const sanitized = sanitizeFirestoreData<VivoActivityRow>({
          ...row,
          vendor: 'ERICSSON_VIVO',
          updatedAt: row.updatedAt || new Date().toISOString(),
        });
        batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, row.id), sanitized, { merge: true });
      }
      await batch.commit();
      totalGravados += chunk.length;
      if (options?.onProgress) {
        options.onProgress({
          gravados: totalGravados,
          total: cleanRows.length,
          lote: Math.floor(i / chunkSize) + 1,
          totalLotes,
        });
      }
    }

    const nowIso = new Date().toISOString();
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO_META, 'default'),
        sanitizeFirestoreData<VivoSheetMeta>({
          id: 'default',
          columns: options?.columns || [],
          sourceFileName: options?.fileName || cleanRows[0]?.fileName || 'AMETA_VIVO_REPORT.csv',
          lastSyncAt: nowIso,
          totalRows: totalGravados,
          baseLoaded: options?.baseLoaded ?? true,
        }),
        { merge: true }
      );
    } catch (metaErr) {
      console.warn('Falha ao atualizar metadados Vivo:', metaErr);
    }

    if (!options?.skipHistory && cleanRows.length > 0) {
      try {
        const impCode = cleanRows[0]?.importCode || `VIVO_${Date.now().toString(36).toUpperCase()}`;
        await this.registrarHistoricoImportacao({
          id: `imp_${impCode}_${Date.now()}`,
          fileName: options?.fileName || cleanRows[0]?.fileName || 'Planilha Vivo',
          target: 'ERICSSON_VIVO',
          sheetName: 'Vivo Documentação',
          importCode: impCode,
          importedAt: nowIso,
          totalLidas: cleanRows.length,
          totalAdicionadas: totalGravados,
          totalIgnoradas: 0,
        });
      } catch (histErr) {
        console.warn('Falha ao registrar histórico Vivo:', histErr);
      }
    }

    return { totalGravados, lotesExecutados: totalLotes };
  }

  async salvarVivoAtividade(row: VivoActivityRow): Promise<void> {
    if (!row || !row.id) return;
    const sanitized = sanitizeFirestoreData<VivoActivityRow>({
      ...row,
      vendor: 'ERICSSON_VIVO',
      updatedAt: new Date().toISOString(),
    });
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, row.id), sanitized, { merge: true });
  }

  async excluirVivoAtividade(rowId: string): Promise<void> {
    if (!rowId) return;
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, rowId));
  }

  async criarVivoRegistrosEmLote(
    rows: VivoActivityRow[],
    options?: {
      executorUser?: { id?: string; name: string; email?: string } | null;
      actorName?: string;
      actorEmail?: string;
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{ totalGravados: number; acionamentosCriados: number }> {
    const cleanRows = (rows || []).filter((r) => r && r.id);
    if (cleanRows.length === 0) {
      return { totalGravados: 0, acionamentosCriados: 0 };
    }

    const chunkSize = 250;
    const totalLotes = Math.max(1, Math.ceil(cleanRows.length / chunkSize));
    let totalGravados = 0;

    for (let i = 0; i < cleanRows.length; i += chunkSize) {
      const chunk = cleanRows.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const row of chunk) {
        const sanitized = sanitizeFirestoreData<VivoActivityRow>({
          ...row,
          vendor: 'ERICSSON_VIVO',
          updatedAt: row.updatedAt || new Date().toISOString(),
        });
        batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, row.id), sanitized);
      }
      await batch.commit();
      totalGravados += chunk.length;
      if (options?.onProgress) {
        options.onProgress({
          gravados: totalGravados,
          total: cleanRows.length,
          lote: Math.floor(i / chunkSize) + 1,
          totalLotes,
        });
      }
    }

    // If Executor was chosen, create demandas & acionamentos matching "Demandar executor"
    let acionamentosCriados = 0;
    const execName = (options?.executorUser?.name || '').trim();
    if (execName) {
      const nowIso = new Date().toISOString();
      const linkedEmails = options?.executorUser?.email
        ? [options.executorUser.email.trim().toLowerCase()]
        : [];
      const destinatariosEmails = await this.resolverDestinatariosEmails({
        responsibleName: execName,
        linkedEmails,
        vendor: 'ERICSSON',
        tipoDestinatario: 'EXECUTOR',
      });

      for (const row of cleanRows) {
        const canonSite = String(row.siteName || row.id).trim().toUpperCase();
        const targetAcId = buildAcionamentoId('ERICSSON', canonSite, 'EXECUTOR', row.id);
        await this.salvarOuAtualizarAcionamento({
          id: targetAcId,
          siteId: canonSite,
          registroId: row.id,
          rowNumberInFile: row.rowNumberInFile,
          vendor: 'ERICSSON',
          tipoDestinatario: 'EXECUTOR',
          equipe: execName,
          destinatariosEmails,
          demandadoPorNome: options?.actorName || 'Coordenação Vivo',
          demandadoPorEmail: options?.actorEmail || '',
          demandadoEm: nowIso,
          dataDemanda: row.demanda || new Date().toLocaleDateString('pt-BR'),
          observacao: `Atividades Vivo · ${row.tipoDoc || 'Documentação'}`,
        });
        acionamentosCriados++;
      }

      const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
      await setDoc(
        notifRef,
        sanitizeFirestoreData({
          id: notifRef.id,
          title: `Nova Demanda Vivo: ${cleanRows.length} atividade(s)`,
          message: `${cleanRows.length} atividade(s) Vivo atribuída(s) ao executor "${execName}".`,
          type: 'SITE_DEMANDADO_EXECUTOR',
          vendor: 'ERICSSON',
          read: false,
          readByEmails: [],
          createdAt: nowIso,
          targetRoles: ['Executor', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
          targetEquipes: [execName],
          targetEmails: destinatariosEmails,
          actorEmail: options?.actorEmail || '',
          actorName: options?.actorName || 'Coordenação Vivo',
        })
      );
    }

    return { totalGravados, acionamentosCriados };
  }

  async atualizarCamposVivoAtividade(
    rowId: string,
    patch: Record<string, any>,
    demandSync?: {
      action: 'assign' | 'remove';
      siteName: string;
      tipoDoc?: string;
      dataDemanda?: string;
      executorName?: string;
      executorEmail?: string;
      actorName?: string;
      actorEmail?: string;
    }
  ): Promise<void> {
    if (!rowId) return;
    const sanitizedPatch = sanitizeFirestoreData(patch);
    await updateDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, rowId), sanitizedPatch);

    if (demandSync) {
      const canonSite = String(demandSync.siteName || rowId).trim().toUpperCase();
      const targetAcId = buildAcionamentoId('ERICSSON', canonSite, 'EXECUTOR', rowId);

      if (demandSync.action === 'assign' && demandSync.executorName) {
        const nowIso = new Date().toISOString();
        const linkedEmails = demandSync.executorEmail
          ? [demandSync.executorEmail.trim().toLowerCase()]
          : [];
        const destinatariosEmails = await this.resolverDestinatariosEmails({
          responsibleName: demandSync.executorName,
          linkedEmails,
          vendor: 'ERICSSON',
          tipoDestinatario: 'EXECUTOR',
        });
        await this.salvarOuAtualizarAcionamento({
          id: targetAcId,
          siteId: canonSite,
          registroId: rowId,
          vendor: 'ERICSSON',
          tipoDestinatario: 'EXECUTOR',
          equipe: demandSync.executorName,
          destinatariosEmails,
          demandadoPorNome: demandSync.actorName || 'Coordenação Vivo',
          demandadoPorEmail: demandSync.actorEmail || '',
          demandadoEm: nowIso,
          dataDemanda: demandSync.dataDemanda || new Date().toLocaleDateString('pt-BR'),
          observacao: `Atividades Vivo · ${demandSync.tipoDoc || 'Documentação'}`,
        });

        const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
        await setDoc(
          notifRef,
          sanitizeFirestoreData({
            id: notifRef.id,
            title: `Nova Demanda Vivo: ${canonSite}`,
            message: `Atividade Vivo ${canonSite} (${demandSync.tipoDoc || 'Doc'}) atribuída a "${demandSync.executorName}".`,
            type: 'SITE_DEMANDADO_EXECUTOR',
            vendor: 'ERICSSON',
            read: false,
            readByEmails: [],
            createdAt: nowIso,
            targetRoles: ['Executor', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
            targetEquipes: [demandSync.executorName],
            targetEmails: destinatariosEmails,
            actorEmail: demandSync.actorEmail || '',
            actorName: demandSync.actorName || 'Coordenação Vivo',
          })
        );
      } else if (demandSync.action === 'remove') {
        await this.cancelarAcionamento(targetAcId, {
          motivo: 'Executor removido na aba Atividades Vivo',
          nome: demandSync.actorName || 'Coordenação Vivo',
          email: demandSync.actorEmail || '',
        });
      }
    }
  }

  async atualizarCampoVivoEmLote(
    updates: Array<{
      id: string;
      patch: Record<string, any>;
      siteName?: string;
      tipoDoc?: string;
      dataDemanda?: string;
    }>,
    options?: {
      demandSync?: {
        action: 'assign' | 'remove';
        executorName?: string;
        executorEmail?: string;
        actorName?: string;
        actorEmail?: string;
      };
      onProgress?: (info: { gravados: number; total: number }) => void;
    }
  ): Promise<{ totalAtualizados: number }> {
    const validUpdates = (updates || []).filter((u) => u && u.id && u.patch);
    if (validUpdates.length === 0) {
      return { totalAtualizados: 0 };
    }

    const chunkSize = 250;
    let totalAtualizados = 0;

    for (let i = 0; i < validUpdates.length; i += chunkSize) {
      const chunk = validUpdates.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_VIVO, item.id);
        batch.update(ref, sanitizeFirestoreData(item.patch));
      }
      await batch.commit();
      totalAtualizados += chunk.length;
      if (options?.onProgress) {
        options.onProgress({ gravados: totalAtualizados, total: validUpdates.length });
      }
    }

    if (options?.demandSync) {
      const ds = options.demandSync;
      const nowIso = new Date().toISOString();
      if (ds.action === 'assign' && ds.executorName) {
        const linkedEmails = ds.executorEmail ? [ds.executorEmail.trim().toLowerCase()] : [];
        const destinatariosEmails = await this.resolverDestinatariosEmails({
          responsibleName: ds.executorName,
          linkedEmails,
          vendor: 'ERICSSON',
          tipoDestinatario: 'EXECUTOR',
        });

        for (const item of validUpdates) {
          const canonSite = String(item.siteName || item.id).trim().toUpperCase();
          const targetAcId = buildAcionamentoId('ERICSSON', canonSite, 'EXECUTOR', item.id);
          await this.salvarOuAtualizarAcionamento({
            id: targetAcId,
            siteId: canonSite,
            registroId: item.id,
            vendor: 'ERICSSON',
            tipoDestinatario: 'EXECUTOR',
            equipe: ds.executorName,
            destinatariosEmails,
            demandadoPorNome: ds.actorName || 'Coordenação Vivo',
            demandadoPorEmail: ds.actorEmail || '',
            demandadoEm: nowIso,
            dataDemanda: item.dataDemanda || new Date().toLocaleDateString('pt-BR'),
            observacao: `Atividades Vivo · ${item.tipoDoc || 'Documentação'}`,
          });
        }

        const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
        await setDoc(
          notifRef,
          sanitizeFirestoreData({
            id: notifRef.id,
            title: `Nova Demanda Vivo: ${validUpdates.length} atividade(s)`,
            message: `${validUpdates.length} atividade(s) Vivo atribuída(s) ao executor "${ds.executorName}".`,
            type: 'SITE_DEMANDADO_EXECUTOR',
            vendor: 'ERICSSON',
            read: false,
            readByEmails: [],
            createdAt: nowIso,
            targetRoles: ['Executor', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
            targetEquipes: [ds.executorName],
            targetEmails: destinatariosEmails,
            actorEmail: ds.actorEmail || '',
            actorName: ds.actorName || 'Coordenação Vivo',
          })
        );
      } else if (ds.action === 'remove') {
        for (const item of validUpdates) {
          const canonSite = String(item.siteName || item.id).trim().toUpperCase();
          const targetAcId = buildAcionamentoId('ERICSSON', canonSite, 'EXECUTOR', item.id);
          await this.cancelarAcionamento(targetAcId, {
            motivo: 'Executor removido em lote na aba Atividades Vivo',
            nome: ds.actorName || 'Coordenação Vivo',
            email: ds.actorEmail || '',
          });
        }
      }
    }

    return { totalAtualizados };
  }
}

export const dataService: IDataService = new FirebaseDataService();

