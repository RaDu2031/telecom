import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocFromServer,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AmetaUser,
  UserRole,
  AssignedPlatformScope,
  normalizeUserRole,
  isOwnerAdmUser,
  ensureUserMandatoryDocuments,
} from '../types/telecom';

// Initialize Firebase App, Firestore, and Auth using provisioned configuration
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Mandatory Error Handling Specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: boolean | string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on application boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Validation constants verbatim from firebase-blueprint.json
const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LENGTH = 128;
const MAX_DATA_JSON_LENGTH = 900000;

function isValidChunkId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && ID_REGEX.test(id);
}

type SnapshotPayloadType =
  | 'USERS'
  | 'DUPLAS'
  | 'NOTIFICATIONS'
  | 'FOLDERS'
  | 'FILES'
  | 'SITES_META';

type SnapshotVendor = 'NOKIA' | 'ERICSSON' | 'SHARED';

interface ChunkMapping {
  chunkId: string;
  vendor: SnapshotVendor;
  payloadType: SnapshotPayloadType;
  extract: (state: Record<string, any>) => Record<string, any>;
}

const CHUNK_MAPPINGS: ChunkMapping[] = [
  {
    chunkId: 'chunk_users_all',
    vendor: 'SHARED',
    payloadType: 'USERS',
    extract: (st) => ({
      users: Array.isArray(st.users) ? st.users : [],
      ericssonUsers: Array.isArray(st.ericssonUsers) ? st.ericssonUsers : [],
    }),
  },
  {
    chunkId: 'chunk_duplas_all',
    vendor: 'SHARED',
    payloadType: 'DUPLAS',
    extract: (st) => ({
      duplaEmailsMap: st.duplaEmailsMap || {},
    }),
  },
  {
    chunkId: 'chunk_notifications_all',
    vendor: 'SHARED',
    payloadType: 'NOTIFICATIONS',
    extract: (st) => ({
      notifications: Array.isArray(st.notifications) ? st.notifications.slice(0, 200) : [],
    }),
  },
  {
    chunkId: 'chunk_folders_all',
    vendor: 'SHARED',
    payloadType: 'FOLDERS',
    extract: (st) => ({
      engineeringFolders: Array.isArray(st.engineeringFolders) ? st.engineeringFolders : [],
      ericssonFolders: Array.isArray(st.ericssonFolders) ? st.ericssonFolders : [],
    }),
  },
  {
    chunkId: 'chunk_files_meta',
    vendor: 'SHARED',
    payloadType: 'FILES',
    extract: (st) => ({
      engineeringFiles: Array.isArray(st.engineeringFiles)
        ? st.engineeringFiles.map((f: any) => ({
            ...f,
            dataUrl:
              typeof f.dataUrl === 'string' && f.dataUrl.length > 35000 ? '' : f.dataUrl || '',
          }))
        : [],
      ericssonFiles: Array.isArray(st.ericssonFiles)
        ? st.ericssonFiles.map((f: any) => ({
            ...f,
            dataUrl:
              typeof f.dataUrl === 'string' && f.dataUrl.length > 35000 ? '' : f.dataUrl || '',
          }))
        : [],
    }),
  },
  {
    chunkId: 'chunk_sites_meta',
    vendor: 'SHARED',
    payloadType: 'SITES_META',
    extract: (st) => {
      const nokiaSiteOverrides: Record<string, any> = {};
      if (Array.isArray(st.sites)) {
        for (const s of st.sites) {
          if (s && s.id && (s.equipeParceira || s.responsavelCampo || s.dataAtivacao || s.status)) {
            nokiaSiteOverrides[s.id] = {
              equipeParceira: s.equipeParceira || '',
              responsavelCampo: s.responsavelCampo || '',
              status: s.status || '',
              dataAtivacao: s.dataAtivacao || '',
              equipeExecCol: s.customFields?.['EQUIPE EXECUTANTE'] || '',
              emailDuplaCol: s.customFields?.['E-MAIL DUPLA'] || '',
              statusCol: s.customFields?.['STATUS'] || '',
              siExecCol: s.customFields?.['SI Executed'] || '',
            };
          }
        }
      }

      const ericssonRowOverrides: Record<string, any> = {};
      if (Array.isArray(st.ericssonRows)) {
        for (const r of st.ericssonRows) {
          if (
            r &&
            r.id &&
            (r.equipe ||
              r.siteAVistoriaStatus !== 'Pendente' ||
              r.siteBVistoriaStatus !== 'Pendente' ||
              r.losStatus === 'Entregue')
          ) {
            ericssonRowOverrides[r.id] = {
              equipe: r.equipe || '',
              emailDupla: r.fields?.['E-MAIL DUPLA'] || '',
              siteAVistoriaStatus: r.siteAVistoriaStatus,
              siteAVistoriaFileId: r.siteAVistoriaFileId,
              siteAVistoriaFileName: r.siteAVistoriaFileName,
              siteAVistoriaFolderId: r.siteAVistoriaFolderId,
              siteBVistoriaStatus: r.siteBVistoriaStatus,
              siteBVistoriaFileId: r.siteBVistoriaFileId,
              siteBVistoriaFileName: r.siteBVistoriaFileName,
              siteBVistoriaFolderId: r.siteBVistoriaFolderId,
              losStatus: r.losStatus,
              losFileId: r.losFileId,
              losFileName: r.losFileName,
              losFolderId: r.losFolderId,
            };
          }
        }
      }

      const tssrRowOverrides: Record<string, any> = {};
      if (Array.isArray(st.tssrRows)) {
        for (const r of st.tssrRows) {
          if (r && r.id && (r.vistoriaStatus === 'Finalizado' || r.arquivoVistoriaFileName)) {
            tssrRowOverrides[r.id] = {
              vistoriaStatus: r.vistoriaStatus,
              arquivoVistoriaFileId: r.arquivoVistoriaFileId,
              arquivoVistoriaFileName: r.arquivoVistoriaFileName,
              arquivoVistoriaFolderId: r.arquivoVistoriaFolderId,
              arquivoVistoriaUploadedAt: r.arquivoVistoriaUploadedAt,
              arquivoVistoriaUploadedBy: r.arquivoVistoriaUploadedBy,
            };
          }
        }
      }

      return {
        nokiaSiteOverrides,
        ericssonRowOverrides,
        tssrRowOverrides,
      };
    },
  },
];

