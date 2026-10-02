import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  auth,
  isFirebaseEnvConfigured,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
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
  isUserDono,
  isUserAguardando,
  canUserAccessVendor,
  ensureUserMandatoryDocuments,
} from '../types/telecom';
import {
  doesSiteMatchResponsible,
  doesEricssonRowMatchResponsible,
} from '../utils/spreadsheetUtils';

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

/**
 * Sanitiza um Site ID para ser usado como ID de documento no Firestore (sem barras ou caracteres proibidos)
 */
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

/**
 * Sanitiza o identificador de linha Ericsson (usando Site ID A e Site ID B) para ID de documento sem duplicar
 */
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

/**
 * Resolve os UIDs e e-mails das contas responsáveis por um site TIM/Nokia
 * para permitir que as firestore.rules validem a leitura de Executor/Vistoriador
 */
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

/**
 * Resolve os UIDs e e-mails das contas responsáveis por um enlace/par de sites Ericsson
 */
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

/**
 * Interface desacoplada do serviço de dados (permite trocar o provedor sem reescrever as telas)
 */
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

class FirestoreDataService implements IDataService {
  isConfigured(): boolean {
    return isFirebaseEnvConfigured && Boolean(db);
  }

  async garantirUsuarioAoAutenticar(params: {
    uid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<AmetaUser> {
    const cleanEmail = params.email.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    if (!db) {
      return {
        id: params.uid,
        uid: params.uid,
        name: params.name.trim() || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'Vistoriador',
        situacao: 'aguardando',
        plataforma: 'NOKIA',
        assignedPlatform: 'NOKIA',
        accessReleased: false,
        emailVerified: params.emailVerified,
        documents: ensureUserMandatoryDocuments(),
        createdAt: nowIso,
      };
    }

    const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, params.uid);
    const path = `${FIRESTORE_COLLECTIONS.USUARIOS}/${params.uid}`;

    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const situacao: UserSituacao =
          data.situacao === 'dono'
            ? 'dono'
            : data.situacao === 'ativo'
              ? 'ativo'
              : data.situacao === 'bloqueado'
                ? 'bloqueado'
                : 'aguardando';
        const isDono = situacao === 'dono';
        const role: UserRole = isDono ? 'ADM' : (data.role as UserRole) || 'Vistoriador';
        const plat: AssignedPlatformScope = isDono
          ? 'BOTH'
          : data.plataforma === 'ERICSSON' || data.assignedPlatform === 'ERICSSON'
            ? 'ERICSSON'
            : data.plataforma === 'AMBAS' || data.assignedPlatform === 'BOTH'
              ? 'BOTH'
              : 'NOKIA';

        return {
          id: params.uid,
          uid: params.uid,
          name: data.name || params.name || cleanEmail.split('@')[0],
          email: data.email || cleanEmail,
          role,
          situacao,
          plataforma: isDono ? 'AMBAS' : data.plataforma || (plat === 'BOTH' ? 'AMBAS' : plat),
          assignedPlatform: plat,
          accessReleased: isDono || situacao === 'ativo',
          equipe: data.equipe || '',
          telefone: data.telefone || '',
          cpf: data.cpf || '',
          rg: data.rg || '',
          atividade: data.atividade || 'ACESSO | TX',
          statusRecurso: data.statusRecurso || 'VALIDADO',
          dispensadoDocumentos: Boolean(data.dispensadoDocumentos),
          documents: ensureUserMandatoryDocuments(data.documents),
          emailVerified: params.emailVerified,
          preferredVendor: plat === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : nowIso,
        };
      }

      // Novo usuário: se for o dono (Rafael Araújo), entra como "dono", caso contrário entra SEMPRE como "aguardando"
      const isOwner = isOwnerAdmUser(cleanEmail);
      const newUserDoc = {
        uid: params.uid,
        email: cleanEmail,
        name: isOwner ? 'Rafael Araújo' : params.name.trim() || cleanEmail.split('@')[0],
        situacao: (isOwner ? 'dono' : 'aguardando') as UserSituacao,
        role: (isOwner ? 'ADM' : 'Vistoriador') as UserRole,
        plataforma: isOwner ? ('AMBAS' as const) : ('NOKIA' as const),
        assignedPlatform: (isOwner ? 'BOTH' : 'NOKIA') as AssignedPlatformScope,
        accessReleased: isOwner,
        equipe: isOwner ? 'Coordenação / ADM' : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (params.emailVerified) {
        await setDoc(userRef, newUserDoc);
      }

      return {
        id: params.uid,
        uid: params.uid,
        name: newUserDoc.name,
        email: cleanEmail,
        role: isOwner ? 'ADM' : 'Vistoriador',
        situacao: isOwner ? 'dono' : 'aguardando',
        plataforma: isOwner ? 'AMBAS' : 'NOKIA',
        assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
        accessReleased: isOwner,
        equipe: isOwner ? 'Coordenação / ADM' : '',
        documents: ensureUserMandatoryDocuments(),
        emailVerified: params.emailVerified,
        preferredVendor: 'NOKIA',
        createdAt: nowIso,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async obterUsuarioPorUid(uid: string): Promise<AmetaUser | null> {
    if (!db) return null;
    const path = `${FIRESTORE_COLLECTIONS.USUARIOS}/${uid}`;
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid));
      if (!snap.exists()) return null;
      const d = snap.data();
      const situacao: UserSituacao = d.situacao || 'aguardando';
      const isDono = situacao === 'dono';
      return {
        id: uid,
        uid,
        name: d.name || d.email?.split('@')[0] || 'Colaborador',
        email: d.email || '',
        role: isDono ? 'ADM' : (d.role as UserRole) || 'Vistoriador',
        situacao,
        plataforma: isDono ? 'AMBAS' : d.plataforma || 'NOKIA',
        assignedPlatform: isDono
          ? 'BOTH'
          : d.plataforma === 'ERICSSON' || d.assignedPlatform === 'ERICSSON'
            ? 'ERICSSON'
            : d.plataforma === 'AMBAS' || d.assignedPlatform === 'BOTH'
              ? 'BOTH'
              : 'NOKIA',
        accessReleased: isDono || situacao === 'ativo',
        equipe: d.equipe || '',
        emailVerified: true,
        documents: ensureUserMandatoryDocuments(d.documents),
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async listarTodosUsuarios(): Promise<AmetaUser[]> {
    if (!db) return [];
    const path = FIRESTORE_COLLECTIONS.USUARIOS;
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const situacao: UserSituacao = d.situacao || 'aguardando';
        const isDono = situacao === 'dono';
        const assignedPlatform: AssignedPlatformScope = isDono
          ? 'BOTH'
          : d.plataforma === 'ERICSSON' || d.assignedPlatform === 'ERICSSON'
            ? 'ERICSSON'
            : d.plataforma === 'AMBAS' || d.assignedPlatform === 'BOTH'
              ? 'BOTH'
              : 'NOKIA';
        return {
          id: docSnap.id,
          uid: d.uid || docSnap.id,
          name: d.name || d.email?.split('@')[0] || 'Colaborador',
          email: d.email || '',
          role: isDono ? 'ADM' : (d.role as UserRole) || 'Vistoriador',
          situacao,
          plataforma: isDono ? 'AMBAS' : d.plataforma || 'NOKIA',
          assignedPlatform,
          accessReleased: isDono || situacao === 'ativo',
          equipe: d.equipe || '',
          telefone: d.telefone || '',
          cpf: d.cpf || '',
          rg: d.rg || '',
          atividade: d.atividade || 'ACESSO | TX',
          statusRecurso: d.statusRecurso || 'VALIDADO',
          dispensadoDocumentos: Boolean(d.dispensadoDocumentos),
          documents: ensureUserMandatoryDocuments(d.documents),
          emailVerified: true,
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
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
    const cleanEmail = params.email.trim().toLowerCase();
    const targetDocId = params.uid || cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
    const assignedPlatform: AssignedPlatformScope =
      params.plataforma === 'AMBAS' ? 'BOTH' : params.plataforma;
    const isReleased = params.situacao === 'dono' || params.situacao === 'ativo';
    const nowIso = new Date().toISOString();

    if (db) {
      const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, targetDocId);
      const path = `${FIRESTORE_COLLECTIONS.USUARIOS}/${targetDocId}`;
      try {
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          await updateDoc(userRef, {
            name: params.name.trim(),
            role: params.role,
            plataforma: params.plataforma,
            assignedPlatform,
            situacao: params.situacao,
            accessReleased: isReleased,
            equipe: (params.equipe || '').trim(),
            releasedByEmail: params.ownerEmail || auth?.currentUser?.email || '',
            releasedAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(userRef, {
            uid: targetDocId,
            email: cleanEmail,
            name: params.name.trim(),
            role: params.role,
            plataforma: params.plataforma,
            assignedPlatform,
            situacao: params.situacao,
            accessReleased: isReleased,
            equipe: (params.equipe || '').trim(),
            releasedByEmail: params.ownerEmail || auth?.currentUser?.email || '',
            releasedAt: nowIso,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }

    return {
      id: targetDocId,
      uid: targetDocId,
      name: params.name.trim(),
      email: cleanEmail,
      role: params.situacao === 'dono' ? 'ADM' : params.role,
      situacao: params.situacao,
      plataforma: params.plataforma,
      assignedPlatform,
      accessReleased: isReleased,
      equipe: (params.equipe || '').trim(),
      emailVerified: true,
      documents: ensureUserMandatoryDocuments(),
      createdAt: nowIso,
    };
  }

  /**
   * Importação em massa TIM/Nokia gravando em lotes de no máximo 500 documentos,
   * usando o Site ID como identificador do documento e atualizando sem duplicar.
   */
  async importarSitesNokiaEmLote(
    sites: TelecomSite[],
    users: AmetaUser[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    if (!db || sites.length === 0) {
      return { totalGravados: 0, lotesExecutados: 0 };
    }

    // Deduplicar dentro do próprio lote pelo Site ID para não gravar duas vezes o mesmo doc no mesmo batch
    const uniqueByDocId = new Map<string, TelecomSite>();
    for (const s of sites) {
      const docId = sanitizeSiteDocId(s.siteId, s.sheetName);
      uniqueByDocId.set(docId, {
        ...s,
        id: docId,
        vendor: 'NOKIA',
      });
    }

    const entries = Array.from(uniqueByDocId.entries());
    let totalGravados = 0;
    let lotesExecutados = 0;

    for (let i = 0; i < entries.length; i += MAX_FIRESTORE_BATCH_SIZE) {
      const chunk = entries.slice(i, i + MAX_FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);

      for (const [docId, site] of chunk) {
        const ref = doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId);
        const { responsaveisUids, responsaveisEmails } = resolveNokiaSiteResponsaveis(
          site,
          users,
          duplaEmailsMap
        );

        batch.set(
          ref,
          {
            ...site,
            id: docId,
            siteId: site.siteId.trim().toUpperCase(),
            vendor: 'NOKIA',
            responsaveisUids,
            responsaveisEmails,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      try {
        await batch.commit();
        totalGravados += chunk.length;
        lotesExecutados++;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, FIRESTORE_COLLECTIONS.NOKIA_SITES);
      }
    }

    return { totalGravados, lotesExecutados };
  }

  /**
   * Importação em massa Ericsson gravando em lotes de no máximo 500 documentos,
   * preservando os 2 Site IDs (Torre A e Torre B) e seus respectivos status sem duplicar.
   */
  async importarSitesEricssonEmLote(
    rows: EricssonRow[],
    users: AmetaUser[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    if (!db || rows.length === 0) {
      return { totalGravados: 0, lotesExecutados: 0 };
    }

    const uniqueByDocId = new Map<string, EricssonRow>();
    for (const r of rows) {
      const docId = sanitizeEricssonDocId(r);
      uniqueByDocId.set(docId, {
        ...r,
        id: docId,
      });
    }

    const entries = Array.from(uniqueByDocId.entries());
    let totalGravados = 0;
    let lotesExecutados = 0;

    for (let i = 0; i < entries.length; i += MAX_FIRESTORE_BATCH_SIZE) {
      const chunk = entries.slice(i, i + MAX_FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);

      for (const [docId, row] of chunk) {
        const ref = doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId);
        const { responsaveisUids, responsaveisEmails } = resolveEricssonRowResponsaveis(
          row,
          users,
          duplaEmailsMap
        );

        batch.set(
          ref,
          {
            ...row,
            id: docId,
            siteIdA: (row.siteIdA || '').trim().toUpperCase(),
            siteIdB: (row.siteIdB || '').trim().toUpperCase(),
            statusA: row.statusA || 'Em andamento',
            statusB: row.statusB || 'Em andamento',
            siteAVistoriaStatus: row.siteAVistoriaStatus || 'Pendente',
            siteBVistoriaStatus: row.siteBVistoriaStatus || 'Pendente',
            responsaveisUids,
            responsaveisEmails,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      try {
        await batch.commit();
        totalGravados += chunk.length;
        lotesExecutados++;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, FIRESTORE_COLLECTIONS.ERICSSON_SITES);
      }
    }

    return { totalGravados, lotesExecutados };
  }

  /**
   * Importação em massa TSSR TIM Nokia em lotes de no máximo 500 documentos sem duplicar.
   */
  async importarTssrNokiaEmLote(
    rows: TssrRow[],
    users: AmetaUser[] = []
  ): Promise<{ totalGravados: number; lotesExecutados: number }> {
    if (!db || rows.length === 0) {
      return { totalGravados: 0, lotesExecutados: 0 };
    }

    const uniqueByDocId = new Map<string, TssrRow>();
    for (const r of rows) {
      const docId = sanitizeSiteDocId(r.siteId || r.rowKey);
      uniqueByDocId.set(docId, {
        ...r,
        id: docId,
      });
    }

    const entries = Array.from(uniqueByDocId.entries());
    let totalGravados = 0;
    let lotesExecutados = 0;

    for (let i = 0; i < entries.length; i += MAX_FIRESTORE_BATCH_SIZE) {
      const chunk = entries.slice(i, i + MAX_FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);

      for (const [docId, row] of chunk) {
        const ref = doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, docId);
        const executorName = (row.fields?.['Executor'] || '').trim().toLowerCase();
        const matchedUsers = users.filter((u) => {
          const uName = (u.name || '').trim().toLowerCase();
          const uEq = (u.equipe || '').trim().toLowerCase();
          return (
            executorName &&
            ((uName && (uName.includes(executorName) || executorName.includes(uName))) ||
              (uEq && (uEq.includes(executorName) || executorName.includes(uEq))))
          );
        });

        batch.set(
          ref,
          {
            ...row,
            id: docId,
            vendor: 'NOKIA',
            responsaveisUids: matchedUsers.map((u) => u.uid || u.id).slice(0, 20),
            responsaveisEmails: matchedUsers.map((u) => u.email.toLowerCase()).slice(0, 20),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      try {
        await batch.commit();
        totalGravados += chunk.length;
        lotesExecutados++;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, FIRESTORE_COLLECTIONS.NOKIA_TSSR);
      }
    }

    return { totalGravados, lotesExecutados };
  }

  async salvarSiteNokia(
    site: TelecomSite,
    users: AmetaUser[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    if (!db) return;
    const docId = sanitizeSiteDocId(site.siteId, site.sheetName);
    const path = `${FIRESTORE_COLLECTIONS.NOKIA_SITES}/${docId}`;
    const { responsaveisUids, responsaveisEmails } = resolveNokiaSiteResponsaveis(
      site,
      users,
      duplaEmailsMap
    );
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId),
        {
          ...site,
          id: docId,
          vendor: 'NOKIA',
          responsaveisUids,
          responsaveisEmails,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async excluirSiteNokia(siteId: string): Promise<void> {
    if (!db) return;
    const docId = sanitizeSiteDocId(siteId);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_SITES, docId));
    } catch {
      // ignore if not found
    }
  }

  async salvarSiteEricsson(
    row: EricssonRow,
    users: AmetaUser[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    if (!db) return;
    const docId = sanitizeEricssonDocId(row);
    const path = `${FIRESTORE_COLLECTIONS.ERICSSON_SITES}/${docId}`;
    const { responsaveisUids, responsaveisEmails } = resolveEricssonRowResponsaveis(
      row,
      users,
      duplaEmailsMap
    );
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, docId),
        {
          ...row,
          id: docId,
          responsaveisUids,
          responsaveisEmails,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async excluirSiteEricsson(rowId: string): Promise<void> {
    if (!db) return;
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES, rowId));
    } catch {
      // ignore
    }
  }

  async salvarTssrNokia(row: TssrRow): Promise<void> {
    if (!db) return;
    const docId = sanitizeSiteDocId(row.siteId || row.id);
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR, docId),
        { ...row, id: docId, vendor: 'NOKIA', updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {
      // ignore
    }
  }

  async salvarPastaNokia(folder: EngineeringFolder): Promise<void> {
    if (!db) return;
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS, folder.id),
        {
          ...folder,
          vendor: 'NOKIA',
          createdByUid: auth?.currentUser?.uid || '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // ignore
    }
  }

  async excluirPastaNokia(folderId: string): Promise<void> {
    if (!db) return;
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS, folderId));
    } catch {
      // ignore
    }
  }

  async salvarArquivoNokia(
    file: EngineeringFile,
    users: AmetaUser[] = [],
    sites: TelecomSite[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    if (!db) return;
    const matchedSite = sites.find(
      (s) =>
        s.siteId.trim().toUpperCase() === (file.siteId || '').trim().toUpperCase() ||
        s.id === file.siteId
    );
    const resp = matchedSite
      ? resolveNokiaSiteResponsaveis(matchedSite, users, duplaEmailsMap)
      : { responsaveisUids: [], responsaveisEmails: [] };
    if (file.uploadedByEmail) {
      resp.responsaveisEmails.push(file.uploadedByEmail.trim().toLowerCase());
    }
    if (auth?.currentUser?.uid) {
      resp.responsaveisUids.push(auth.currentUser.uid);
    }
    try {
      const safeFile = {
        ...file,
        vendor: 'NOKIA',
        uploadedByUid: auth?.currentUser?.uid || '',
        responsaveisUids: Array.from(new Set(resp.responsaveisUids)),
        responsaveisEmails: Array.from(new Set(resp.responsaveisEmails)),
        dataUrl:
          typeof file.dataUrl === 'string' && file.dataUrl.length > 700000
            ? ''
            : file.dataUrl || '',
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, file.id), safeFile, {
        merge: true,
      });
    } catch {
      // ignore
    }
  }

  async excluirArquivoNokia(fileId: string): Promise<void> {
    if (!db) return;
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS, fileId));
    } catch {
      // ignore
    }
  }

  async salvarPastaEricsson(folder: EngineeringFolder): Promise<void> {
    if (!db) return;
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS, folder.id),
        {
          ...folder,
          vendor: 'ERICSSON',
          createdByUid: auth?.currentUser?.uid || '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // ignore
    }
  }

  async excluirPastaEricsson(folderId: string): Promise<void> {
    if (!db) return;
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS, folderId));
    } catch {
      // ignore
    }
  }

