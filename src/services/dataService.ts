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
} from '../types/telecom';
import { hashString, createSaltedHash } from '../utils/authUtils';
import {
  doesSiteMatchResponsible,
  doesEricssonRowMatchResponsible,
  getCanonicalDuplaName,
  normalizeAccents,
  matchesDuplaName,
} from '../utils/spreadsheetUtils';
import { INITIAL_SITES } from '../data/initialSites';
import { INITIAL_ERICSSON_SITES } from '../data/initialEricssonSites';
import { INITIAL_ERICSSON_ENGINEERING_ROWS } from '../data/initialEricssonEngineering';

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
INITIAL_ERICSSON_ENGINEERING_ROWS.forEach((r) => {
  if (r.id) initialEricssonEngMap.set(r.id, r);
});

export type Unsubscribe = () => void;
let hasShownPermissionAcionamentosToast = false;

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

export interface IDataService {
  isConfigured(): boolean;
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
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }>;
  importarSitesEricssonEmLote(
    rows: EricssonRow[],
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }>;
  importarTssrNokiaEmLote(
    rows: TssrRow[],
    users?: AmetaUser[],
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }>;
  salvarSiteNokia(
    site: TelecomSite,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirSiteNokia(siteId: string): Promise<void>;
  carregarSitesNokia(): Promise<TelecomSite[]>;
  salvarSiteEricsson(
    row: EricssonRow,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirSiteEricsson(rowId: string): Promise<void>;
  carregarSitesEricsson(): Promise<EricssonRow[]>;
  salvarTssrNokia(row: TssrRow): Promise<void>;
  excluirTssrNokia(rowId: string): Promise<void>;
  importarEricssonEngenhariaEmLote(
    rows: any[],
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }>;
  carregarEricssonEngenharia(): Promise<any[]>;
  carregarEricssonReprovacoes(): Promise<any[]>;
  salvarEricssonEngenhariaRow(row: any): Promise<void>;
  excluirEricssonEngenhariaRow(rowId: string): Promise<void>;
  salvarEricssonReprovacao(record: any): Promise<void>;
  excluirEricssonReprovacao(recordId: string): Promise<void>;
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
    vendor: 'NOKIA' | 'ERICSSON';
    actorEmail?: string;
    actorName?: string;
    allowTransfer?: boolean;
    demandDate?: string;
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number; sitesWithoutEmailCount?: number }>;
  desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: 'NOKIA' | 'ERICSSON';
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }>;
  limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: 'NOKIA' | 'ERICSSON';
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }>;
  renomearEquipeDupla(params: {
    oldName: string;
    newName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  vincularEmailsDupla(params: {
    duplaName: string;
    emails: string[];
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  desvincularEmailsDupla(params: {
    duplaName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  renomearEmailsDupla(params: {
    oldName: string;
    newName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  renomearExecutorEngenharia(params: {
    oldName: string;
    newName: string;
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }>;
  adicionarEquipeExcluida(params: {
    duplaName: string;
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  removerEquipeExcluida(params: {
    duplaName: string;
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  limparTodasLinhasEquipeDupla(params: {
    duplaName: string;
    vendor: 'NOKIA' | 'ERICSSON';
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
  limparUsuariosExcetoDono(): Promise<void>;
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
    vendor?: 'NOKIA' | 'ERICSSON';
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
    assignedScope === 'BOTH' ? 'AMBAS' : assignedScope;

  return {
    id: params.uid,
    uid: params.uid,
    name: isOwner
      ? 'Rafael Araújo'
      : (params.name || cleanEmail.split('@')[0]).trim() || 'Usuário',
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
          name: 'Rafael Araújo',
          email: 'rafael.araujo@ametaservicos.com.br',
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

  async importarSitesNokiaEmLote(
    sites: TelecomSite[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }> {
    const mode = options?.mode || 'append_only';
    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;

    try {
      // 1. Load existing docs from Firestore to accurately identify existing site IDs
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
      const existingMap = new Map<string, any>();
      snap.docs.forEach((d) => {
        existingMap.set(d.id.toUpperCase(), d.data());
        const rawSiteId = (d.data()?.siteId || '').toString().trim().toUpperCase();
        if (rawSiteId) {
          existingMap.set(rawSiteId, d.data());
        }
      });

      const docsToWrite: Array<{ id: string; data: any }> = [];

      for (const site of sites) {
        const cleanSiteId = (site.siteId || site.id || '').toString().trim();
        if (!cleanSiteId) {
          comErro++;
          continue;
        }

        const docId = sanitizeSiteDocId(cleanSiteId, site.sheetName);
        const existingData = existingMap.get(docId.toUpperCase()) || existingMap.get(cleanSiteId.toUpperCase());

        if (existingData) {
          jaExistiam++;
          if (mode === 'fill_empty') {
            // Fill ONLY empty or null fields, preserving any existing non-empty values
            const merged = { ...existingData };
            const cleanIncoming = sanitizeFirestoreData(site);
            Object.keys(cleanIncoming).forEach((key) => {
              const curVal = merged[key];
              const newVal = cleanIncoming[key];
              if (
                (curVal === undefined || curVal === null || curVal === '' || curVal === '—' || curVal === '-') &&
                newVal !== undefined && newVal !== null && newVal !== ''
              ) {
                merged[key] = newVal;
              }
            });
            // Merge customFields safely
            if (site.customFields && typeof site.customFields === 'object') {
              merged.customFields = { ...(merged.customFields || {}) };
              Object.keys(site.customFields).forEach((ck) => {
                const curC = merged.customFields[ck];
                const newC = site.customFields![ck];
                if ((curC === undefined || curC === null || curC === '') && newC) {
                  merged.customFields[ck] = newC;
                }
              });
            }
            docsToWrite.push({ id: docId, data: merged });
          }
        } else {
          novas++;
          docsToWrite.push({
            id: docId,
            data: sanitizeFirestoreData({
              ...site,
              id: docId,
              createdAt: site.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          });
        }
      }

      // 2. Write in batches of up to 20 documents
      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, item.id), item.data, { merge: true });
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

      return {
        totalAnalisados: sites.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes || 1,
      };
    } catch (err: any) {
      console.error('Erro no lote nokia_sites:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.NOKIA_SITES}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: sites.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes,
        errorMessage: errMsg,
      };
    }
  }

  async importarSitesEricssonEmLote(
    rows: EricssonRow[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>,
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }> {
    const mode = options?.mode || 'append_only';
    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES));
      const existingMap = new Map<string, any>();
      snap.docs.forEach((d) => {
        existingMap.set(d.id.toUpperCase(), d.data());
        const rKey = (d.data()?.rowKey || '').toString().trim().toUpperCase();
        if (rKey) existingMap.set(rKey, d.data());
      });

      const docsToWrite: Array<{ id: string; data: any }> = [];

      for (const row of rows) {
        const cleanA = (row.siteIdA || row.fields?.['01.21.Site ID A'] || row.fields?.['Site ID A'] || '').trim().toUpperCase();
        const cleanB = (row.siteIdB || row.fields?.['01.21.Site ID B'] || row.fields?.['Site ID B'] || '').trim().toUpperCase();
        const isPlaceholder = (s: string) => !s || s === '—' || s === '-' || s === '--' || s === 'N/A' || s === '#N/A' || s === 'TOTAL' || s === 'TOTAL GERAL' || s === 'SOMA' || s === 'SUBTOTAL' || s === '0' || s === 'LEGENDA';
        if (isPlaceholder(cleanA) && isPlaceholder(cleanB)) {
          // Skip blank / invalid rows completely
          continue;
        }

        const docId = sanitizeEricssonDocId(row);
        if (!docId) {
          comErro++;
          continue;
        }

        const existingData = existingMap.get(docId.toUpperCase()) || (row.rowKey ? existingMap.get(row.rowKey.toUpperCase()) : null);

        if (existingData) {
          jaExistiam++;
          if (mode === 'fill_empty' || mode === 'append_only') {
            const merged = { ...existingData };
            const cleanIncoming = sanitizeFirestoreData(row);
            // Merge non-empty fields from incoming row where existing is empty or missing
            Object.keys(cleanIncoming).forEach((k) => {
              if (k === 'id') return;
              // Never overwrite existing team or vistoria status with empty values
              if ((k === 'equipe' || k === 'responsavelDemand') && !cleanIncoming[k]) return;
              if (k.toLowerCase().includes('vistoria') && existingData[k] && existingData[k] !== 'Pendente') return;

              const cur = merged[k];
              const newVal = cleanIncoming[k];
              if ((cur === undefined || cur === null || cur === '' || cur === '—') && newVal !== undefined && newVal !== null && newVal !== '' && newVal !== '—') {
                merged[k] = newVal;
              }
            });

            // Merge nested fields object
            if (row.fields && typeof row.fields === 'object') {
              merged.fields = { ...(merged.fields || {}) };
              Object.keys(row.fields).forEach((fk) => {
                const curF = merged.fields[fk];
                const newF = row.fields![fk];
                if ((curF === undefined || curF === null || curF === '' || curF === '—') && newF && newF !== '—') {
                  merged.fields[fk] = newF;
                }
              });
            }
            docsToWrite.push({ id: docId, data: sanitizeFirestoreData(merged) });
          }
        } else {
          novas++;
          docsToWrite.push({
            id: docId,
            data: sanitizeFirestoreData({
              ...row,
              id: docId,
              createdAt: row.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          });
        }
      }

      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, item.id), item.data, { merge: true });
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

      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes || 1,
      };
    } catch (err: any) {
      console.error('Erro no lote ericsson_sites:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.ERICSSON_SITES}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes,
        errorMessage: errMsg,
      };
    }
  }

  async importarTssrNokiaEmLote(
    rows: TssrRow[],
    _users?: AmetaUser[],
    options?: {
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }> {
    const mode = options?.mode || 'append_only';
    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      const existingMap = new Map<string, any>();
      snap.docs.forEach((d) => {
        existingMap.set(d.id.toUpperCase(), d.data());
        const sId = (d.data()?.siteId || d.data()?.sigla || '').toString().trim().toUpperCase();
        if (sId) existingMap.set(sId, d.data());
      });

      const docsToWrite: Array<{ id: string; data: any }> = [];

      for (const row of rows) {
        const cleanKey = (row.siteId || row.sigla || row.id || '').toString().trim();
        if (!cleanKey) {
          comErro++;
          continue;
        }

        const docId = row.id || `TSSR_${cleanKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const existingData = existingMap.get(docId.toUpperCase()) || existingMap.get(cleanKey.toUpperCase());

        if (existingData) {
          jaExistiam++;
          if (mode === 'fill_empty') {
            const merged = { ...existingData };
            const cleanIncoming = sanitizeFirestoreData(row);
            Object.keys(cleanIncoming).forEach((k) => {
              const cur = merged[k];
              const newVal = cleanIncoming[k];
              if ((cur === undefined || cur === null || cur === '') && newVal !== undefined && newVal !== null && newVal !== '') {
                merged[k] = newVal;
              }
            });
            docsToWrite.push({ id: docId, data: merged });
          }
        } else {
          novas++;
          docsToWrite.push({
            id: docId,
            data: sanitizeFirestoreData({
              ...row,
              id: docId,
              createdAt: row.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          });
        }
      }

      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, item.id), item.data, { merge: true });
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

      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes || 1,
      };
    } catch (err: any) {
      console.error('Erro no lote nokia_tssr:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.NOKIA_TSSR}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes,
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
      mode?: 'append_only' | 'fill_empty';
      onProgress?: (info: { gravados: number; total: number; lote: number; totalLotes: number }) => void;
    }
  ): Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  }> {
    const mode = options?.mode || 'append_only';
    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;
    let totalGravados = 0;
    let lotes = 0;

    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA));
      const existingMap = new Map<string, any>();
      snap.docs.forEach((d) => {
        const data = d.data();
        existingMap.set(d.id.toUpperCase(), data);
        const rowKey = (data?.rowKey || '').toString().trim().toUpperCase();
        if (rowKey) existingMap.set(rowKey, data);
      });

      const docsToWrite: Array<{ id: string; data: any }> = [];

      for (const r of rows) {
        const cleanIntervencao = (r.intervencaoClaro || r.fields?.['Intervencao Claro'] || r.siteIdA || r.id || '').toString().trim();
        if (!cleanIntervencao) {
          comErro++;
          continue;
        }

        const uniqueKey = (r.rowKey || `${cleanIntervencao}__${r.tipoDoc || r.fields?.['Tipo doc'] || ''}__${r.rowIndex !== undefined ? r.rowIndex : ''}`).toString().trim().toUpperCase();
        const docId = r.id || `eric_eng_${uniqueKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const existingData = existingMap.get(docId.toUpperCase()) || existingMap.get(uniqueKey);

        if (existingData) {
          jaExistiam++;
          if (mode === 'fill_empty') {
            const merged = { ...existingData };
            const cleanIncoming = sanitizeFirestoreData(r);
            Object.keys(cleanIncoming).forEach((k) => {
              const cur = merged[k];
              const newVal = cleanIncoming[k];
              if ((cur === undefined || cur === null || cur === '') && newVal !== undefined && newVal !== null && newVal !== '') {
                merged[k] = newVal;
              }
            });
            if (r.fields && typeof r.fields === 'object') {
              merged.fields = { ...(merged.fields || {}) };
              Object.keys(r.fields).forEach((fk) => {
                const curF = merged.fields[fk];
                const newF = r.fields![fk];
                if ((curF === undefined || curF === null || curF === '') && newF) {
                  merged.fields[fk] = newF;
                }
              });
            }
            docsToWrite.push({ id: docId, data: merged });
          }
        } else {
          novas++;
          docsToWrite.push({
            id: docId,
            data: sanitizeFirestoreData({
              ...r,
              id: docId,
              createdAt: r.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          });
        }
      }

      const chunkSize = 20;
      const totalLotes = Math.ceil(docsToWrite.length / chunkSize) || 1;

      for (let i = 0; i < docsToWrite.length; i += chunkSize) {
        const chunk = docsToWrite.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, item.id), item.data, { merge: true });
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

      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes || 1,
      };
    } catch (err: any) {
      console.error('Erro no lote ericsson_engenharia:', err);
      const errMsg = `[Coleção: ${FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA}] Código: ${err.code || 'desconhecido'} - ${err.message || String(err)}`;
      return {
        totalAnalisados: rows.length,
        novas,
        jaExistiam,
        comErro,
        totalGravados,
        lotesExecutados: lotes,
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

  async salvarSiteNokia(
    site: TelecomSite,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const docId = sanitizeSiteDocId(site.siteId || site.id, site.sheetName);
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId), sanitizeFirestoreData({
      ...site,
      id: docId,
    }), { merge: true });
  }

  async excluirSiteNokia(siteId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, siteId));
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

    const merged = {
      ...existing,
      ...payload,
      accessReleased,
      assignedPlatform: payload.plataforma,
    };

    await setDoc(userRef, sanitizeFirestoreData(merged), { merge: true });
    return { id: uid, uid, ...merged } as AmetaUser;
  }

  async excluirUsuario(uidOrId: string, _email?: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uidOrId));
  }

  async limparUsuariosExcetoDono(): Promise<void> {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
    for (const d of snap.docs) {
      const data = d.data() as AmetaUser;
      if (!isOwnerAdmUser(data.email) && data.situacao !== 'dono') {
        await deleteDoc(d.ref);
      }
    }
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
    vendor: 'NOKIA' | 'ERICSSON';
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

    const destinatariosEmails = await this.resolverDestinatariosEmails({
      responsibleName: params.responsibleName,
      linkedEmails: params.linkedEmails,
      vendor: params.vendor,
    });

    if (params.vendor === 'ERICSSON') {
      const isExecutor = params.targetScope === 'executor';
      const rawTokens = Array.from(new Set(params.siteTokens.map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        const acionamentosToSync: Array<{ siteId: string; tipoDestinatario: 'EXECUTOR' | 'VISTORIA' }> = [];

        for (const rawToken of chunk) {
          const isMotherRow = rawToken.startsWith('mother-');
          const docId = isMotherRow ? rawToken.replace(/^mother-/, '') : rawToken;
          const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor && !isMotherRow ? 'EXECUTOR' : 'VISTORIA';
          acionamentosToSync.push({ siteId: docId, tipoDestinatario });

          if (isExecutor && !isMotherRow) {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            const fallback = initialEricssonEngMap.get(docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                ...(fallback || {}),
                id: docId,
                responsavelDemand: params.responsibleName,
                executor: params.responsibleName,
                fields: {
                  ...(fallback?.fields || {}),
                  EXECUTOR: params.responsibleName,
                  'EXECUTOR WR': params.responsibleName,
                  'EXECUTOR QRF': params.responsibleName,
                  'EXECUTOR PPI': params.responsibleName,
                  Executor: params.responsibleName,
                  'Data de demanda': targetDate,
                  'Data Demanda': targetDate,
                  ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
                },
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          } else {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
            const fallback = initialEricssonSitesMap.get(docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                ...(fallback || {}),
                id: docId,
                responsavelDemand: params.responsibleName,
                equipe: params.responsibleName,
                fields: {
                  ...(fallback?.fields || {}),
                  EQUIPE: params.responsibleName,
                  'EQUIPE EXECUTANTE': params.responsibleName,
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

        // Criação/atualização dos acionamentos determinísticos no Firestore
        for (const acItem of acionamentosToSync) {
          try {
            await this.salvarOuAtualizarAcionamento({
              siteId: acItem.siteId,
              vendor: 'ERICSSON',
              tipoDestinatario: acItem.tipoDestinatario,
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
      // NOKIA
      const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
      const sitesSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
      const batch1 = writeBatch(db);
      const matchedTokens = new Set<string>();
      const distinctSiteIds = new Set<string>();

      for (const d of sitesSnap.docs) {
        const data = d.data();
        const sId = (data.siteId || data.id || '').toString().trim().toUpperCase();
        const docId = d.id.toUpperCase();
        const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
        if (tokens.has(docId) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
          if (tokens.has(docId)) matchedTokens.add(docId);
          if (rowKey && tokens.has(rowKey)) matchedTokens.add(rowKey);
          if (sId) {
            matchedTokens.add(sId);
            distinctSiteIds.add(sId);
          } else {
            distinctSiteIds.add(docId);
          }

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

      // Ensure any initial Nokia sites not yet in Firestore are also created with active demand
      for (const tk of tokens) {
        if (matchedTokens.has(tk)) continue;
        const fallback = initialNokiaSitesMap.get(tk);
        if (fallback) {
          const docId = sanitizeSiteDocId(fallback.siteId || fallback.id || tk, fallback.sheetName);
          const docRef = doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId);
          const sId = (fallback.siteId || fallback.id || tk).toString().trim().toUpperCase();
          distinctSiteIds.add(sId);

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
        await batch1.commit();
      }

      const tssrSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      const batch2 = writeBatch(db);
      let tssrCount = 0;
      for (const d of tssrSnap.docs) {
        const data = d.data();
        const docId = d.id.toUpperCase();
        const rowId = (data.id || '').toString().trim().toUpperCase();
        const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
        const sId = (data.siteId || '').toString().trim().toUpperCase();
        if (tokens.has(docId) || (rowId && tokens.has(rowId)) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
          if (sId) distinctSiteIds.add(sId);
          else if (rowId) distinctSiteIds.add(rowId);

          batch2.set(
            d.ref,
            sanitizeFirestoreData({
              executor: params.responsibleName,
              equipe: params.responsibleName,
              fields: {
                ...(data.fields || {}),
                Executor: params.responsibleName,
                EQUIPE: params.responsibleName,
                'EQUIPE EXECUTANTE': params.responsibleName,
                'Data de demanda': targetDate,
                'Data Demanda': targetDate,
                ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
              },
              updatedAt: nowIso,
            }),
            { merge: true }
          );
          tssrCount++;
        }
      }
      if (tssrCount > 0) {
        await batch2.commit();
        count += tssrCount;
      }

      // Criação/atualização dos acionamentos determinísticos no Firestore (Nokia)
      const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = params.targetScope === 'executor' ? 'EXECUTOR' : 'VISTORIA';
      for (const sid of distinctSiteIds) {
        try {
          await this.salvarOuAtualizarAcionamento({
            siteId: sid,
            vendor: 'NOKIA',
            tipoDestinatario,
            equipe: params.responsibleName,
            destinatariosEmails,
            demandadoPorNome: params.actorName || 'Engenharia TIM/Nokia',
            demandadoPorEmail: params.actorEmail || '',
            demandadoEm: nowIso,
            dataDemanda: targetDate,
          });
        } catch (acErr) {
          console.warn('Erro ao sincronizar acionamento Nokia:', acErr);
        }
      }
    }

    if (count > 0) {
      const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
      await setDoc(notifRef, sanitizeFirestoreData({
        id: notifRef.id,
        title: `Nova Demanda: ${count} site(s) TIM/Nokia`,
        message: `${count} site(s) atribuído(s) à demanda da equipe "${params.responsibleName}".`,
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: 'NOKIA',
        read: false,
        readByEmails: [],
        createdAt: new Date().toISOString(),
        targetRoles: ['Executor', 'Vistoriador', 'Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
        targetEquipes: [params.responsibleName],
        targetEmails: params.linkedEmails || [],
        actorEmail: params.actorEmail || '',
        actorName: params.actorName || 'Engenharia TIM/Nokia',
      }));
    }

    return {
      updatedCount: count,
      sitesWithoutEmailCount: destinatariosEmails.length === 0 ? count : 0,
    };
  }

  async desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: 'NOKIA' | 'ERICSSON';
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }> {
    const nowIso = new Date().toISOString();
    let count = 0;

    if (params.vendor === 'ERICSSON') {
      const isExecutor = params.targetScope === 'executor';
      const rawTokens = Array.from(new Set(params.siteTokens.map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const rawToken of chunk) {
          const isMotherRow = rawToken.startsWith('mother-');
          const docId = isMotherRow ? rawToken.replace(/^mother-/, '') : rawToken;
          const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor && !isMotherRow ? 'EXECUTOR' : 'VISTORIA';
          const acId = buildAcionamentoId('ERICSSON', docId, tipoDestinatario);
          this.cancelarAcionamento(acId, { motivo: 'Demanda desvinculada / removida' }).catch(() => {});

          if (isExecutor && !isMotherRow) {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                responsavelDemand: '',
                executor: '',
                fields: {
                  EXECUTOR: '',
                  'EXECUTOR WR': '',
                  'EXECUTOR QRF': '',
                  'EXECUTOR PPI': '',
                  Executor: '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
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
          }
          count++;
        }
        await batch.commit();
      }
      return { updatedCount: count };
    } else {
      // NOKIA
      const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
      const sitesSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
      const batch1 = writeBatch(db);
      for (const d of sitesSnap.docs) {
        const data = d.data();
        const sId = (data.siteId || data.id || '').toString().trim().toUpperCase();
        const docId = d.id.toUpperCase();
        const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
        if (tokens.has(docId) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
          batch1.update(d.ref, {
            responsavelDemand: '',
            equipeParceira: '',
            responsavelCampo: '',
            equipe: '',
            responsaveisEmails: [],
            'customFields.EQUIPE EXECUTANTE': '',
            'customFields.EQUIPE': '',
            'customFields.Executor': '',
            'customFields.Responsável': '',
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

      const tssrSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR));
      const batch2 = writeBatch(db);
      let tssrCount = 0;
      for (const d of tssrSnap.docs) {
        const data = d.data();
        const docId = d.id.toUpperCase();
        const rowId = (data.id || '').toString().trim().toUpperCase();
        const rowKey = (data.rowKey || '').toString().trim().toUpperCase();
        const sId = (data.siteId || '').toString().trim().toUpperCase();
        if (tokens.has(docId) || (rowId && tokens.has(rowId)) || (rowKey && tokens.has(rowKey)) || (sId && tokens.has(sId))) {
          batch2.update(d.ref, {
            executor: '',
            equipe: '',
            'fields.Executor': '',
            'fields.EQUIPE': '',
            'fields.EQUIPE EXECUTANTE': '',
            'fields.E-MAIL DUPLA': '',
            'fields.Data de demanda': '',
            'fields.Data Demanda': '',
            updatedAt: nowIso,
          });
          tssrCount++;
        }
      }
      if (tssrCount > 0) {
        await batch2.commit();
        count += tssrCount;
      }

      // Cancelar acionamentos para os tokens desvinculados (Nokia)
      const targetScope = params.targetScope;
      for (const tk of tokens) {
        if (!targetScope || targetScope === 'equipe') {
          this.cancelarAcionamento(buildAcionamentoId('NOKIA', tk, 'VISTORIA'), { motivo: 'Demanda desvinculada / removida' }).catch(() => {});
        }
        if (!targetScope || targetScope === 'executor') {
          this.cancelarAcionamento(buildAcionamentoId('NOKIA', tk, 'EXECUTOR'), { motivo: 'Demanda desvinculada / removida' }).catch(() => {});
        }
      }
    }

    return { updatedCount: count };
  }

  async limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: 'NOKIA' | 'ERICSSON';
    targetScope?: 'equipe' | 'executor';
  }): Promise<{ updatedCount: number }> {
    if (params.vendor === 'ERICSSON') {
      const isExecutor = params.targetScope === 'executor';
      const rawTokens = Array.from(new Set((params.siteTokens || []).map((t) => t.trim()).filter(Boolean)));
      if (rawTokens.length === 0) {
        return { updatedCount: 0 };
      }
      const nowIso = new Date().toISOString();
      let count = 0;
      const chunkSize = 450;

      for (let i = 0; i < rawTokens.length; i += chunkSize) {
        const chunk = rawTokens.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const rawToken of chunk) {
          const isMotherRow = rawToken.startsWith('mother-');
          const docId = isMotherRow ? rawToken.replace(/^mother-/, '') : rawToken;
          const tipoDestinatario: 'EXECUTOR' | 'VISTORIA' = isExecutor && !isMotherRow ? 'EXECUTOR' : 'VISTORIA';
          const acId = buildAcionamentoId('ERICSSON', docId, tipoDestinatario);
          this.cancelarAcionamento(acId, { motivo: 'Demanda desvinculada / removida' }).catch(() => {});

          if (isExecutor && !isMotherRow) {
            const docRef = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId);
            batch.set(
              docRef,
              sanitizeFirestoreData({
                responsavelDemand: '',
                executor: '',
                fields: {
                  EXECUTOR: '',
                  'EXECUTOR WR': '',
                  'EXECUTOR QRF': '',
                  'EXECUTOR PPI': '',
                  Executor: '',
                  'E-MAIL DUPLA': '',
                  'Data de demanda': '',
                  'Data Demanda': '',
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
          }
          count++;
        }
        await batch.commit();
      }
      return { updatedCount: count };
    }

    // NOKIA
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
    const batch = writeBatch(db);
    let count = 0;
    const target = params.responsibleName.trim().toUpperCase();

    for (const d of snap.docs) {
      const data = d.data();
      const resp = (data.responsavelDemand || data.equipe || data.equipeParceira || '').trim().toUpperCase();
      if (resp === target || matchesDuplaName(resp, params.responsibleName)) {
        const sId = (data.siteId || data.id || d.id || '').toString().trim().toUpperCase();
        if (sId) {
          this.cancelarAcionamento(buildAcionamentoId('NOKIA', sId, 'VISTORIA'), { motivo: 'Demanda desvinculada / removida' }).catch(() => {});
          this.cancelarAcionamento(buildAcionamentoId('NOKIA', sId, 'EXECUTOR'), { motivo: 'Demanda desvinculada / removida' }).catch(() => {});
        }
        batch.update(d.ref, {
          responsavelDemand: '',
          equipeParceira: '',
          responsavelCampo: '',
          equipe: '',
          responsaveisEmails: [],
          'customFields.EQUIPE EXECUTANTE': '',
          'customFields.EQUIPE': '',
          'customFields.Executor': '',
          'customFields.Responsável': '',
          'customFields.E-MAIL DUPLA': '',
          'customFields.Data de demanda': '',
          'customFields.Data Demanda': '',
          updatedAt: new Date().toISOString(),
        });
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();
    }
    return { updatedCount: count };
  }

  async renomearEquipeDupla(params: {
    oldName: string;
    newName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void> {
    const vendors = params.vendor ? [params.vendor] : (['NOKIA', 'ERICSSON'] as const);
    for (const v of vendors) {
      const colName = v === 'ERICSSON' ? FIRESTORE_COLLECTIONS.ERICSSON_SITES : FIRESTORE_COLLECTIONS.NOKIA_SITES;
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
    vendor?: 'NOKIA' | 'ERICSSON';
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
    vendor?: 'NOKIA' | 'ERICSSON';
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
    vendor: 'NOKIA' | 'ERICSSON';
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
    vendor: 'NOKIA' | 'ERICSSON';
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
    vendor: 'NOKIA' | 'ERICSSON';
    siteIds?: string[];
  }): Promise<{ updatedCount: number }> {
    const isEricsson = params.vendor === 'ERICSSON';
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
      // 1. NOKIA_SITES
      const sitesSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES));
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

    // 3. Usuários
    if (Array.isArray(seed.users) && seed.users.length > 0) {
      if (onProgress) onProgress(`Gravando ${seed.users.length} usuários no Firestore...`);
      const batch = writeBatch(db);
      for (const u of seed.users) {
        const uid = u.uid || u.id;
        if (uid) {
          const { cpf, initialPasswordHash, passwordHash, ...cleanU } = u as any;
          batch.set(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid), sanitizeFirestoreData(cleanU), { merge: true });
          if (cpf) {
            batch.set(
              doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid, 'privado', 'dados'),
              sanitizeFirestoreData({
                cpf: String(cpf).trim(),
                updatedAt: new Date().toISOString(),
              }),
              { merge: true }
            );
          }
          totalUsers++;
        }
      }
      await batch.commit();
    }

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

    if (onProgress) onProgress(`Importação inicial concluída com sucesso! (${totalSites} Nokia, ${totalEricsson} Ericsson, ${totalUsers} Usuários)`);
    return { totalSites, totalEricsson, totalUsers };
  }

  async sincronizarUsuariosIniciais(): Promise<number> {
    try {
      const res = await window.fetch('/initial-db.json');
      if (!res.ok) return 0;
      const seed = await res.json();
      if (!Array.isArray(seed.users) || seed.users.length === 0) return 0;

      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      const existingEmails = new Set(
        snap.docs.map((d) => (d.data().email || '').toLowerCase().trim())
      );

      let count = 0;
      const batch = writeBatch(db);
      for (const u of seed.users) {
        const email = (u.email || '').toLowerCase().trim();
        if (email && !existingEmails.has(email)) {
          const uid = u.uid || u.id;
          if (uid) {
            const { cpf, initialPasswordHash, passwordHash, ...cleanU } = u as any;
            batch.set(
              doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid),
              sanitizeFirestoreData(cleanU),
              { merge: true }
            );
            if (cpf) {
              batch.set(
                doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid, 'privado', 'dados'),
                sanitizeFirestoreData({
                  cpf: String(cpf).trim(),
                  updatedAt: new Date().toISOString(),
                }),
                { merge: true }
              );
            }
            count++;
          }
        }
      }
      if (count > 0) {
        await batch.commit();
      }
      return count;
    } catch (err) {
      console.error('Erro ao sincronizar usuários iniciais:', err);
      return 0;
    }
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

    if (callbacks.onNokiaSites) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TelecomSite));
          callbacks.onNokiaSites!(list);
        }, (err) => console.error('Nokia sites snapshot error:', err))
      );
    }
    if (callbacks.onNokiaTssr) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TssrRow));
          callbacks.onNokiaTssr!(list);
        }, (err) => console.error('Nokia TSSR snapshot error:', err))
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
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EricssonRow));
          callbacks.onEricssonSites!(list);
        }, (err) => console.error('Ericsson sites snapshot error:', err))
      );
    }
    if (callbacks.onEricssonEngineering) {
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EricssonEngineeringRow));
          callbacks.onEricssonEngineering!(list);
        }, (err) => console.error('Ericsson engenharia snapshot error:', err))
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
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<string[]> {
    const emailsSet = new Set<string>();
    (params.linkedEmails || []).forEach((e) => {
      const clean = String(e || '').trim().toLowerCase();
      if (clean && clean.includes('@')) emailsSet.add(clean);
    });

    const cleanResp = (params.responsibleName || '').trim();
    if (!cleanResp) return Array.from(emailsSet);

    // 1. Consultar duplas_config/main
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
                if (c && c.includes('@')) emailsSet.add(c);
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

    // 2. Consultar coleção usuarios cadastrados
    try {
      const usersSnap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      usersSnap.docs.forEach((d) => {
        const u = d.data() as AmetaUser;
        const uEmail = (u.email || '').trim().toLowerCase();
        if (!uEmail || !uEmail.includes('@')) return;

        const isMatch =
          matchesDuplaName(u.equipe, cleanResp) ||
          matchesDuplaName(u.name, cleanResp) ||
          matchesDuplaName((u as any).dupla, cleanResp);

        if (isMatch) {
          emailsSet.add(uEmail);
        }
      });
    } catch (err) {
      console.warn('Erro ao consultar usuarios para destinatários:', err);
    }

    return Array.from(emailsSet);
  }

  async salvarOuAtualizarAcionamento(
    payload: Partial<Acionamento> & {
      siteId: string;
      vendor: VendorType;
      tipoDestinatario: 'EXECUTOR' | 'VISTORIA';
      equipe: string;
      dataDemanda?: string;
    }
  ): Promise<Acionamento & { hasNoEmail: boolean }> {
    const docId = payload.id || buildAcionamentoId(payload.vendor, payload.siteId, payload.tipoDestinatario);
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
    const vPrefix = payload.vendor === 'ERICSSON' ? 'ERI' : 'NOK';
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
    const evento: AcionamentoHistorico = {
      data: nowIso,
      autor: actor?.nome || 'Coordenação Telecom',
      email: (actor?.email || '').toLowerCase(),
      acao: 'Demanda cancelada / removida no Telecom',
      status: 'Cancelado',
      detalhes: actor?.motivo || 'Demanda desvinculada',
    };

    const updatedHistorico = [...(data.historico || []), evento];
    await updateDoc(
      docRef,
      sanitizeFirestoreData({
        status: 'Cancelado',
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
}

export const dataService: IDataService = new FirebaseDataService();