function applyChunkPayloadToState(targetState: Record<string, any>, parsed: Record<string, any>) {
  if (!parsed || typeof parsed !== 'object') return;

  if (
    parsed.nokiaSiteOverrides ||
    parsed.ericssonRowOverrides ||
    parsed.tssrRowOverrides
  ) {
    if (parsed.nokiaSiteOverrides && Array.isArray(targetState.sites)) {
      targetState.sites = targetState.sites.map((s: any) => {
        const ov = parsed.nokiaSiteOverrides[s.id];
        if (!ov) return s;
        return {
          ...s,
          equipeParceira: ov.equipeParceira ?? s.equipeParceira,
          responsavelCampo: ov.responsavelCampo ?? s.responsavelCampo,
          status: ov.status || s.status,
          dataAtivacao: ov.dataAtivacao ?? s.dataAtivacao,
          customFields: {
            ...(s.customFields || {}),
            'EQUIPE EXECUTANTE': ov.equipeExecCol ?? s.customFields?.['EQUIPE EXECUTANTE'] ?? '',
            'E-MAIL DUPLA': ov.emailDuplaCol ?? s.customFields?.['E-MAIL DUPLA'] ?? '',
            ...(ov.statusCol ? { STATUS: ov.statusCol } : {}),
            ...(ov.siExecCol ? { 'SI Executed': ov.siExecCol } : {}),
          },
        };
      });
    }
    if (parsed.ericssonRowOverrides && Array.isArray(targetState.ericssonRows)) {
      targetState.ericssonRows = targetState.ericssonRows.map((r: any) => {
        const ov = parsed.ericssonRowOverrides[r.id];
        if (!ov) return r;
        return {
          ...r,
          equipe: ov.equipe ?? r.equipe,
          siteAVistoriaStatus: ov.siteAVistoriaStatus ?? r.siteAVistoriaStatus,
          siteAVistoriaFileId: ov.siteAVistoriaFileId ?? r.siteAVistoriaFileId,
          siteAVistoriaFileName: ov.siteAVistoriaFileName ?? r.siteAVistoriaFileName,
          siteAVistoriaFolderId: ov.siteAVistoriaFolderId ?? r.siteAVistoriaFolderId,
          siteBVistoriaStatus: ov.siteBVistoriaStatus ?? r.siteBVistoriaStatus,
          siteBVistoriaFileId: ov.siteBVistoriaFileId ?? r.siteBVistoriaFileId,
          siteBVistoriaFileName: ov.siteBVistoriaFileName ?? r.siteBVistoriaFileName,
          siteBVistoriaFolderId: ov.siteBVistoriaFolderId ?? r.siteBVistoriaFolderId,
          losStatus: ov.losStatus ?? r.losStatus,
          losFileId: ov.losFileId ?? r.losFileId,
          losFileName: ov.losFileName ?? r.losFileName,
          losFolderId: ov.losFolderId ?? r.losFolderId,
          fields: {
            ...(r.fields || {}),
            EQUIPE: ov.equipe ?? r.fields?.['EQUIPE'] ?? '',
            'E-MAIL DUPLA': ov.emailDupla ?? r.fields?.['E-MAIL DUPLA'] ?? '',
          },
        };
      });
    }
    if (parsed.tssrRowOverrides && Array.isArray(targetState.tssrRows)) {
      targetState.tssrRows = targetState.tssrRows.map((r: any) => {
        const ov = parsed.tssrRowOverrides[r.id];
        if (!ov) return r;
        return {
          ...r,
          ...ov,
        };
      });
    }
    return;
  }

  Object.assign(targetState, parsed);
}