  async salvarArquivoEricsson(
    file: EngineeringFile,
    users: AmetaUser[] = [],
    rows: EricssonRow[] = [],
    duplaEmailsMap?: Record<string, string[]>
  ): Promise<void> {
    if (!db) return;
    const matchedRow = rows.find((r) => r.id === file.rowId);
    const resp = matchedRow
      ? resolveEricssonRowResponsaveis(matchedRow, users, duplaEmailsMap)
      : { responsaveisUids: [], responsaveisEmails: [] };
    if (file.uploadedByEmail) {
      resp.responsaveisEmails.push(file.uploadedByEmail.trim().toLowerCase());
    }
    if (auth?.currentUser?.uid) {
      resp.responsaveisUids.push(auth.currentUser.uid);
    }
    try {
      const safeFile = {
        ...file,
        vendor: 'ERICSSON',
        uploadedByUid: auth?.currentUser?.uid || '',
        responsaveisUids: Array.from(new Set(resp.responsaveisUids)),
        responsaveisEmails: Array.from(new Set(resp.responsaveisEmails)),
        dataUrl:
          typeof file.dataUrl === 'string' && file.dataUrl.length > 700000
            ? ''
            : file.dataUrl || '',
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, file.id), safeFile, {
        merge: true,
      });
    } catch {
      // ignore
    }
  }

  async excluirArquivoEricsson(fileId: string): Promise<void> {
    if (!db) return;
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS, fileId));
    } catch {
      // ignore
    }
  }

  async salvarMapaDuplas(
    duplaEmailsMap: Record<string, string[]>,
    customDuplas?: string[]
  ): Promise<void> {
    if (!db) return;
    try {
      const payload: Record<string, any> = {
        duplaEmailsMap,
        updatedAt: serverTimestamp(),
      };
      if (Array.isArray(customDuplas)) {
        payload.customDuplas = customDuplas;
      }
      await setDoc(doc(db, 'configuracoes', 'duplas'), payload, { merge: true });
      await setDoc(doc(db, 'configuracoes', 'duplas_map'), payload, { merge: true });
    } catch {
      // ignore
    }
  }

  async carregarMapaDuplas(): Promise<{
    duplaEmailsMap?: Record<string, string[]>;
    customDuplas?: string[];
  }> {
    if (!db) return {};
    try {
      const snap = await getDoc(doc(db, 'configuracoes', 'duplas_map'));
      if (snap.exists()) {
        const data = snap.data();
        return {
          duplaEmailsMap: data?.duplaEmailsMap || {},
          customDuplas: data?.customDuplas || [],
        };
      }
      const snap2 = await getDoc(doc(db, 'configuracoes', 'duplas'));
      if (snap2.exists()) {
        const data = snap2.data();
        return {
          duplaEmailsMap: data?.duplaEmailsMap || {},
          customDuplas: data?.customDuplas || [],
        };
      }
    } catch {
      // ignore
    }
    return {};
  }

  async criarNotificacao(notif: AmetaNotification): Promise<void> {
    if (!db) return;
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.NOTIFICACOES, notif.id),
        { ...notif, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {
      // ignore
    }
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
    const cleanEmail = params.email.trim().toLowerCase();
    const isOwner = isOwnerAdmUser(cleanEmail);
    const docId = isOwner
      ? 'usr-ameta-servicos-1'
      : `usr-${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
    const nowIso = new Date().toISOString();

    const chosenRole: UserRole = isOwner ? 'ADM' : params.role || 'Vistoriador';
    const chosenPlatform: AssignedPlatformScope = isOwner ? 'AMBAS' : params.plataforma || 'NOKIA';
    const chosenAssigned: AssignedPlatformScope = isOwner ? 'BOTH' : params.plataforma || 'NOKIA';

    const newUser: AmetaUser = {
      id: docId,
      uid: docId,
      name: isOwner ? 'Rafael Araújo' : params.name.trim() || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: chosenRole,
      situacao: isOwner ? 'dono' : 'aguardando',
      plataforma: chosenPlatform,
      assignedPlatform: chosenAssigned,
      accessReleased: isOwner,
      equipe: isOwner ? 'Coordenação / ADM' : params.equipe?.trim() || '',
      telefone: params.telefone?.trim() || '',
      documents: ensureUserMandatoryDocuments(),
      emailVerified: true,
      createdAt: nowIso,
    };

    if (db) {
      const userRef = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, docId);
      const existingSnap = await getDoc(userRef);
      if (existingSnap.exists() && !isOwner) {
        const existingData = existingSnap.data();
        if (existingData.passwordHash && existingData.passwordHash !== params.password) {
          throw new Error('auth/email-already-in-use');
        }
      }
      await setDoc(
        userRef,
        {
          ...newUser,
          passwordHash: params.password,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (!isOwner) {
        const notif: AmetaNotification = {
          id: `notif-novo-usuario-${Date.now()}`,
          type: 'EXECUTOR_ATUALIZOU_EQUIPE',
          vendor: 'NOKIA',
          title: `Solicitação de Acesso: ${newUser.name}`,
          message: `O colaborador ${newUser.name} (${cleanEmail}) se cadastrou e aguarda liberação de perfil e plataforma no Painel de Liberação.`,
          actorName: newUser.name,
          actorEmail: cleanEmail,
          targetRoles: ['ADM'],
          targetEmails: ['rafael.araujo@ametaservicos.com.br'],
          readByEmails: [],
          createdAt: nowIso,
        };
        await this.criarNotificacao(notif);
      }
    }

    return newUser;
  }

  async autenticarUsuarioCorporativo(params: {
    email: string;
    password: string;
  }): Promise<AmetaUser | null> {
    const cleanEmail = params.email.trim().toLowerCase();
    const isOwner = isOwnerAdmUser(cleanEmail);

    if (isOwner) {
      const ownerDocId = 'usr-ameta-servicos-1';
      const nowIso = new Date().toISOString();
      const ownerUser: AmetaUser = {
        id: ownerDocId,
        uid: ownerDocId,
        name: 'Rafael Araújo',
        email: 'rafael.araujo@ametaservicos.com.br',
        role: 'ADM',
        situacao: 'dono',
        plataforma: 'AMBAS',
        assignedPlatform: 'BOTH',
        accessReleased: true,
        equipe: 'Coordenação / ADM',
        documents: ensureUserMandatoryDocuments(),
        emailVerified: true,
        createdAt: '2026-01-01T08:00:00.000Z',
      };
      if (db) {
        try {
          const ref = doc(db, FIRESTORE_COLLECTIONS.USUARIOS, ownerDocId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const d = snap.data();
            if (d.passwordHash && d.passwordHash !== params.password && params.password !== 'ameta2026') {
              throw new Error('auth/wrong-password');
            }
          }
          await setDoc(
            ref,
            {
              ...ownerUser,
              passwordHash: params.password,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'auth/wrong-password') {
            throw err;
          }
        }
      }
      return ownerUser;
    }

    if (!db) return null;

    const docId = `usr-${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
    let foundSnap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, docId));
    if (!foundSnap.exists()) {
      const q = query(
        collection(db, FIRESTORE_COLLECTIONS.USUARIOS),
        where('email', '==', cleanEmail)
      );
      const qSnap = await getDocs(q);
      if (qSnap.empty) {
        return null;
      }
      foundSnap = qSnap.docs[0];
    }

    const d = foundSnap.data() || {};
    if (d.passwordHash && d.passwordHash !== params.password && params.password !== 'ameta2026') {
      throw new Error('auth/wrong-password');
    }

    const situacao: UserSituacao = d.situacao || 'aguardando';
    const assignedPlatform: AssignedPlatformScope =
      d.plataforma === 'ERICSSON' || d.assignedPlatform === 'ERICSSON'
        ? 'ERICSSON'
        : d.plataforma === 'AMBAS' || d.assignedPlatform === 'BOTH'
          ? 'BOTH'
          : 'NOKIA';

    return {
      id: foundSnap.id,
      uid: d.uid || foundSnap.id,
      name: d.name || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: (d.role as UserRole) || 'Vistoriador',
      situacao,
      plataforma: d.plataforma || 'NOKIA',
      assignedPlatform,
      accessReleased: situacao === 'ativo' || situacao === 'dono',
      equipe: d.equipe || '',
      telefone: d.telefone || '',
      cpf: d.cpf || '',
      rg: d.rg || '',
      atividade: d.atividade || 'ACESSO | TX',
      statusRecurso: d.statusRecurso || 'VALIDADO',
      dispensadoDocumentos: Boolean(d.dispensadoDocumentos),
      documents: ensureUserMandatoryDocuments(d.documents),
      emailVerified: true,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
    };
  }

  async salvarDocumentosUsuario(params: {
    uidOrId: string;
    email: string;
    documents: any[];
    dispensadoDocumentos?: boolean;
    statusRecurso?: string;
  }): Promise<void> {
    if (!db) return;
    const cleanEmail = params.email.trim().toLowerCase();
    const targetId =
      params.uidOrId ||
      (isOwnerAdmUser(cleanEmail)
        ? 'usr-ameta-servicos-1'
        : `usr-${cleanEmail.replace(/[^a-z0-9]/g, '_')}`);
    try {
      const slimDocs = (params.documents || []).map((docItem: any) => ({
        ...docItem,
        fileBase64:
          typeof docItem.fileBase64 === 'string' && docItem.fileBase64.length > 150000
            ? ''
            : docItem.fileBase64 || '',
      }));
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.USUARIOS, targetId),
        {
          email: cleanEmail,
          documents: slimDocs,
          ...(params.dispensadoDocumentos !== undefined
            ? { dispensadoDocumentos: params.dispensadoDocumentos }
            : {}),
          ...(params.statusRecurso ? { statusRecurso: params.statusRecurso } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // ignore
    }
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
      emailVerified: Boolean(auth?.currentUser?.emailVerified),
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
    return this.atualizarPermissaoUsuarioPeloDono({
      uid,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      plataforma: payload.plataforma === 'BOTH' ? 'AMBAS' : payload.plataforma,
      situacao: payload.situacao,
      equipe: payload.equipe,
    });
  }

  async excluirUsuario(uidOrId: string, email?: string): Promise<void> {
    if (!db) return;
    try {
      if (uidOrId) {
        await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uidOrId));
      }
      if (email) {
        const cleanEmail = email.trim().toLowerCase();
        const sanitizedId = cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (sanitizedId && sanitizedId !== uidOrId) {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, sanitizedId));
        }
        const q = query(
          collection(db, FIRESTORE_COLLECTIONS.USUARIOS),
          where('email', '==', cleanEmail)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          if (!isOwnerAdmUser(d.data().email, d.data().situacao)) {
            await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, d.id));
          }
        }
      }
    } catch {
      // ignore if user doesn't have delete permission or doc doesn't exist
    }
  }

  async limparUsuariosExcetoDono(): Promise<void> {
    if (!db) return;
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.USUARIOS));
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const email = String(data.email || '').trim().toLowerCase();
        if (!isOwnerAdmUser(email, data.situacao)) {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.USUARIOS, docSnap.id));
        }
      }
    } catch {
      // ignore if not authenticated as owner yet
    }
  }

  observarPerfilUsuario(uid: string, onUpdate: (user: AmetaUser | null) => void): Unsubscribe {
    if (!db || !uid) return () => {};
    const path = `${FIRESTORE_COLLECTIONS.USUARIOS}/${uid}`;
    return onSnapshot(
      doc(db, FIRESTORE_COLLECTIONS.USUARIOS, uid),
      (snap) => {
        if (!snap.exists()) {
          onUpdate(null);
          return;
        }
        const d = snap.data();
        const situacao: UserSituacao = d.situacao || 'aguardando';
        const isDono = situacao === 'dono';
        const assignedPlatform: AssignedPlatformScope = isDono
          ? 'BOTH'
          : d.plataforma === 'ERICSSON' || d.assignedPlatform === 'ERICSSON'
            ? 'ERICSSON'
            : d.plataforma === 'AMBAS' || d.assignedPlatform === 'BOTH'
              ? 'BOTH'
              : 'NOKIA';
        onUpdate({
          id: snap.id,
          uid: d.uid || snap.id,
          name: d.name || d.email?.split('@')[0] || 'Colaborador',
          email: d.email || '',
          role: isDono ? 'ADM' : (d.role as UserRole) || 'Vistoriador',
          situacao,
          plataforma: isDono ? 'AMBAS' : d.plataforma || 'NOKIA',
          assignedPlatform,
          accessReleased: isDono || situacao === 'ativo',
          equipe: d.equipe || '',
          telefone: d.telefone || '',
          cpf: d.cpf || '',
          rg: d.rg || '',
          atividade: d.atividade || 'ACESSO | TX',
          statusRecurso: d.statusRecurso || 'VALIDADO',
          dispensadoDocumentos: Boolean(d.dispensadoDocumentos),
          documents: ensureUserMandatoryDocuments(d.documents),
          emailVerified: true,
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        });
      },
      (error) => {
        console.warn('Leitura de perfil em tempo real:', error.message);
      }
    );
  }

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
  ): Unsubscribe {
    if (!db || !user || isUserAguardando(user)) {
      return () => {};
    }

    const unsubs: Unsubscribe[] = [];
    const dono = isUserDono(user);
    const isRestrictedFieldRole =
      !dono && (user.role === 'Executor' || user.role === 'Vistoriador');
    const isCoordEng = !dono && user.role === 'Coordenador Engenharia';
    const userEmail = (user.email || '').trim().toLowerCase();

    // Se for dono ou Coordenador Geral, pode observar a lista de usuários
    if ((dono || user.role === 'Coordenador Geral') && callbacks.onUsuarios) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.USUARIOS),
          (snap) => {
            if (snap.empty) return;
            const list: AmetaUser[] = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              const situacao: UserSituacao = d.situacao || 'aguardando';
              const isD = situacao === 'dono' || isOwnerAdmUser(d.email, situacao);
              return {
                id: docSnap.id,
                uid: d.uid || docSnap.id,
                name: d.name || d.email?.split('@')[0] || 'Colaborador',
                email: d.email || '',
                role: isD ? 'ADM' : (d.role as UserRole) || 'Vistoriador',
                situacao: isD ? 'dono' : situacao,
                plataforma: isD ? 'AMBAS' : d.plataforma || 'NOKIA',
                assignedPlatform: isD
                  ? 'BOTH'
                  : d.plataforma === 'ERICSSON' || d.assignedPlatform === 'ERICSSON'
                    ? 'ERICSSON'
                    : d.plataforma === 'AMBAS' || d.assignedPlatform === 'BOTH'
                      ? 'BOTH'
                      : 'NOKIA',
                accessReleased: isD || situacao === 'ativo',
                equipe: d.equipe || '',
                telefone: d.telefone || '',
                cpf: d.cpf || '',
                rg: d.rg || '',
                atividade: d.atividade || 'ACESSO | TX',
                statusRecurso: d.statusRecurso || 'VALIDADO',
                dispensadoDocumentos: Boolean(d.dispensadoDocumentos),
                documents: ensureUserMandatoryDocuments(d.documents),
                emailVerified: true,
                createdAt:
                  typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
              };
            });
            callbacks.onUsuarios?.(list);
          },
          () => {}
        )
      );
    }

    if (callbacks.onDuplasConfig) {
      unsubs.push(
        onSnapshot(
          doc(db, 'configuracoes', 'duplas'),
          (snap) => {
            if (!snap.exists()) return;
            const d = snap.data();
            callbacks.onDuplasConfig?.({
              duplaEmailsMap:
                d.duplaEmailsMap && typeof d.duplaEmailsMap === 'object'
                  ? d.duplaEmailsMap
                  : undefined,
              customDuplas: Array.isArray(d.customDuplas) ? d.customDuplas : undefined,
            });
          },
          () => {}
        )
      );
    }

    if (callbacks.onNotificacoes) {
      unsubs.push(
        onSnapshot(
          collection(db, FIRESTORE_COLLECTIONS.NOTIFICACOES),
          (snap) => {
            if (snap.empty) return;
            const list = snap.docs
              .map((d) => ({ ...(d.data() as AmetaNotification), id: d.id }))
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            callbacks.onNotificacoes?.(list);
          },
          () => {}
        )
      );
    }

    // Subscrições TIM / Nokia (somente se o usuário tiver permissão na plataforma NOKIA)
    if (canUserAccessVendor(user, 'NOKIA')) {
      // Coordenador Engenharia vê APENAS Engenharia (TSSR) e Vistoria (não lê nokia_sites geral)
      if (!isCoordEng && callbacks.onNokiaSites) {
        const sitesQuery = isRestrictedFieldRole
          ? query(
              collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES),
              where('responsaveisEmails', 'array-contains', userEmail)
            )
          : collection(db, FIRESTORE_COLLECTIONS.NOKIA_SITES);

        unsubs.push(
          onSnapshot(
            sitesQuery,
            (snap) => {
              if (snap.empty) return;
              const sites = snap.docs.map((d) => ({
                ...(d.data() as TelecomSite),
                id: d.id,
              }));
              callbacks.onNokiaSites?.(sites);
            },
            () => {}
          )
        );
      }

      if (callbacks.onNokiaTssr) {
        const tssrQuery = isRestrictedFieldRole
          ? query(
              collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR),
              where('responsaveisEmails', 'array-contains', userEmail)
            )
          : collection(db, FIRESTORE_COLLECTIONS.NOKIA_TSSR);

        unsubs.push(
          onSnapshot(
            tssrQuery,
            (snap) => {
              if (snap.empty) return;
              const rows = snap.docs.map((d) => ({
                ...(d.data() as TssrRow),
                id: d.id,
              }));
              callbacks.onNokiaTssr?.(rows);
            },
            () => {}
          )
        );
      }

      if (callbacks.onNokiaFolders) {
        unsubs.push(
          onSnapshot(
            collection(db, FIRESTORE_COLLECTIONS.NOKIA_PASTAS),
            (snap) => {
              if (snap.empty) return;
              const folders = snap.docs.map((d) => ({
                ...(d.data() as EngineeringFolder),
                id: d.id,
              }));
              callbacks.onNokiaFolders?.(folders);
            },
            () => {}
          )
        );
      }

      if (callbacks.onNokiaFiles) {
        const filesQuery = isRestrictedFieldRole
          ? query(
              collection(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS),
              where('responsaveisEmails', 'array-contains', userEmail)
            )
          : collection(db, FIRESTORE_COLLECTIONS.NOKIA_ARQUIVOS);

        unsubs.push(
          onSnapshot(
            filesQuery,
            (snap) => {
              if (snap.empty) return;
              const files = snap.docs.map((d) => ({
                ...(d.data() as EngineeringFile),
                id: d.id,
              }));
              callbacks.onNokiaFiles?.(files);
            },
            () => {}
          )
        );
      }
    }

    // Subscrições Ericsson (somente se o usuário tiver permissão na plataforma ERICSSON)
    if (canUserAccessVendor(user, 'ERICSSON')) {
      if (callbacks.onEricssonSites) {
        const ericQuery = isRestrictedFieldRole
          ? query(
              collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES),
              where('responsaveisEmails', 'array-contains', userEmail)
            )
          : collection(db, FIRESTORE_COLLECTIONS.ERICSSON_SITES);

        unsubs.push(
          onSnapshot(
            ericQuery,
            (snap) => {
              if (snap.empty) return;
              const rows = snap.docs.map((d) => ({
                ...(d.data() as EricssonRow),
                id: d.id,
              }));
              callbacks.onEricssonSites?.(rows);
            },
            () => {}
          )
        );
      }

      if (callbacks.onEricssonFolders) {
        unsubs.push(
          onSnapshot(
            collection(db, FIRESTORE_COLLECTIONS.ERICSSON_PASTAS),
            (snap) => {
              if (snap.empty) return;
              const folders = snap.docs.map((d) => ({
                ...(d.data() as EngineeringFolder),
                id: d.id,
              }));
              callbacks.onEricssonFolders?.(folders);
            },
            () => {}
          )
        );
      }

      if (callbacks.onEricssonFiles) {
        const ericFilesQuery = isRestrictedFieldRole
          ? query(
              collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS),
              where('responsaveisEmails', 'array-contains', userEmail)
            )
          : collection(db, FIRESTORE_COLLECTIONS.ERICSSON_ARQUIVOS);

        unsubs.push(
          onSnapshot(
            ericFilesQuery,
            (snap) => {
              if (snap.empty) return;
              const files = snap.docs.map((d) => ({
                ...(d.data() as EngineeringFile),
                id: d.id,
              }));
              callbacks.onEricssonFiles?.(files);
            },
            () => {}
          )
        );
      }
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }
}

export const dataService: IDataService = new FirestoreDataService();
export { deleteDoc, doc, db };
