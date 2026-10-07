// Firebase Data Service for Ameta Telecom (100% Client-Side Firestore & Auth)

import { db, auth } from '../lib/firebaseClient';
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
  UserRole,
  AssignedPlatformScope,
  UserSituacao,
  isOwnerAdmUser,
  ensureUserMandatoryDocuments,
} from '../types/telecom';
import {
  doesSiteMatchResponsible,
  doesEricssonRowMatchResponsible,
} from '../utils/spreadsheetUtils';

export type Unsubscribe = () => void;

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
} as const;

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
  garantirUsuarioAoAutenticar(params: {
    uid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<AmetaUser>;
  obterUsuarioPorUid(uid: string): Promise<AmetaUser | null>;
  listarTodosUsuarios(): Promise<AmetaUser[]>;
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
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }>;
  importarSitesEricssonEmLote(
    rows: EricssonRow[],
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }>;
  importarTssrNokiaEmLote(
    rows: TssrRow[],
    users?: AmetaUser[]
  ): Promise<{ totalGravados: number; lotesExecutados: number }>;
  salvarSiteNokia(
    site: TelecomSite,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirSiteNokia(siteId: string): Promise<void>;
  salvarSiteEricsson(
    row: EricssonRow,
    users?: AmetaUser[],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void>;
  excluirSiteEricsson(rowId: string): Promise<void>;
  carregarSitesEricsson(): Promise<EricssonRow[]>;
  salvarTssrNokia(row: TssrRow): Promise<void>;
  excluirTssrNokia(rowId: string): Promise<void>;
  importarEricssonEngenhariaEmLote(rows: any[]): Promise<{ totalGravados: number }>;
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
  }): Promise<{ updatedCount: number }>;
  desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }>;
  limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }>;
  renomearEquipeDupla(params: {
    oldName: string;
    newName: string;
    vendor?: 'NOKIA' | 'ERICSSON';
  }): Promise<void>;
  vincularEmailsDupla(params: {
    duplaName: string;
    emails: string[];
  }): Promise<void>;
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
      onEricssonFolders?: (folders: EngineeringFolder[]) => void;
      onEricssonFiles?: (files: EngineeringFile[]) => void;
      onUsuarios?: (users: AmetaUser[]) => void;
      onDuplasConfig?: (config: {
        duplaEmailsMap?: Record<string, string[]>;
        customDuplas?: string[];
      }) => void;
      onNotificacoes?: (notifs: AmetaNotification[]) => void;
    }
  ): Unsubscribe;
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
        await setDoc(userRef, updated, { merge: true });
        return updated;
      }
      return { id: params.uid, uid: params.uid, ...existing };
    }

    const newUser = buildAmetaUserProfile({
      uid: params.uid,
      email: cleanEmail,
      name: params.name,
    });

    await setDoc(userRef, newUser);
    return newUser;
  }

  async obterUsuarioPorUid(uid: string): Promise<AmetaUser | null> {
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid));
      if (snap.exists()) {
        return { id: snap.id, uid: snap.id, ...snap.data() } as AmetaUser;
      }
      return null;
    } catch {
      return null;
    }
  }

  async listarTodosUsuarios(): Promise<AmetaUser[]> {
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      return snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() } as AmetaUser));
    } catch {
      return [];
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

    await setDoc(userRef, payload, { merge: true });
    return { id: params.uid, uid: params.uid, ...payload } as AmetaUser;
  }

  async importarSitesNokiaEmLote(
    sites: TelecomSite[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    for (const site of sites) {
      const docId = sanitizeSiteDocId(site.siteId || site.id, site.sheetName);
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId), {
        ...site,
        id: docId,
      }, { merge: true });
    }
    return { totalGravados: sites.length, lotesExecutados: 1 };
  }

  async importarSitesEricssonEmLote(
    rows: EricssonRow[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    for (const row of rows) {
      const docId = sanitizeEricssonDocId(row);
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId), {
        ...row,
        id: docId,
      }, { merge: true });
    }
    return { totalGravados: rows.length, lotesExecutados: 1 };
  }

  async importarTssrNokiaEmLote(
    rows: TssrRow[],
    _users?: AmetaUser[]
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    const chunkSize = 400;
    let totalGravados = 0;
    let lotes = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const row of chunk) {
        const docId = row.id || `TSSR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, docId), {
          ...row,
          id: docId,
        }, { merge: true });
      }
      await batch.commit();
      totalGravados += chunk.length;
      lotes++;
    }
    return { totalGravados, lotesExecutados: lotes || 1 };
  }

  async excluirTssrNokia(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, rowId));
  }

  async importarEricssonEngenhariaEmLote(
    rows: any[]
  ): Promise<{ totalGravados: number }> {
    const chunkSize = 400;
    let totalGravados = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const r of chunk) {
        const docId = r.id || `eric_eng_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId), {
          ...r,
          id: docId,
        }, { merge: true });
      }
      await batch.commit();
      totalGravados += chunk.length;
    }
    return { totalGravados };
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, docId), {
      ...row,
      id: docId,
    }, { merge: true });
  }

  async excluirEricssonEngenhariaRow(rowId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, rowId));
  }

  async salvarEricssonReprovacao(record: any): Promise<void> {
    const docId = record.id || `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_REPROVACOES, docId), {
      ...record,
      id: docId,
      createdAt: record.createdAt || new Date().toISOString(),
    }, { merge: true });
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId), {
      ...site,
      id: docId,
    }, { merge: true });
  }

  async excluirSiteNokia(siteId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, siteId));
  }

  async salvarSiteEricsson(
    row: EricssonRow,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    const docId = sanitizeEricssonDocId(row);
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId), {
      ...row,
      id: docId,
    }, { merge: true });
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, docId), {
      ...row,
      id: docId,
    }, { merge: true });
  }

  async salvarPastaNokia(folder: EngineeringFolder): Promise<void> {
    const docId = folder.id || `FOLDER_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS, docId), {
      ...folder,
      id: docId,
    }, { merge: true });
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, docId), {
      ...file,
      id: docId,
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    }, { merge: true });
  }

  async excluirArquivoNokia(fileId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, fileId));
  }

  async salvarPastaEricsson(folder: EngineeringFolder): Promise<void> {
    const docId = folder.id || `FOLDER_ERIC_${Date.now()}`;
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS, docId), {
      ...folder,
      id: docId,
    }, { merge: true });
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, docId), {
      ...file,
      id: docId,
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    }, { merge: true });
  }

  async excluirArquivoEricsson(fileId: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, fileId));
  }

  async salvarMapaDuplas(
    duplaEmailsMap: Record<string, string[]>,
    customDuplas?: string[]
  ): Promise<void> {
    await setDoc(doc(db, 'duplas_config', 'main'), {
      duplaEmailsMap,
      customDuplas,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
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
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, docId), {
      ...notif,
      id: docId,
      createdAt: notif.createdAt || new Date().toISOString(),
    }, { merge: true });
  }

  async registrarNovoUsuarioCorporativo(params: {
    name: string;
    email: string;
    password: string;
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
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid), newUser);
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
    await updateDoc(userRef, {
      documents: params.documents,
      dispensadoDocumentos: params.dispensadoDocumentos ?? false,
      statusRecurso: params.statusRecurso || 'analise',
    });
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

    await setDoc(userRef, merged, { merge: true });
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
    if (markAll && userEmail) {
      const q = query(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES), where('targetEmail', '==', userEmail.toLowerCase()));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.update(d.ref, { read: true });
      });
      await batch.commit();
    } else if (notificationId) {
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, notificationId), { read: true });
    }
  }

  async excluirNotificacao(id: string): Promise<void> {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, id));
  }

  async bloquearUsuario(uid: string, motivo?: string): Promise<void> {
    await updateDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid), {
      situacao: 'bloqueado',
      accessReleased: false,
      bloqueadoEm: new Date().toISOString(),
      motivoBloqueio: motivo || 'Acesso bloqueado pelo administrador (conta Auth preservada)',
    });
  }

  async atribuirDemandaSites(params: {
    siteTokens: string[];
    responsibleName: string;
    linkedEmails?: string[];
    vendor: 'NOKIA' | 'ERICSSON';
    actorEmail?: string;
    actorName?: string;
  }): Promise<{ updatedCount: number }> {
    const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()));
    const colName = params.vendor === 'ERICSSON' ? FIRESTORE_COLLECTIONS.ERICSSON_SITES : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const snap = await getDocs(collection(db, colName));
    const batch = writeBatch(db);
    let count = 0;

    for (const d of snap.docs) {
      const data = d.data();
      const sId = (data.siteId || data.id || '').toUpperCase();
      const docId = d.id.toUpperCase();
      if (tokens.has(sId) || tokens.has(docId)) {
        if (params.vendor === 'ERICSSON') {
          batch.update(d.ref, {
            responsavelDemand: params.responsibleName,
            equipe: params.responsibleName,
            'fields.EQUIPE': params.responsibleName,
            ...(params.linkedEmails && params.linkedEmails.length > 0 ? { 'fields.E-MAIL DUPLA': params.linkedEmails.join(', ') } : {}),
            updatedAt: new Date().toISOString(),
          });
        } else {
          batch.update(d.ref, {
            responsavelDemand: params.responsibleName,
            equipeParceira: params.responsibleName,
            responsavelCampo: params.responsibleName,
            'customFields.EQUIPE EXECUTANTE': params.responsibleName,
            'customFields.Executor': params.responsibleName,
            'customFields.Responsável': params.responsibleName,
            ...(params.linkedEmails && params.linkedEmails.length > 0 ? { 'customFields.E-MAIL DUPLA': params.linkedEmails.join(', ') } : {}),
            updatedAt: new Date().toISOString(),
          });
        }
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();

      const notifRef = doc(collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES));
      await setDoc(notifRef, {
        id: notifRef.id,
        title: `Nova Demanda: ${count} site(s) ${params.vendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'}`,
        message: `${count} site(s) colocados na demanda da equipe "${params.responsibleName}".`,
        type: 'demanda',
        read: false,
        createdAt: new Date().toISOString(),
        targetRole: 'Executor',
        targetPlatform: params.vendor,
        targetResponsible: params.responsibleName,
        actorEmail: params.actorEmail || '',
      });
    }

    return { updatedCount: count };
  }

  async desvincularDemandaSites(params: {
    siteTokens: string[];
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }> {
    const tokens = new Set(params.siteTokens.map((t) => t.trim().toUpperCase()));
    const colName = params.vendor === 'ERICSSON' ? FIRESTORE_COLLECTIONS.ERICSSON_SITES : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const snap = await getDocs(collection(db, colName));
    const batch = writeBatch(db);
    let count = 0;

    for (const d of snap.docs) {
      const data = d.data();
      const sId = (data.siteId || data.id || '').toUpperCase();
      const docId = d.id.toUpperCase();
      if (tokens.has(sId) || tokens.has(docId)) {
        if (params.vendor === 'ERICSSON') {
          batch.update(d.ref, {
            responsavelDemand: '',
            equipe: '',
            'fields.EQUIPE': '',
            'fields.E-MAIL DUPLA': '',
            updatedAt: new Date().toISOString(),
          });
        } else {
          batch.update(d.ref, {
            responsavelDemand: '',
            equipeParceira: '',
            responsavelCampo: '',
            'customFields.EQUIPE EXECUTANTE': '',
            'customFields.Executor': '',
            'customFields.Responsável': '',
            'customFields.E-MAIL DUPLA': '',
            updatedAt: new Date().toISOString(),
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

  async limparTodosSitesDemanda(params: {
    responsibleName: string;
    siteTokens?: string[];
    vendor: 'NOKIA' | 'ERICSSON';
  }): Promise<{ updatedCount: number }> {
    const colName = params.vendor === 'ERICSSON' ? FIRESTORE_COLLECTIONS.ERICSSON_SITES : FIRESTORE_COLLECTIONS.NOKIA_SITES;
    const snap = await getDocs(collection(db, colName));
    const batch = writeBatch(db);
    let count = 0;
    const target = params.responsibleName.trim().toUpperCase();

    for (const d of snap.docs) {
      const data = d.data();
      const resp = (data.responsavelDemand || data.equipe || data.equipeParceira || '').trim().toUpperCase();
      if (resp === target) {
        if (params.vendor === 'ERICSSON') {
          batch.update(d.ref, {
            responsavelDemand: '',
            equipe: '',
            'fields.EQUIPE': '',
            'fields.E-MAIL DUPLA': '',
            updatedAt: new Date().toISOString(),
          });
        } else {
          batch.update(d.ref, {
            responsavelDemand: '',
            equipeParceira: '',
            responsavelCampo: '',
            'customFields.EQUIPE EXECUTANTE': '',
            'customFields.Executor': '',
            'customFields.Responsável': '',
            'customFields.E-MAIL DUPLA': '',
            updatedAt: new Date().toISOString(),
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
  }): Promise<void> {
    const cfgRef = doc(db, 'duplas_config', 'main');
    await setDoc(cfgRef, {
      duplaEmailsMap: {
        [params.duplaName]: params.emails,
      },
    }, { merge: true });
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
          batch.set(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid), u, { merge: true });
          totalUsers++;
        }
      }
      await batch.commit();
    }

    // 4. Configuração de Duplas
    if (seed.duplaEmailsMap) {
      await setDoc(doc(db, 'duplas_config', 'main'), {
        duplaEmailsMap: seed.duplaEmailsMap,
      }, { merge: true });
    }

    // 5. Notificações
    if (Array.isArray(seed.notifications) && seed.notifications.length > 0) {
      const batch = writeBatch(db);
      for (const n of seed.notifications.slice(0, 100)) {
        const docId = n.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, docId), {
          ...n,
          id: docId,
        }, { merge: true });
      }
      await batch.commit();
    }

    if (onProgress) onProgress(`Importação inicial concluída com sucesso! (${totalSites} Nokia, ${totalEricsson} Ericsson, ${totalUsers} Usuários)`);
    return { totalSites, totalEricsson, totalUsers };
  }

  observarColecoesPlataforma(
    _user: AmetaUser,
    callbacks: {
      onNokiaSites?: (sites: TelecomSite[]) => void;
      onNokiaTssr?: (rows: TssrRow[]) => void;
      onNokiaFolders?: (folders: EngineeringFolder[]) => void;
      onNokiaFiles?: (files: EngineeringFile[]) => void;
      onEricssonSites?: (rows: EricssonRow[]) => void;
      onEricssonFolders?: (folders: EngineeringFolder[]) => void;
      onEricssonFiles?: (files: EngineeringFile[]) => void;
      onUsuarios?: (users: AmetaUser[]) => void;
      onDuplasConfig?: (config: {
        duplaEmailsMap?: Record<string, string[]>;
        customDuplas?: string[];
      }) => void;
      onNotificacoes?: (notifs: AmetaNotification[]) => void;
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
      unsubs.push(
        onSnapshot(collection(db, FIRESTORE_COLLECTIONS.USUARIOS), (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() } as AmetaUser));
          callbacks.onUsuarios!(list);
        }, (err) => console.error('Usuarios snapshot error:', err))
      );
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

    return () => {
      unsubs.forEach((u) => u());
    };
  }
}

export const dataService: IDataService = new FirebaseDataService();