const LOCAL_STORAGE_DB_KEY = 'ameta_cloud_serverless_db_v2';
let cachedDbState: Record<string, any> | null = null;
let backendAvailable: boolean | null = null;

const originalFetch = window.fetch.bind(window);

async function ensureLocalDbState(): Promise<Record<string, any>> {
  if (cachedDbState) return cachedDbState;

  try {
    const rawLocal = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sites) && parsed.sites.length > 0) {
        cachedDbState = parsed;
      }
    }
  } catch {
    // ignore storage read error
  }

  if (!cachedDbState) {
    try {
      const res = await originalFetch('/initial-db.json');
      if (res.ok) {
        const seed = await res.json();
        cachedDbState = seed;
      }
    } catch {
      // ignore
    }
  }

  if (!cachedDbState) {
    cachedDbState = {
      users: [],
      ericssonUsers: [],
      sites: [],
      sheets: [],
      duplaEmailsMap: {},
      tssrRows: [],
      tssrSheets: [],
      engineeringFolders: [],
      engineeringFiles: [],
      ericssonRows: [],
      ericssonSheetMeta: null,
      ericssonFolders: [],
      ericssonFiles: [],
      notifications: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  await pullWorkspaceFromFirestore(cachedDbState);
  saveLocalDbState(cachedDbState);
  return cachedDbState;
}

function saveLocalDbState(state: Record<string, any>) {
  state.lastUpdated = new Date().toISOString();
  cachedDbState = state;
  try {
    const slim = {
      ...state,
      engineeringFiles: (state.engineeringFiles || []).map((f: any) => ({
        ...f,
        dataUrl: typeof f.dataUrl === 'string' && f.dataUrl.length > 25000 ? '' : f.dataUrl || '',
      })),
      ericssonFiles: (state.ericssonFiles || []).map((f: any) => ({
        ...f,
        dataUrl: typeof f.dataUrl === 'string' && f.dataUrl.length > 25000 ? '' : f.dataUrl || '',
      })),
    };
    localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(slim));
  } catch {
    // ignore quota error
  }
}

