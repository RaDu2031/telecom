// Pure REST Data Service for Ameta Telecom
// Decoupled from Firebase and Netlify, communicating directly with Express backend (server.ts)

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
  NOTIFICACOES: 'notificacoes',
} as const;

export const MAX_FIRESTORE_BATCH_SIZE = 500;

export function stripUndefined<T>(val: T): T {
  if (val === null || val === undefined) {
    return undefined as unknown as T;
  }
  if (Array.isArray(val)) {
    return val
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }
  if (typeof val === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, any>)) {
      if (v !== undefined) {
        const cleaned = stripUndefined(v);
        if (cleaned !== undefined) {
          result[k] = cleaned;
        }
      }
    }
    return result as T;
  }
  return val;
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
  salvarTssrNokia(row: TssrRow): Promise<void>;
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

class RestDataService implements IDataService {
  isConfigured(): boolean {
    return false; // Direct REST API mode (self-hosted Express server)
  }

  async garantirUsuarioAoAutenticar(params: {
    uid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<AmetaUser> {
    const cleanEmail = params.email.trim().toLowerCase();
    const isOwner = isOwnerAdmUser(cleanEmail);
    return {
      id: params.uid,
      uid: params.uid,
      name: isOwner ? 'Rafael Araújo' : params.name || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: isOwner ? 'ADM' : 'Vistoriador',
      situacao: isOwner ? 'dono' : 'aguardando',
      plataforma: isOwner ? 'AMBAS' : 'NOKIA',
      assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
      accessReleased: isOwner,
      documents: ensureUserMandatoryDocuments(),
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
  }

  async obterUsuarioPorUid(uid: string): Promise<AmetaUser | null> {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return null;
      const data = await res.json();
      const list: AmetaUser[] = Array.isArray(data.users) ? data.users : [];
      return list.find((u) => u.id === uid || u.uid === uid) || null;
    } catch {
      return null;
    }
  }

  async listarTodosUsuarios(): Promise<AmetaUser[]> {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.users) ? data.users : [];
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
    const res = await fetch('/api/owner/permissions/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        accessReleased: params.situacao === 'ativo' || params.situacao === 'dono',
      }),
    });
    const data = await res.json();
    return data.user || params;
  }

  async importarSitesNokiaEmLote(
    sites: TelecomSite[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    try {
      const res = await fetch('/api/sites/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sites }),
      });
      if (res.ok) return { totalGravados: sites.length, lotesExecutados: 1 };
    } catch {
      // ignore
    }
    return { totalGravados: sites.length, lotesExecutados: 1 };
  }

  async importarSitesEricssonEmLote(
    rows: EricssonRow[],
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    try {
      const res = await fetch('/api/ericsson/sites/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (res.ok) return { totalGravados: rows.length, lotesExecutados: 1 };
    } catch {
      // ignore
    }
    return { totalGravados: rows.length, lotesExecutados: 1 };
  }

  async importarTssrNokiaEmLote(
    rows: TssrRow[],
    _users?: AmetaUser[]
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    return { totalGravados: rows.length, lotesExecutados: 1 };
  }

  async salvarSiteNokia(
    site: TelecomSite,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(site),
    }).catch(() => {});
  }

  async excluirSiteNokia(siteId: string): Promise<void> {
    await fetch(`/api/sites/${encodeURIComponent(siteId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarSiteEricsson(
    row: EricssonRow,
    _users?: AmetaUser[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    await fetch('/api/ericsson/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    }).catch(() => {});
  }

  async excluirSiteEricsson(rowId: string): Promise<void> {
    await fetch(`/api/ericsson/sites/${encodeURIComponent(rowId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarTssrNokia(_row: TssrRow): Promise<void> {}

  async salvarPastaNokia(folder: EngineeringFolder): Promise<void> {
    await fetch('/api/engineering/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folder),
    }).catch(() => {});
  }

  async excluirPastaNokia(folderId: string): Promise<void> {
    await fetch(`/api/engineering/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarArquivoNokia(
    file: EngineeringFile,
    _users?: AmetaUser[],
    _sites?: TelecomSite[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    await fetch('/api/engineering/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    }).catch(() => {});
  }

  async excluirArquivoNokia(fileId: string): Promise<void> {
    await fetch(`/api/engineering/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarPastaEricsson(folder: EngineeringFolder): Promise<void> {
    await fetch('/api/ericsson/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folder),
    }).catch(() => {});
  }

  async excluirPastaEricsson(folderId: string): Promise<void> {
    await fetch(`/api/ericsson/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarArquivoEricsson(
    file: EngineeringFile,
    _users?: AmetaUser[],
    _rows?: EricssonRow[],
    _duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    await fetch('/api/ericsson/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    }).catch(() => {});
  }

  async excluirArquivoEricsson(fileId: string): Promise<void> {
    await fetch(`/api/ericsson/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async salvarMapaDuplas(
    duplaEmailsMap: Record<string, string[]>,
    customDuplas?: string[]
  ): Promise<void> {
    await fetch('/api/duplas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplaEmailsMap, customDuplas }),
    }).catch(() => {});
  }

  async carregarMapaDuplas(): Promise<{
    duplaEmailsMap?: Record<string, string[]>;
    customDuplas?: string[];
  }> {
    try {
      const res = await fetch('/api/duplas');
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return {};
  }

  async criarNotificacao(notif: AmetaNotification): Promise<void> {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notif),
    }).catch(() => {});
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
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao registrar usuário.');
    }
    return data.user;
  }

  async autenticarUsuarioCorporativo(params: {
    email: string;
    password: string;
  }): Promise<AmetaUser | null> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Credenciais inválidas.');
    }
    return data.user;
  }

  async salvarDocumentosUsuario(params: {
    uidOrId: string;
    email: string;
    documents: any[];
    dispensadoDocumentos?: boolean;
    statusRecurso?: string;
  }): Promise<void> {
    await fetch(`/api/admin/users/${encodeURIComponent(params.uidOrId)}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).catch(() => {});
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
    const res = await fetch('/api/owner/permissions/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        userId: uid,
        accessReleased: payload.situacao === 'ativo' || payload.situacao === 'dono',
      }),
    });
    const data = await res.json();
    return data.user || { id: uid, uid, ...payload };
  }

  async excluirUsuario(uidOrId: string, _email?: string): Promise<void> {
    await fetch(`/api/admin/users/${encodeURIComponent(uidOrId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  async limparUsuariosExcetoDono(): Promise<void> {
    await fetch('/api/admin/users/purge-non-owner', {
      method: 'POST',
    }).catch(() => {});
  }

  observarPerfilUsuario(_uid: string, _onUpdate: (user: AmetaUser | null) => void): Unsubscribe {
    return () => {};
  }

  observarColecoesPlataforma(
    _user: AmetaUser,
    _callbacks: {
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
    return () => {};
  }
}

export const dataService: IDataService = new RestDataService();