export async function pushWorkspaceToFirestore(state: Record<string, any>): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified || !currentUser.email) {
    return;
  }

  for (const mapping of CHUNK_MAPPINGS) {
    if (!isValidChunkId(mapping.chunkId)) continue;
    const extracted = mapping.extract(state);
    let dataJson = JSON.stringify(extracted);
    if (dataJson.length > MAX_DATA_JSON_LENGTH) {
      continue;
    }

    const path = `workspace_snapshots/${mapping.chunkId}`;
    const docRef = doc(db, 'workspace_snapshots', mapping.chunkId);

    try {
      const existingSnap = await getDoc(docRef);
      if (!existingSnap.exists()) {
        await setDoc(docRef, {
          chunkId: mapping.chunkId,
          vendor: mapping.vendor,
          payloadType: mapping.payloadType,
          dataJson,
          authorUid: currentUser.uid,
          authorEmail: currentUser.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const existingData = existingSnap.data();
        await updateDoc(docRef, {
          chunkId: mapping.chunkId,
          vendor: existingData.vendor || mapping.vendor,
          payloadType: existingData.payloadType || mapping.payloadType,
          dataJson,
          authorUid: currentUser.uid,
          authorEmail: currentUser.email,
          createdAt: existingData.createdAt,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }
  }
}

export async function pullWorkspaceFromFirestore(
  targetState: Record<string, any>
): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return false;
  }

  let updatedAny = false;
  for (const mapping of CHUNK_MAPPINGS) {
    const path = `workspace_snapshots/${mapping.chunkId}`;
    try {
      const snap = await getDoc(doc(db, 'workspace_snapshots', mapping.chunkId));
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.dataJson === 'string' && data.dataJson.length >= 2) {
          const parsed = JSON.parse(data.dataJson);
          applyChunkPayloadToState(targetState, parsed);
          updatedAny = true;
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  }
  return updatedAny;
}

export async function signInWithGoogleFirebase(): Promise<{
  firebaseUser: FirebaseUser;
  ametaUser: AmetaUser;
}> {
  const cred = await signInWithPopup(auth, googleProvider);
  const fbUser = cred.user;
  const email = (fbUser.email || '').trim().toLowerCase();

  // If bootstrapped owner, ensure admin entry in /admins/{uid}
  if (email === 'rafael.araujo0797@gmail.com' && fbUser.emailVerified) {
    const adminPath = `admins/${fbUser.uid}`;
    try {
      const adminRef = doc(db, 'admins', fbUser.uid);
      const snap = await getDoc(adminRef);
      if (!snap.exists()) {
        await setDoc(adminRef, {
          uid: fbUser.uid,
          email,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        handleFirestoreError(err, OperationType.CREATE, adminPath);
      }
    }
  }

  const state = await ensureLocalDbState();
  const existingUsers: AmetaUser[] = Array.isArray(state.users) ? state.users : [];
  let matched = existingUsers.find((u) => u.email.trim().toLowerCase() === email);

  if (!matched) {
    const isOwner = isOwnerAdmUser(email) || email === 'rafael.araujo0797@gmail.com';
    const resolvedRole = normalizeUserRole(isOwner ? 'ADM' : 'Vistoriador', email);
    matched = {
      id: `usr-${fbUser.uid.slice(0, 12)}`,
      name: fbUser.displayName || email.split('@')[0] || 'Colaborador Ameta',
      email: isOwner ? 'rafael.araujo@ameta.com.br' : email,
      role: resolvedRole,
      assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
      accessReleased: true,
      equipe: '',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    state.users = [...existingUsers, matched];
    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
  }

  return { firebaseUser: fbUser, ametaUser: matched };
}

export function subscribeToCloudWorkspaceUpdates(onRemoteUpdate: () => void) {
  const unsubs: (() => void)[] = [];
  onAuthStateChanged(auth, (fbUser) => {
    unsubs.forEach((u) => u());
    unsubs.length = 0;
    if (!fbUser || !fbUser.emailVerified) return;

    for (const mapping of CHUNK_MAPPINGS) {
      const path = `workspace_snapshots/${mapping.chunkId}`;
      const unsub = onSnapshot(
        doc(db, 'workspace_snapshots', mapping.chunkId),
        (snap) => {
          if (snap.exists() && cachedDbState) {
            try {
              const data = snap.data();
              if (typeof data.dataJson === 'string') {
                const parsed = JSON.parse(data.dataJson);
                applyChunkPayloadToState(cachedDbState, parsed);
                saveLocalDbState(cachedDbState);
                onRemoteUpdate();
              }
            } catch {
              // ignore parse error
            }
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, path);
        }
      );
      unsubs.push(unsub);
    }
  });
}

// ============================================================================
// SERVERLESS / NETLIFY CLOUD API INTERCEPTOR
// Automatically handles all /api/* routes in browser when hosted on Netlify
// ============================================================================
function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleServerlessApiRequest(
  urlPath: string,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  let body: any = {};
  if (init?.body && typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = {};
    }
  }

  const state = await ensureLocalDbState();
  const cleanPath = urlPath.split('?')[0];

  // GET /api/state
  if (cleanPath === '/api/state' && method === 'GET') {
    return jsonResponse({
      sites: state.sites || [],
      sheets: state.sheets || [],
      engineeringFolders: state.engineeringFolders || [],
      engineeringFiles: state.engineeringFiles || [],
      tssrRows: state.tssrRows || [],
      tssrSheets: state.tssrSheets || [],
      ericssonRows: state.ericssonRows || [],
      ericssonSheetMeta: state.ericssonSheetMeta || null,
      ericssonFolders: state.ericssonFolders || [],
      ericssonFiles: state.ericssonFiles || [],
      ericssonUsers: state.ericssonUsers || [],
      users: state.users || [],
      notifications: state.notifications || [],
      duplaEmailsMap: state.duplaEmailsMap || {},
      lastUpdated: state.lastUpdated || new Date().toISOString(),
      activeConnections: 1,
    });
  }

  // POST /api/auth/login
  if (cleanPath === '/api/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const allUsers: AmetaUser[] = [
      ...(state.users || []),
      ...(state.ericssonUsers || []),
    ];
    let found = allUsers.find((u) => u.email.trim().toLowerCase() === email);
    if (!found) {
      const isOwner = isOwnerAdmUser(email);
      found = {
        id: `usr-${Date.now()}`,
        name: email.split('@')[0] || 'Colaborador Ameta',
        email,
        role: normalizeUserRole(isOwner ? 'ADM' : 'Vistoriador', email),
        assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
        accessReleased: true,
        equipe: '',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      };
      state.users = [...(state.users || []), found];
      saveLocalDbState(state);
      await pushWorkspaceToFirestore(state);
    }
    return jsonResponse({ user: { ...found, emailVerified: true } });
  }

  // POST /api/auth/register & verify-email
  if (
    (cleanPath === '/api/auth/register' || cleanPath === '/api/auth/verify-email') &&
    method === 'POST'
  ) {
    const email = String(body.email || '').trim().toLowerCase();
    const isOwner = isOwnerAdmUser(email);
    const newUser: AmetaUser = {
      id: `usr-${Date.now()}`,
      name: String(body.name || email.split('@')[0] || 'Colaborador'),
      email,
      role: normalizeUserRole(isOwner ? 'ADM' : body.role || 'Vistoriador', email),
      assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
      accessReleased: true,
      equipe: isOwner ? 'Coordenação / ADM' : '',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    state.users = [...(state.users || []).filter((u: any) => u.email !== email), newUser];
    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({ user: newUser, requiresVerification: false });
  }

  // POST /api/admin/duplas/link-email
  if (cleanPath === '/api/admin/duplas/link-email' && method === 'POST') {
    const duplaName = String(body.duplaName || '').trim();
    const emails: string[] = Array.isArray(body.emails)
      ? body.emails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean)
      : [];

    state.duplaEmailsMap = {
      ...(state.duplaEmailsMap || {}),
      [duplaName]: emails,
    };

    const emailSet = new Set(emails);
    const updateUsersList = (list: any[]) =>
      (list || []).map((u) => {
        const em = String(u.email || '').trim().toLowerCase();
        if (emailSet.has(em)) {
          return { ...u, equipe: duplaName };
        }
        return u;
      });

    state.users = updateUsersList(state.users);
    state.ericssonUsers = updateUsersList(state.ericssonUsers);

    for (const em of emails) {
      const existsInNokia = (state.users || []).some(
        (u: any) => String(u.email || '').trim().toLowerCase() === em
      );
      if (!existsInNokia) {
        state.users = [
          ...(state.users || []),
          {
            id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name: em.split('@')[0],
            email: em,
            role: 'Executor',
            assignedPlatform: 'BOTH',
            accessReleased: true,
            equipe: duplaName,
            emailVerified: true,
            createdAt: new Date().toISOString(),
          },
        ];
      }
    }

    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      duplaEmailsMap: state.duplaEmailsMap,
      sites: state.sites,
      ericssonRows: state.ericssonRows,
    });
  }

  // POST /api/sites/assign-responsible (Assign, Unassign, Clear, or Rename Dupla on Nokia & Ericsson)
  if (cleanPath === '/api/sites/assign-responsible' && method === 'POST') {
    const vendor = String(body.vendor || 'NOKIA').toUpperCase();
    const responsibleName = String(body.responsibleName || '').trim();
    const clearAllForResponsible = String(body.clearAllForResponsible || '').trim();
    const renameFrom = String(body.renameFrom || '').trim();
    const renameTo = String(body.renameTo || '').trim();
    const siteTokens: string[] = Array.isArray(body.siteTokens)
      ? body.siteTokens.map((t: string) => String(t).trim().toUpperCase()).filter(Boolean)
      : [];
    const unassignSiteTokens: string[] = Array.isArray(body.unassignSiteTokens)
      ? body.unassignSiteTokens.map((t: string) => String(t).trim().toUpperCase()).filter(Boolean)
      : [];
    const linkedEmails: string[] = Array.isArray(body.linkedEmails)
      ? body.linkedEmails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean)
      : [];

    let updatedCount = 0;

    if (renameFrom && renameTo) {
      state.sites = (state.sites || []).map((s: any) => {
        if (
          String(s.equipeParceira || '').toLowerCase() === renameFrom.toLowerCase() ||
          String(s.customFields?.['EQUIPE EXECUTANTE'] || '').toLowerCase() ===
            renameFrom.toLowerCase()
        ) {
          return {
            ...s,
            equipeParceira: renameTo,
            responsavelCampo: renameTo,
            customFields: {
              ...(s.customFields || {}),
              'EQUIPE EXECUTANTE': renameTo,
            },
          };
        }
        return s;
      });
      state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
        if (String(r.equipe || '').toLowerCase() === renameFrom.toLowerCase()) {
          return {
            ...r,
            equipe: renameTo,
            fields: { ...(r.fields || {}), EQUIPE: renameTo },
          };
        }
        return r;
      });
    } else if (clearAllForResponsible || unassignSiteTokens.length > 0) {
      const unassignSet = new Set(unassignSiteTokens);
      if (vendor === 'ERICSSON') {
        state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
          const matchToken =
            unassignSet.has(String(r.id).toUpperCase()) ||
            unassignSet.has(String(r.siteIdA || '').toUpperCase()) ||
            unassignSet.has(String(r.siteIdB || '').toUpperCase());
          const matchResp =
            clearAllForResponsible &&
            String(r.equipe || '').toLowerCase() === clearAllForResponsible.toLowerCase();
          if (matchToken || matchResp) {
            updatedCount++;
            return {
              ...r,
              equipe: '',
              fields: { ...(r.fields || {}), EQUIPE: '', 'E-MAIL DUPLA': '' },
            };
          }
          return r;
        });
      } else {
        state.sites = (state.sites || []).map((s: any) => {
          const matchToken =
            unassignSet.has(String(s.id).toUpperCase()) ||
            unassignSet.has(String(s.siteId || '').trim().toUpperCase());
          const matchResp =
            clearAllForResponsible &&
            (String(s.equipeParceira || '').toLowerCase() ===
              clearAllForResponsible.toLowerCase() ||
              String(s.customFields?.['EQUIPE EXECUTANTE'] || '').toLowerCase() ===
                clearAllForResponsible.toLowerCase());
          if (matchToken || matchResp) {
            updatedCount++;
            return {
              ...s,
              equipeParceira: '',
              responsavelCampo: '',
              customFields: {
                ...(s.customFields || {}),
                'EQUIPE EXECUTANTE': '',
                Executor: '',
                Responsável: '',
                'E-MAIL DUPLA': '',
              },
            };
          }
          return s;
        });
      }
    } else if (siteTokens.length > 0 && responsibleName) {
      const tokenSet = new Set(siteTokens);
      const emailsJoined = linkedEmails.join(', ');
      if (vendor === 'ERICSSON') {
        state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
          const match =
            tokenSet.has(String(r.id).toUpperCase()) ||
            tokenSet.has(String(r.siteIdA || '').trim().toUpperCase()) ||
            tokenSet.has(String(r.siteIdB || '').trim().toUpperCase()) ||
            tokenSet.has(String(r.idRot || '').trim().toUpperCase());
          if (match) {
            updatedCount++;
            return {
              ...r,
              equipe: responsibleName,
              fields: {
                ...(r.fields || {}),
                EQUIPE: responsibleName,
                ...(emailsJoined ? { 'E-MAIL DUPLA': emailsJoined } : {}),
              },
            };
          }
          return r;
        });
      } else {
        state.sites = (state.sites || []).map((s: any) => {
          if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return s;
          const match =
            tokenSet.has(String(s.id).toUpperCase()) ||
            tokenSet.has(String(s.siteId || '').trim().toUpperCase());
          if (match) {
            updatedCount++;
            return {
              ...s,
              equipeParceira: responsibleName,
              responsavelCampo: responsibleName,
              customFields: {
                ...(s.customFields || {}),
                'EQUIPE EXECUTANTE': responsibleName,
                ...(emailsJoined ? { 'E-MAIL DUPLA': emailsJoined } : {}),
              },
            };
          }
          return s;
        });
      }
    }

    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({
      sites: state.sites,
      ericssonRows: state.ericssonRows,
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      notifications: state.notifications,
      updatedCount,
    });
  }

  // PUT /api/sites/:id
  if (cleanPath.startsWith('/api/sites/') && method === 'PUT') {
    const siteId = decodeURIComponent(cleanPath.replace('/api/sites/', ''));
    const updates = body.updates || {};
    state.sites = (state.sites || []).map((s: any) =>
      s.id === siteId ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
    );
    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({ sites: state.sites, sheets: state.sheets });
  }

  // POST /api/owner/permissions/release
  if (cleanPath === '/api/owner/permissions/release' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const role: UserRole = body.role || 'Executor';
    const assignedPlatform: AssignedPlatformScope = body.assignedPlatform || 'NOKIA';
    const name = String(body.name || cleanEmail.split('@')[0] || 'Colaborador').trim();
    const equipe = String(body.equipe || '').trim();
    const now = new Date().toISOString();

    const updatedUser: AmetaUser = {
      id: body.userId || `usr-${Date.now()}`,
      name,
      email: cleanEmail,
      role,
      assignedPlatform,
      accessReleased: Boolean(body.accessReleased ?? true),
      equipe,
      telefone: body.telefone || '',
      atividade: body.atividade || '',
      documents: ensureUserMandatoryDocuments(),
      emailVerified: true,
      createdAt: now,
    };

    state.users = [
      updatedUser,
      ...(state.users || []).filter(
        (u: any) => String(u.email || '').trim().toLowerCase() !== cleanEmail
      ),
    ];
    if (assignedPlatform === 'ERICSSON' || assignedPlatform === 'BOTH') {
      state.ericssonUsers = [
        updatedUser,
        ...(state.ericssonUsers || []).filter(
          (u: any) => String(u.email || '').trim().toLowerCase() !== cleanEmail
        ),
      ];
    }

    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      notifications: state.notifications || [],
    });
  }

  // POST /api/engineering/files (Nokia Vistoria / TSSR upload)
  if (cleanPath === '/api/engineering/files' && method === 'POST') {
    const roleNorm = normalizeUserRole(body.uploadedByRole || '', body.uploadedByEmail || '');
    const folder = (state.engineeringFolders || []).find((f: any) => f.id === body.folderId);
    const isTssrTarget =
      Boolean(body.isTssrProjectUpload) ||
      folder?.name === 'TSSR' ||
      folder?.name === 'TSSR Entrada';

    if (roleNorm === 'Vistoriador' && isTssrTarget) {
      return jsonResponse(
        { error: 'O perfil Vistoriador não tem permissão para subir TSSR.' },
        403
      );
    }
    if (roleNorm === 'Executor' && !isTssrTarget) {
      return jsonResponse(
        { error: 'O perfil Executor só tem permissão para subir TSSR.' },
        403
      );
    }

    const nowIso = new Date().toISOString();
    const newFile = {
      id: `eng-file-${Date.now()}`,
      folderId: body.folderId,
      vendor: body.vendor || 'NOKIA',
      fileName: body.fileName || 'arquivo.zip',
      fileType: body.fileType || 'application/zip',
      fileSize: Number(body.fileSize || 0),
      uploadedByName: body.uploadedByName || 'Colaborador',
      uploadedByEmail: body.uploadedByEmail || '',
      uploadedAt: nowIso,
      siteId: body.siteId || '',
      ocSitePre: body.ocSitePre || '',
      tssrRowId: body.tssrRowId || '',
      notes: body.notes || '',
      dataUrl: body.dataUrl || '',
    };
    state.engineeringFiles = [newFile, ...(state.engineeringFiles || [])];

    if (!isTssrTarget && (body.tssrRowId || body.siteId)) {
      state.tssrRows = (state.tssrRows || []).map((r: any) => {
        if (
          r.id === body.tssrRowId ||
          (body.siteId &&
            String(r.siteId || '').toUpperCase() === String(body.siteId).toUpperCase())
        ) {
          return {
            ...r,
            vistoriaStatus: 'Finalizado',
            arquivoVistoriaFileId: newFile.id,
            arquivoVistoriaFileName: newFile.fileName,
            arquivoVistoriaFolderId: newFile.folderId,
            arquivoVistoriaUploadedAt: nowIso,
            arquivoVistoriaUploadedBy: newFile.uploadedByName,
          };
        }
        return r;
      });
    }

    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({
      file: newFile,
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      tssrRows: state.tssrRows,
      tssrSheets: state.tssrSheets,
      sites: state.sites,
      notifications: state.notifications,
    });
  }

  // POST /api/ericsson/vistoria/upload
  if (cleanPath === '/api/ericsson/vistoria/upload' && method === 'POST') {
    const side = String(body.targetSide || 'A').toUpperCase();
    const roleNorm = normalizeUserRole(body.uploadedByRole || '', body.uploadedByEmail || '');

    if (roleNorm === 'Vistoriador' && side === 'TSSR') {
      return jsonResponse(
        { error: 'O perfil Vistoriador não tem permissão para subir TSSR.' },
        403
      );
    }
    if (roleNorm === 'Executor' && side !== 'TSSR') {
      return jsonResponse(
        { error: 'O perfil Executor só tem permissão para subir TSSR.' },
        403
      );
    }

    const nowIso = new Date().toISOString();
    const newFile = {
      id: `eri-file-${Date.now()}`,
      folderId: body.folderId,
      fileName: body.fileName || 'vistoria_ericsson.zip',
      fileType: body.fileType || 'application/zip',
      fileSize: Number(body.fileSize || 0),
      uploadedByName: body.uploadedByName || 'Colaborador',
      uploadedByEmail: body.uploadedByEmail || '',
      uploadedAt: nowIso,
      rowId: body.rowId || '',
      targetSide: side,
      linkedSiteId: body.linkedSiteId || '',
      notes: body.notes || '',
      dataUrl: body.dataUrl || '',
    };
    state.ericssonFiles = [newFile, ...(state.ericssonFiles || [])];

    if (body.rowId) {
      state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
        if (r.id !== body.rowId) return r;
        if (side === 'LOS') {
          return {
            ...r,
            losStatus: 'Entregue',
            losLinkedSiteId: body.linkedSiteId || r.siteIdA,
            losFileId: newFile.id,
            losFileName: newFile.fileName,
            losFolderId: newFile.folderId,
          };
        }
        if (side === 'TSSR') {
          return r;
        }
        if (side === 'B') {
          return {
            ...r,
            siteBVistoriaStatus: 'Entregue',
            siteBVistoriaFileId: newFile.id,
            siteBVistoriaFileName: newFile.fileName,
            siteBVistoriaFolderId: newFile.folderId,
            siteAVistoriaStatus:
              r.siteAVistoriaStatus === 'Entregue' ? 'Entregue' : 'Dispensado',
          };
        }
        return {
          ...r,
          siteAVistoriaStatus: 'Entregue',
          siteAVistoriaFileId: newFile.id,
          siteAVistoriaFileName: newFile.fileName,
          siteAVistoriaFolderId: newFile.folderId,
          siteBVistoriaStatus:
            r.siteBVistoriaStatus === 'Entregue' ? 'Entregue' : 'Dispensado',
        };
      });
    }

    saveLocalDbState(state);
    await pushWorkspaceToFirestore(state);
    return jsonResponse({
      file: newFile,
      ericssonRows: state.ericssonRows,
      ericssonSheetMeta: state.ericssonSheetMeta,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
      notifications: state.notifications,
    });
  }

  return jsonResponse({
    ok: true,
    sites: state.sites || [],
    users: state.users || [],
    ericssonUsers: state.ericssonUsers || [],
    duplaEmailsMap: state.duplaEmailsMap || {},
    tssrRows: state.tssrRows || [],
    engineeringFolders: state.engineeringFolders || [],
    engineeringFiles: state.engineeringFiles || [],
    ericssonRows: state.ericssonRows || [],
    ericssonFolders: state.ericssonFolders || [],
    ericssonFiles: state.ericssonFiles || [],
    notifications: state.notifications || [],
  });
}

export const cloudFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname + input.search
        : input.url;

  const isApiCall = urlStr.startsWith('/api/') || urlStr.includes('/api/');
  if (!isApiCall) {
    return originalFetch(input, init);
  }

  const apiPath = urlStr.startsWith('/api/')
    ? urlStr
    : urlStr.slice(urlStr.indexOf('/api/'));

  if (backendAvailable === false) {
    return handleServerlessApiRequest(apiPath, init);
  }

  try {
    const response = await originalFetch(input, init);
    const contentType = response.headers.get('content-type') || '';

    if (response.status === 404 || contentType.includes('text/html')) {
      backendAvailable = false;
      return handleServerlessApiRequest(apiPath, init);
    }

    backendAvailable = true;

    if (response.ok && contentType.includes('application/json')) {
      const clone = response.clone();
      clone
        .json()
        .then(async (data) => {
          if (data && typeof data === 'object') {
            const state = await ensureLocalDbState();
            let changed = false;
            for (const key of [
              'sites',
              'users',
              'ericssonUsers',
              'duplaEmailsMap',
              'notifications',
              'engineeringFolders',
              'engineeringFiles',
              'ericssonRows',
              'ericssonFolders',
              'ericssonFiles',
              'tssrRows',
            ]) {
              if (key in data && data[key] !== undefined) {
                state[key] = data[key];
                changed = true;
              }
            }
            if (changed) {
              saveLocalDbState(state);
              if ((init?.method || 'GET').toUpperCase() !== 'GET') {
                await pushWorkspaceToFirestore(state);
              }
            }
          }
        })
        .catch(() => {
          // ignore clone error
        });
    }

    return response;
  } catch {
    backendAvailable = false;
    return handleServerlessApiRequest(apiPath, init);
  }
};

export function installNetlifyCloudApiBridge() {
  // Safe initialization hook; components use cloudFetch directly to avoid mutating read-only window.fetch getters
}
