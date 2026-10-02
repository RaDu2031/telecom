import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  app,
  db,
  auth,
  isFirebaseEnvConfigured,
  OperationType,
  FirestoreErrorInfo,
  handleFirestoreError,
} from './firebase';
import {
  dataService,
  sanitizarSiteIdParaFirestore,
  gerarDocIdEricsson,
} from '../services/dataService';
import {
  AmetaUser,
  UserRole,
  UserSituacao,
  AssignedPlatformScope,
  TelecomSite,
  EricssonRow,
  normalizeUserRole,
  isOwnerAdmUser,
  ensureUserMandatoryDocuments,
} from '../types/telecom';

export {
  app,
  db,
  auth,
  isFirebaseEnvConfigured,
  OperationType,
  handleFirestoreError,
};
export type { FirestoreErrorInfo };

const googleProvider = new GoogleAuthProvider();

const LOCAL_STORAGE_DB_KEY = 'ameta_cloud_serverless_db_v2';
let cachedDbState: Record<string, any> | null = null;
let backendAvailable: boolean | null = null;

const originalFetch = window.fetch.bind(window);

export async function ensureLocalDbState(): Promise<Record<string, any>> {
  if (cachedDbState) return cachedDbState;

  try {
    const rawLocal = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.sites) &&
        parsed.sites.length > 0
      ) {
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

  saveLocalDbState(cachedDbState);
  return cachedDbState;
}

export function updateCachedClientState(partial: Record<string, any>) {
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
  Object.assign(cachedDbState, partial);
  saveLocalDbState(cachedDbState);
}

function saveLocalDbState(state: Record<string, any>) {
  state.lastUpdated = new Date().toISOString();
  cachedDbState = state;
  try {
    const slim = {
      ...state,
      engineeringFiles: (state.engineeringFiles || []).map((f: any) => ({
        ...f,
        dataUrl:
          typeof f.dataUrl === 'string' && f.dataUrl.length > 25000 ? '' : f.dataUrl || '',
      })),
      ericssonFiles: (state.ericssonFiles || []).map((f: any) => ({
        ...f,
        dataUrl:
          typeof f.dataUrl === 'string' && f.dataUrl.length > 25000 ? '' : f.dataUrl || '',
      })),
    };
    localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(slim));
  } catch {
    // ignore quota error
  }
}

export async function pushWorkspaceToFirestore(state: Record<string, any>): Promise<void> {
  if (!isFirebaseEnvConfigured || !auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  try {
    if (state.duplaEmailsMap && typeof state.duplaEmailsMap === 'object') {
      await dataService.salvarMapaDuplas(state.duplaEmailsMap);
    }
  } catch {
    // ignore permission errors if user is not Coordenador/dono
  }
}

export async function pullWorkspaceFromFirestore(
  _targetState: Record<string, any>
): Promise<boolean> {
  return Boolean(isFirebaseEnvConfigured && auth.currentUser && auth.currentUser.emailVerified);
}

export async function signInWithGoogleFirebase(): Promise<{
  firebaseUser: FirebaseUser;
  ametaUser: AmetaUser;
}> {
  const cred = await signInWithPopup(auth, googleProvider);
  const fbUser = cred.user;
  const email = (fbUser.email || '').trim().toLowerCase();

  const state = await ensureLocalDbState();
  const profile = await dataService.garantirDocumentoUsuarioNoCadastro(
    fbUser.uid,
    email,
    fbUser.displayName || email.split('@')[0] || 'Colaborador Ameta'
  );

  const existingUsers: AmetaUser[] = Array.isArray(state.users) ? state.users : [];
  state.users = [
    profile,
    ...existingUsers.filter((u) => u.email.trim().toLowerCase() !== email && u.id !== profile.id),
  ];
  saveLocalDbState(state);

  return { firebaseUser: fbUser, ametaUser: profile };
}

export async function connectAndSyncFirebaseCloud(
  currentStateSnapshot?: Record<string, any>
): Promise<{
  connected: boolean;
  firebaseEmail: string;
  state: Record<string, any>;
}> {
  const fbUser = auth.currentUser;
  const state = await ensureLocalDbState();

  if (currentStateSnapshot && typeof currentStateSnapshot === 'object') {
    for (const [k, v] of Object.entries(currentStateSnapshot)) {
      if (v !== undefined) {
        state[k] = v;
      }
    }
  }

  if (fbUser && fbUser.emailVerified && isFirebaseEnvConfigured) {
    if (Array.isArray(state.sites) && state.sites.length > 0) {
      await dataService.importarSitesNokiaEmLote(
        state.sites as TelecomSite[],
        state.users as AmetaUser[],
        state.duplaEmailsMap || {}
      );
    }
    if (Array.isArray(state.ericssonRows) && state.ericssonRows.length > 0) {
      await dataService.importarSitesEricssonEmLote(
        state.ericssonRows as EricssonRow[],
        [...(state.users || []), ...(state.ericssonUsers || [])] as AmetaUser[],
        state.duplaEmailsMap || {}
      );
    }
    if (state.duplaEmailsMap) {
      await dataService.salvarMapaDuplas(state.duplaEmailsMap);
    }
  }

  saveLocalDbState(state);

  return {
    connected: Boolean(fbUser && fbUser.emailVerified),
    firebaseEmail: fbUser?.email || '',
    state,
  };
}

export function subscribeToFirebaseAuthStatus(
  onStatusChange: (status: { connected: boolean; email: string | null }) => void
): () => void {
  if (!isFirebaseEnvConfigured) {
    onStatusChange({ connected: false, email: null });
    return () => {};
  }
  return onAuthStateChanged(auth, (fbUser) => {
    onStatusChange({
      connected: Boolean(fbUser && fbUser.emailVerified),
      email: fbUser?.email || null,
    });
  });
}

export function subscribeToCloudWorkspaceUpdates(_onRemoteUpdate: () => void) {
  // Real-time listeners for nokia_sites, ericsson_sites, usuarios, etc. are managed via dataService in App.tsx
}

// ============================================================================
// SERVERLESS / NETLIFY CLOUD API INTERCEPTOR + FIRESTORE PERSISTENCE BRIDGE
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
  const allKnownUsers: AmetaUser[] = [
    ...(state.users || []),
    ...(state.ericssonUsers || []),
  ];

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
    let found = allKnownUsers.find((u) => u.email.trim().toLowerCase() === email);
    if (!found) {
      const isOwner = isOwnerAdmUser(email);
      found = {
        id: auth.currentUser?.uid || `usr-${Date.now()}`,
        uid: auth.currentUser?.uid,
        name: email.split('@')[0] || 'Colaborador Ameta',
        email,
        situacao: isOwner ? 'dono' : 'aguardando',
        role: normalizeUserRole(isOwner ? 'ADM' : 'Vistoriador', email),
        plataforma: isOwner ? 'BOTH' : 'NOKIA',
        assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
        accessReleased: isOwner,
        equipe: '',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      };
      state.users = [...(state.users || []), found];
      saveLocalDbState(state);
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
      id: auth.currentUser?.uid || `usr-${Date.now()}`,
      uid: auth.currentUser?.uid,
      name: String(body.name || email.split('@')[0] || 'Colaborador'),
      email,
      situacao: isOwner ? 'dono' : 'aguardando',
      role: normalizeUserRole(isOwner ? 'ADM' : body.role || 'Vistoriador', email),
      plataforma: isOwner ? 'BOTH' : 'NOKIA',
      assignedPlatform: isOwner ? 'BOTH' : 'NOKIA',
      accessReleased: isOwner,
      equipe: isOwner ? 'Coordenação / ADM' : '',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    state.users = [...(state.users || []).filter((u: any) => u.email !== email), newUser];
    saveLocalDbState(state);
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

    saveLocalDbState(state);
    await dataService.salvarMapaDuplas(state.duplaEmailsMap);
    return jsonResponse({
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      duplaEmailsMap: state.duplaEmailsMap,
      sites: state.sites,
      ericssonRows: state.ericssonRows,
    });
  }

  // POST /api/sites/bulk (Importação em Massa Nokia em lotes de até 500 documentos, sem duplicar)
  if (cleanPath === '/api/sites/bulk' && method === 'POST') {
    const incomingSites: TelecomSite[] = Array.isArray(body.sites) ? body.sites : [];
    const incomingSheets = Array.isArray(body.sheets) ? body.sheets : state.sheets || [];
    const replaceSheet = Boolean(body.replaceSheet);

    const existingMap = new Map<string, TelecomSite>();
    if (!replaceSheet) {
      for (const s of state.sites || []) {
        const key = sanitizarSiteIdParaFirestore(s.siteId || s.id);
        existingMap.set(key, s);
      }
    }

    const touchedSites: TelecomSite[] = [];
    for (const rawSite of incomingSites) {
      const cleanSiteId = String(rawSite.siteId || rawSite.id || '').trim().toUpperCase();
      if (!cleanSiteId) continue;
      const docKey = sanitizarSiteIdParaFirestore(cleanSiteId);
      const prev = existingMap.get(docKey);
      const merged: TelecomSite = {
        ...(prev || {}),
        ...rawSite,
        id: docKey,
        siteId: cleanSiteId,
        vendor: 'NOKIA',
        customFields: {
          ...(prev?.customFields || {}),
          ...(rawSite.customFields || {}),
        },
        updatedAt: new Date().toISOString(),
      };
      existingMap.set(docKey, merged);
      touchedSites.push(merged);
    }

    state.sites = Array.from(existingMap.values());
    if (incomingSheets.length > 0) {
      state.sheets = incomingSheets;
    }
    saveLocalDbState(state);

    // Persiste em lotes de no máximo 500 documentos no Firestore (nokia_sites)
    await dataService.importarSitesNokiaEmLote(
      touchedSites,
      allKnownUsers,
      state.duplaEmailsMap || {}
    );

    return jsonResponse({
      sites: state.sites,
      sheets: state.sheets,
      importedCount: touchedSites.length,
    });
  }

  // POST /api/sites (Novo Site individual Nokia)
  if (cleanPath === '/api/sites' && method === 'POST') {
    const rawSite = body.site || body;
    const cleanSiteId = String(rawSite.siteId || rawSite.id || `SITE-${Date.now()}`)
      .trim()
      .toUpperCase();
    const docKey = sanitizarSiteIdParaFirestore(cleanSiteId);
    const newSite: TelecomSite = {
      ...rawSite,
      id: docKey,
      siteId: cleanSiteId,
      vendor: 'NOKIA',
      updatedAt: new Date().toISOString(),
    };
    state.sites = [
      newSite,
      ...(state.sites || []).filter(
        (s: any) => sanitizarSiteIdParaFirestore(s.siteId || s.id) !== docKey
      ),
    ];
    saveLocalDbState(state);
    await dataService.salvarSiteNokia(newSite, allKnownUsers, state.duplaEmailsMap || {});
    return jsonResponse({ site: newSite, sites: state.sites, sheets: state.sheets });
  }

  // PUT /api/sites/:id (Atualização de Site Nokia)
  if (cleanPath.startsWith('/api/sites/') && method === 'PUT') {
    const siteId = decodeURIComponent(cleanPath.replace('/api/sites/', ''));
    const updates = body.updates || body || {};
    let updatedTarget: TelecomSite | null = null;

    state.sites = (state.sites || []).map((s: any) => {
      if (s.id === siteId || s.siteId === siteId) {
        updatedTarget = { ...s, ...updates, updatedAt: new Date().toISOString() };
        return updatedTarget;
      }
      return s;
    });

    saveLocalDbState(state);
    if (updatedTarget) {
      await dataService.salvarSiteNokia(updatedTarget, allKnownUsers, state.duplaEmailsMap || {});
    }
    return jsonResponse({ sites: state.sites, sheets: state.sheets });
  }

  // DELETE /api/sites/:id
  if (cleanPath.startsWith('/api/sites/') && method === 'DELETE') {
    const siteId = decodeURIComponent(cleanPath.replace('/api/sites/', ''));
    state.sites = (state.sites || []).filter((s: any) => s.id !== siteId && s.siteId !== siteId);
    saveLocalDbState(state);
    await dataService.excluirSiteNokia(siteId);
    return jsonResponse({ sites: state.sites, sheets: state.sheets });
  }

  // POST /api/ericsson/import (Importação em Massa Ericsson em lotes de até 500 documentos, sem duplicar)
  if (cleanPath === '/api/ericsson/import' && method === 'POST') {
    const incomingRows: EricssonRow[] = Array.isArray(body.rows) ? body.rows : [];
    const existingById = new Map<string, EricssonRow>();
    for (const r of state.ericssonRows || []) {
      const key = gerarDocIdEricsson(r);
      existingById.set(key, r);
    }

    const touchedRows: EricssonRow[] = [];
    for (const rawRow of incomingRows) {
      const docKey = gerarDocIdEricsson(rawRow);
      const prev = existingById.get(docKey);
      const merged: EricssonRow = {
        ...(prev || {}),
        ...rawRow,
        id: docKey,
        // Mantém status individual de cada um dos 2 Site IDs (Torre A e Torre B) caso já existam
        siteAVistoriaStatus:
          rawRow.siteAVistoriaStatus && rawRow.siteAVistoriaStatus !== 'Pendente'
            ? rawRow.siteAVistoriaStatus
            : prev?.siteAVistoriaStatus || rawRow.siteAVistoriaStatus || 'Pendente',
        siteBVistoriaStatus:
          rawRow.siteBVistoriaStatus && rawRow.siteBVistoriaStatus !== 'Pendente'
            ? rawRow.siteBVistoriaStatus
            : prev?.siteBVistoriaStatus || rawRow.siteBVistoriaStatus || 'Pendente',
        losStatus:
          rawRow.losStatus && rawRow.losStatus !== 'Pendente'
            ? rawRow.losStatus
            : prev?.losStatus || rawRow.losStatus || 'Pendente',
        fields: {
          ...(prev?.fields || {}),
          ...(rawRow.fields || {}),
        },
        updatedAt: new Date().toISOString(),
      };
      existingById.set(docKey, merged);
      touchedRows.push(merged);
    }

    state.ericssonRows = Array.from(existingById.values());
    if (body.sheetMeta) {
      state.ericssonSheetMeta = body.sheetMeta;
    }
    saveLocalDbState(state);

    // Persiste em lotes de no máximo 500 documentos no Firestore (ericsson_sites)
    await dataService.importarSitesEricssonEmLote(
      touchedRows,
      allKnownUsers,
      state.duplaEmailsMap || {}
    );

    return jsonResponse({
      ericssonRows: state.ericssonRows,
      ericssonSheetMeta: state.ericssonSheetMeta,
      importedCount: touchedRows.length,
    });
  }

  // POST /api/ericsson/rows (Novo Enlace Ericsson com 2 Site IDs)
  if (cleanPath === '/api/ericsson/rows' && method === 'POST') {
    const rawRow = body.row || body;
    const docKey = gerarDocIdEricsson(rawRow);
    const newRow: EricssonRow = {
      ...rawRow,
      id: docKey,
      siteAVistoriaStatus: rawRow.siteAVistoriaStatus || 'Pendente',
      siteBVistoriaStatus: rawRow.siteBVistoriaStatus || 'Pendente',
      losStatus: rawRow.losStatus || 'Pendente',
      updatedAt: new Date().toISOString(),
    };
    state.ericssonRows = [
      newRow,
      ...(state.ericssonRows || []).filter((r: any) => gerarDocIdEricsson(r) !== docKey),
    ];
    saveLocalDbState(state);
    await dataService.salvarSiteEricsson(newRow, allKnownUsers, state.duplaEmailsMap || {});
    return jsonResponse({
      row: newRow,
      ericssonRows: state.ericssonRows,
      ericssonSheetMeta: state.ericssonSheetMeta,
    });
  }

  // PUT /api/ericsson/rows/:id (Atualização de Enlace Ericsson — Status individual Site ID A / Site ID B)
  if (cleanPath.startsWith('/api/ericsson/rows/') && method === 'PUT') {
    const rowId = decodeURIComponent(cleanPath.replace('/api/ericsson/rows/', ''));
    const updates = body.updates || body || {};
    let updatedRow: EricssonRow | null = null;

    state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
      if (r.id === rowId || gerarDocIdEricsson(r) === rowId) {
        updatedRow = {
          ...r,
          ...updates,
          fields: {
            ...(r.fields || {}),
            ...(updates.fields || {}),
          },
          updatedAt: new Date().toISOString(),
        };
        return updatedRow;
      }
      return r;
    });

    saveLocalDbState(state);
    if (updatedRow) {
      await dataService.salvarSiteEricsson(updatedRow, allKnownUsers, state.duplaEmailsMap || {});
    }
    return jsonResponse({
      row: updatedRow,
      ericssonRows: state.ericssonRows,
      ericssonSheetMeta: state.ericssonSheetMeta,
    });
  }

  // DELETE /api/ericsson/rows/:id
  if (cleanPath.startsWith('/api/ericsson/rows/') && method === 'DELETE') {
    const rowId = decodeURIComponent(cleanPath.replace('/api/ericsson/rows/', ''));
    state.ericssonRows = (state.ericssonRows || []).filter(
      (r: any) => r.id !== rowId && gerarDocIdEricsson(r) !== rowId
    );
    saveLocalDbState(state);
    await dataService.excluirSiteEricsson(rowId);
    return jsonResponse({
      ericssonRows: state.ericssonRows,
      ericssonSheetMeta: state.ericssonSheetMeta,
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
    const touchedNokiaSites: TelecomSite[] = [];
    const touchedEricssonRows: EricssonRow[] = [];

    if (renameFrom && renameTo) {
      state.sites = (state.sites || []).map((s: any) => {
        if (
          String(s.equipeParceira || '').toLowerCase() === renameFrom.toLowerCase() ||
          String(s.customFields?.['EQUIPE EXECUTANTE'] || '').toLowerCase() ===
            renameFrom.toLowerCase()
        ) {
          const next = {
            ...s,
            equipeParceira: renameTo,
            responsavelCampo: renameTo,
            customFields: {
              ...(s.customFields || {}),
              'EQUIPE EXECUTANTE': renameTo,
            },
          };
          touchedNokiaSites.push(next);
          return next;
        }
        return s;
      });
      state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
        if (String(r.equipe || '').toLowerCase() === renameFrom.toLowerCase()) {
          const next = {
            ...r,
            equipe: renameTo,
            fields: { ...(r.fields || {}), EQUIPE: renameTo },
          };
          touchedEricssonRows.push(next);
          return next;
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
            const next = {
              ...r,
              equipe: '',
              responsaveisUids: [],
              responsaveisEmails: [],
              fields: { ...(r.fields || {}), EQUIPE: '', 'E-MAIL DUPLA': '' },
            };
            touchedEricssonRows.push(next);
            return next;
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
            const next = {
              ...s,
              equipeParceira: '',
              responsavelCampo: '',
              responsaveisUids: [],
              responsaveisEmails: [],
              customFields: {
                ...(s.customFields || {}),
                'EQUIPE EXECUTANTE': '',
                Executor: '',
                Responsável: '',
                'E-MAIL DUPLA': '',
              },
            };
            touchedNokiaSites.push(next);
            return next;
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
            const next = {
              ...r,
              equipe: responsibleName,
              fields: {
                ...(r.fields || {}),
                EQUIPE: responsibleName,
                ...(emailsJoined ? { 'E-MAIL DUPLA': emailsJoined } : {}),
              },
            };
            touchedEricssonRows.push(next);
            return next;
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
            const next = {
              ...s,
              equipeParceira: responsibleName,
              responsavelCampo: responsibleName,
              customFields: {
                ...(s.customFields || {}),
                'EQUIPE EXECUTANTE': responsibleName,
                ...(emailsJoined ? { 'E-MAIL DUPLA': emailsJoined } : {}),
              },
            };
            touchedNokiaSites.push(next);
            return next;
          }
          return s;
        });
      }
    }

    saveLocalDbState(state);
    if (touchedNokiaSites.length > 0) {
      await dataService.importarSitesNokiaEmLote(
        touchedNokiaSites,
        allKnownUsers,
        state.duplaEmailsMap || {}
      );
    }
    if (touchedEricssonRows.length > 0) {
      await dataService.importarSitesEricssonEmLote(
        touchedEricssonRows,
        allKnownUsers,
        state.duplaEmailsMap || {}
      );
    }

    return jsonResponse({
      sites: state.sites,
      ericssonRows: state.ericssonRows,
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      notifications: state.notifications,
      updatedCount,
    });
  }

  // POST /api/owner/permissions/release & PATCH /api/admin/users/:id/role
  if (cleanPath === '/api/owner/permissions/release' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const role: UserRole = body.role || 'Executor';
    const assignedPlatform: AssignedPlatformScope =
      body.plataforma || body.assignedPlatform || 'NOKIA';
    const situacao: UserSituacao =
      body.situacao || (body.accessReleased === false ? 'bloqueado' : 'ativo');
    const name = String(body.name || cleanEmail.split('@')[0] || 'Colaborador').trim();
    const equipe = String(body.equipe || '').trim();
    const now = new Date().toISOString();
    const targetUid = body.uid || body.userId || `usr-${Date.now()}`;

    const updatedUser: AmetaUser = {
      id: targetUid,
      uid: targetUid,
      name,
      email: cleanEmail,
      situacao,
      role,
      plataforma: assignedPlatform,
      assignedPlatform,
      accessReleased: situacao === 'ativo' || situacao === 'dono',
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
        (u: any) =>
          String(u.email || '').trim().toLowerCase() !== cleanEmail && u.id !== targetUid
      ),
    ];
    if (assignedPlatform === 'ERICSSON' || assignedPlatform === 'BOTH') {
      state.ericssonUsers = [
        updatedUser,
        ...(state.ericssonUsers || []).filter(
          (u: any) =>
            String(u.email || '').trim().toLowerCase() !== cleanEmail && u.id !== targetUid
        ),
      ];
    }

    saveLocalDbState(state);
    await dataService.atualizarPermissoesUsuario(targetUid, {
      email: cleanEmail,
      name,
      situacao,
      role,
      plataforma: assignedPlatform,
      equipe,
      telefone: body.telefone || '',
      atividade: body.atividade || '',
    });

    return jsonResponse({
      users: state.users,
      ericssonUsers: state.ericssonUsers,
      notifications: state.notifications || [],
    });
  }

  if (
    cleanPath.startsWith('/api/admin/users/') &&
    cleanPath.endsWith('/role') &&
    method === 'PATCH'
  ) {
    const userId = decodeURIComponent(
      cleanPath.replace('/api/admin/users/', '').replace('/role', '')
    );
    const nextRole: UserRole = body.role || 'Vistoriador';
    let targetUser: AmetaUser | null = null;
    state.users = (state.users || []).map((u: any) => {
      if (u.id === userId || u.uid === userId) {
        targetUser = {
          ...u,
          role: nextRole,
          situacao: u.situacao === 'dono' ? 'dono' : 'ativo',
          accessReleased: true,
        };
        return targetUser;
      }
      return u;
    });
    saveLocalDbState(state);
    if (targetUser) {
      const t = targetUser as AmetaUser;
      await dataService.atualizarPermissoesUsuario(t.uid || t.id, {
        email: t.email,
        name: t.name,
        situacao: t.situacao === 'dono' ? 'dono' : 'ativo',
        role: nextRole,
        plataforma: t.plataforma || t.assignedPlatform || 'NOKIA',
        equipe: t.equipe,
      });
    }
    return jsonResponse({ users: state.users });
  }

  // POST /api/engineering/folders & /api/ericsson/folders
  if (
    (cleanPath === '/api/engineering/folders' || cleanPath === '/api/ericsson/folders') &&
    method === 'POST'
  ) {
    const isEricsson = cleanPath === '/api/ericsson/folders';
    const roleNorm = normalizeUserRole(body.createdByRole || '', body.createdByEmail || '');
    if ((roleNorm === 'Executor' || roleNorm === 'Vistoriador') && !body.isUploadedFolder) {
      return jsonResponse(
        {
          error: `Permissão negada: O perfil ${roleNorm} não tem permissão para criar pastas manualmente. Ele pode apenas subir pastas/arquivos para o sistema.`,
        },
        403
      );
    }
    const nowIso = new Date().toISOString();
    const newFolder = {
      id: `${isEricsson ? 'eric-folder' : 'folder'}-${Date.now()}`,
      parentId: body.parentId || (isEricsson ? 'folder-ericsson-root' : null),
      name: String(body.name || 'Nova Pasta').trim(),
      vendor: (isEricsson ? 'ERICSSON' : body.vendor || 'NOKIA') as 'NOKIA' | 'ERICSSON',
      description: String(body.description || '').trim(),
      createdByName: String(body.createdByName || 'Colaborador').trim(),
      createdByEmail: String(body.createdByEmail || '').trim(),
      createdAt: nowIso,
      isSystem: false,
    };
    if (isEricsson) {
      state.ericssonFolders = [...(state.ericssonFolders || []), newFolder];
      await dataService.salvarPastaEricsson(newFolder);
    } else {
      state.engineeringFolders = [...(state.engineeringFolders || []), newFolder];
      await dataService.salvarPastaNokia(newFolder);
    }
    saveLocalDbState(state);
    return jsonResponse({
      folder: newFolder,
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
    });
  }

  // PUT /api/engineering/folders/:id & /api/ericsson/folders/:id
  if (
    (cleanPath.startsWith('/api/engineering/folders/') ||
      cleanPath.startsWith('/api/ericsson/folders/')) &&
    method === 'PUT'
  ) {
    const isEricsson = cleanPath.startsWith('/api/ericsson/folders/');
    const folderId = decodeURIComponent(
      cleanPath.replace(isEricsson ? '/api/ericsson/folders/' : '/api/engineering/folders/', '')
    );
    const listKey = isEricsson ? 'ericssonFolders' : 'engineeringFolders';
    const target = (state[listKey] || []).find((f: any) => f.id === folderId);
    if (!target) {
      return jsonResponse({ error: 'Pasta não encontrada.' }, 404);
    }
    const roleNorm = normalizeUserRole(body.actorRole || '', body.actorEmail || '');
    if (roleNorm === 'Executor' || roleNorm === 'Vistoriador') {
      const fEmail = String(target.createdByEmail || '').trim().toLowerCase();
      const fName = String(target.createdByName || '').trim().toLowerCase();
      const aEmail = String(body.actorEmail || '').trim().toLowerCase();
      const aName = String(body.actorName || '').trim().toLowerCase();
      const isOwn = (aEmail && fEmail === aEmail) || (aName && fName === aName);
      if (!isOwn) {
        return jsonResponse(
          {
            error: `Permissão negada: O perfil ${roleNorm} pode modificar apenas as pastas que ele mesmo subiu para o sistema.`,
          },
          403
        );
      }
    }
    let updatedFolder: any = null;
    state[listKey] = (state[listKey] || []).map((f: any) => {
      if (f.id === folderId) {
        updatedFolder = {
          ...f,
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : f.name,
          description:
            typeof body.description === 'string' ? body.description.trim() : f.description,
        };
        return updatedFolder;
      }
      return f;
    });
    saveLocalDbState(state);
    if (updatedFolder) {
      if (isEricsson) {
        await dataService.salvarPastaEricsson(updatedFolder);
      } else {
        await dataService.salvarPastaNokia(updatedFolder);
      }
    }
    return jsonResponse({
      folder: updatedFolder,
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
    });
  }

  // DELETE /api/engineering/folders/:id & /api/ericsson/folders/:id
  if (
    (cleanPath.startsWith('/api/engineering/folders/') ||
      cleanPath.startsWith('/api/ericsson/folders/')) &&
    method === 'DELETE'
  ) {
    const isEricsson = cleanPath.startsWith('/api/ericsson/folders/');
    const folderId = decodeURIComponent(
      cleanPath.replace(isEricsson ? '/api/ericsson/folders/' : '/api/engineering/folders/', '')
    );
    const listKey = isEricsson ? 'ericssonFolders' : 'engineeringFolders';
    const fileKey = isEricsson ? 'ericssonFiles' : 'engineeringFiles';
    const target = (state[listKey] || []).find((f: any) => f.id === folderId);
    if (!target) {
      return jsonResponse({ error: 'Pasta não encontrada.' }, 404);
    }
    const qStr = urlPath.includes('?') ? urlPath.split('?')[1] : '';
    const params = new URLSearchParams(qStr);
    const actorEmail = String(params.get('actorEmail') || body.actorEmail || '')
      .trim()
      .toLowerCase();
    const actorName = String(params.get('actorName') || body.actorName || '')
      .trim()
      .toLowerCase();
    const actorRole = String(params.get('actorRole') || body.actorRole || '').trim();
    const roleNorm = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (roleNorm === 'Executor' || roleNorm === 'Vistoriador') {
      const fEmail = String(target.createdByEmail || '').trim().toLowerCase();
      const fName = String(target.createdByName || '').trim().toLowerCase();
      const isOwn = (actorEmail && fEmail === actorEmail) || (actorName && fName === actorName);
      if (!isOwn) {
        return jsonResponse(
          {
            error: `Permissão negada: O perfil ${roleNorm} pode modificar ou excluir apenas as pastas que ele mesmo subiu para o sistema.`,
          },
          403
        );
      }
    }
    state[listKey] = (state[listKey] || []).filter((f: any) => f.id !== folderId);
    state[fileKey] = (state[fileKey] || []).filter((fl: any) => fl.folderId !== folderId);
    saveLocalDbState(state);
    if (isEricsson) {
      await dataService.excluirPastaEricsson(folderId);
    } else {
      await dataService.excluirPastaNokia(folderId);
    }
    return jsonResponse({
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
      ericssonRows: state.ericssonRows,
    });
  }

  // POST /api/engineering/files (Nokia Vistoria / TSSR upload)
  if (cleanPath === '/api/engineering/files' && method === 'POST') {
    const roleNorm = normalizeUserRole(body.uploadedByRole || '', body.uploadedByEmail || '');
    const folder = (state.engineeringFolders || []).find((f: any) => f.id === body.folderId);
    const isTssrTarget =
      Boolean(body.isTssrProjectUpload) ||
      !body.requireSiteLink ||
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
    let targetFolderId = body.folderId;
    if (typeof body.uploadedFolderName === 'string' && body.uploadedFolderName.trim()) {
      const cleanFolderName = body.uploadedFolderName.trim();
      const existingFolder = (state.engineeringFolders || []).find(
        (f: any) =>
          f.parentId === body.folderId &&
          String(f.name || '').trim().toLowerCase() === cleanFolderName.toLowerCase()
      );
      if (existingFolder) {
        targetFolderId = existingFolder.id;
      } else {
        const uploadedFolder = {
          id: `folder-up-${Date.now()}`,
          parentId: body.folderId,
          name: cleanFolderName,
          vendor: (body.vendor || 'NOKIA') as 'NOKIA' | 'ERICSSON',
          description: body.notes || `Pasta enviada por ${body.uploadedByName || 'Colaborador'}`,
          createdByName: body.uploadedByName || 'Colaborador',
          createdByEmail: body.uploadedByEmail || '',
          createdAt: nowIso,
          isSystem: false,
        };
        state.engineeringFolders = [...(state.engineeringFolders || []), uploadedFolder];
        targetFolderId = uploadedFolder.id;
        await dataService.salvarPastaNokia(uploadedFolder);
      }
    }

    const incomingList =
      Array.isArray(body.files) && body.files.length > 0
        ? body.files
        : [{ fileName: body.fileName || 'arquivo.zip', fileSize: body.fileSize || 0 }];

    const createdFiles = incomingList.map((raw: any, idx: number) => {
      const fn = String(raw.fileName || `arquivo_${idx + 1}.zip`);
      const ext = fn.includes('.') ? `.${fn.split('.').pop()!.toLowerCase()}` : '.zip';
      return {
        id: `eng-file-${Date.now()}-${idx}`,
        folderId: targetFolderId,
        vendor: (body.vendor || 'NOKIA') as 'NOKIA' | 'ERICSSON',
        fileName: fn,
        fileType: (ext === '.rar'
          ? 'rar'
          : ext === '.xlsx' || ext === '.xls'
            ? 'excel'
            : 'zip') as 'zip' | 'rar' | 'excel' | 'other',
        extension: ext,
        fileSize: Number(raw.fileSize || 0),
        uploadedByName: body.uploadedByName || 'Colaborador',
        uploadedByEmail: body.uploadedByEmail || '',
        uploadedAt: nowIso,
        siteId: body.siteId || '',
        ocSitePre: body.ocSitePre || '',
        tssrRowId: body.tssrRowId || '',
        notes: body.notes || '',
      };
    });

    const newFile = createdFiles[0];
    state.engineeringFiles = [...createdFiles, ...(state.engineeringFiles || [])];

    for (const cf of createdFiles) {
      await dataService.salvarArquivoNokia(
        cf,
        allKnownUsers,
        state.sites || [],
        state.duplaEmailsMap || {}
      );
    }

    if (body.siteId) {
      const cleanSiteId = String(body.siteId).trim().toUpperCase();
      const matchedSite = (state.sites || []).find(
        (s: any) =>
          String(s.siteId || '').trim().toUpperCase() === cleanSiteId ||
          String(s.id || '').trim().toUpperCase() === cleanSiteId
      );
      const siteEquipe = String(
        matchedSite?.equipeParceira ||
          matchedSite?.responsavelCampo ||
          matchedSite?.customFields?.['EQUIPE EXECUTANTE'] ||
          body.assignedTo ||
          ''
      ).trim();
      const siteEmailRaw = String(matchedSite?.customFields?.['E-MAIL DUPLA'] || '').trim();
      const siteEmails = siteEmailRaw
        ? siteEmailRaw
            .split(/[,;]/)
            .map((e: string) => e.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const notif: any = {
        id: `notif-vist-site-${Date.now()}`,
        type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
        vendor: body.vendor || 'NOKIA',
        title: `Arquivo Associado ao Site ${cleanSiteId}`,
        message: `Há ${createdFiles.length > 1 ? `${createdFiles.length} arquivos associados` : `um arquivo ("${newFile.fileName}") associado`} ao site ${cleanSiteId} pelo qual você é responsável.`,
        siteId: cleanSiteId,
        fileName: newFile.fileName,
        actorName: body.uploadedByName || 'Colaborador',
        actorEmail: body.uploadedByEmail || '',
        targetRoles: ['Vistoriador'],
        ...(siteEquipe ? { targetEquipes: [siteEquipe] } : {}),
        ...(siteEmails.length > 0 ? { targetEmails: siteEmails } : {}),
        readBy: [],
        createdAt: nowIso,
      };
      state.notifications = [notif, ...(state.notifications || [])];
      await dataService.criarNotificacao(notif);
    }

    if (!isTssrTarget && (body.tssrRowId || body.siteId)) {
      state.tssrRows = (state.tssrRows || []).map((r: any) => {
        if (
          r.id === body.tssrRowId ||
          (body.siteId &&
            String(r.siteId || '').toUpperCase() === String(body.siteId).toUpperCase())
        ) {
          const updatedTssr = {
            ...r,
            vistoriaStatus: 'Finalizado',
            arquivoVistoriaFileId: newFile.id,
            arquivoVistoriaFileName: newFile.fileName,
            arquivoVistoriaFolderId: newFile.folderId,
            arquivoVistoriaUploadedAt: nowIso,
            arquivoVistoriaUploadedBy: newFile.uploadedByName,
          };
          void dataService.salvarTssrNokia(updatedTssr);
          return updatedTssr;
        }
        return r;
      });
    }

    saveLocalDbState(state);
    return jsonResponse({
      file: newFile,
      targetFolderId,
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      tssrRows: state.tssrRows,
      tssrSheets: state.tssrSheets,
      sites: state.sites,
      notifications: state.notifications,
    });
  }

  // PUT /api/engineering/files/:id & /api/ericsson/files/:id
  if (
    (cleanPath.startsWith('/api/engineering/files/') ||
      cleanPath.startsWith('/api/ericsson/files/')) &&
    method === 'PUT'
  ) {
    const isEricsson = cleanPath.startsWith('/api/ericsson/files/');
    const fileId = decodeURIComponent(
      cleanPath.replace(isEricsson ? '/api/ericsson/files/' : '/api/engineering/files/', '')
    );
    const fileKey = isEricsson ? 'ericssonFiles' : 'engineeringFiles';
    const target = (state[fileKey] || []).find((fl: any) => fl.id === fileId);
    if (!target) {
      return jsonResponse({ error: 'Arquivo não encontrado.' }, 404);
    }
    const roleNorm = normalizeUserRole(body.actorRole || '', body.actorEmail || '');
    if (roleNorm === 'Executor' || roleNorm === 'Vistoriador') {
      const fEmail = String(target.uploadedByEmail || '').trim().toLowerCase();
      const fName = String(target.uploadedByName || '').trim().toLowerCase();
      const aEmail = String(body.actorEmail || '').trim().toLowerCase();
      const aName = String(body.actorName || '').trim().toLowerCase();
      const isOwn = (aEmail && fEmail === aEmail) || (aName && fName === aName);
      if (!isOwn) {
        return jsonResponse(
          {
            error: `Permissão negada: O perfil ${roleNorm} pode modificar apenas as pastas e arquivos que ele mesmo subiu para o sistema.`,
          },
          403
        );
      }
    }
    let updatedFile: any = null;
    state[fileKey] = (state[fileKey] || []).map((fl: any) => {
      if (fl.id === fileId) {
        updatedFile = {
          ...fl,
          fileName:
            typeof body.fileName === 'string' && body.fileName.trim()
              ? body.fileName.trim()
              : fl.fileName,
          notes: typeof body.notes === 'string' ? body.notes.trim() : fl.notes,
          siteId: typeof body.siteId === 'string' ? body.siteId.trim() : fl.siteId,
          assignedTo:
            typeof body.assignedTo === 'string' ? body.assignedTo.trim() : fl.assignedTo,
        };
        return updatedFile;
      }
      return fl;
    });
    saveLocalDbState(state);
    if (updatedFile) {
      if (isEricsson) {
        await dataService.salvarArquivoEricsson(
          updatedFile,
          allKnownUsers,
          state.ericssonRows || [],
          state.duplaEmailsMap || {}
        );
      } else {
        await dataService.salvarArquivoNokia(
          updatedFile,
          allKnownUsers,
          state.sites || [],
          state.duplaEmailsMap || {}
        );
      }
    }
    return jsonResponse({
      file: updatedFile,
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
    });
  }

  // DELETE /api/engineering/files/:id & /api/ericsson/files/:id
  if (
    (cleanPath.startsWith('/api/engineering/files/') ||
      cleanPath.startsWith('/api/ericsson/files/')) &&
    method === 'DELETE'
  ) {
    const isEricsson = cleanPath.startsWith('/api/ericsson/files/');
    const fileId = decodeURIComponent(
      cleanPath.replace(isEricsson ? '/api/ericsson/files/' : '/api/engineering/files/', '')
    );
    const fileKey = isEricsson ? 'ericssonFiles' : 'engineeringFiles';
    const target = (state[fileKey] || []).find((fl: any) => fl.id === fileId);
    if (!target) {
      return jsonResponse({ error: 'Arquivo não encontrado.' }, 404);
    }
    const qStr = urlPath.includes('?') ? urlPath.split('?')[1] : '';
    const params = new URLSearchParams(qStr);
    const actorEmail = String(params.get('actorEmail') || body.actorEmail || '')
      .trim()
      .toLowerCase();
    const actorName = String(params.get('actorName') || body.actorName || '')
      .trim()
      .toLowerCase();
    const actorRole = String(params.get('actorRole') || body.actorRole || '').trim();
    const roleNorm = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (roleNorm === 'Executor' || roleNorm === 'Vistoriador') {
      const fEmail = String(target.uploadedByEmail || '').trim().toLowerCase();
      const fName = String(target.uploadedByName || '').trim().toLowerCase();
      const isOwn = (actorEmail && fEmail === actorEmail) || (actorName && fName === actorName);
      if (!isOwn) {
        return jsonResponse(
          {
            error: `Permissão negada: O perfil ${roleNorm} pode modificar ou excluir apenas as pastas e arquivos que ele mesmo subiu para o sistema.`,
          },
          403
        );
      }
    }
    state[fileKey] = (state[fileKey] || []).filter((fl: any) => fl.id !== fileId);
    saveLocalDbState(state);
    if (isEricsson) {
      await dataService.excluirArquivoEricsson(fileId);
    } else {
      await dataService.excluirArquivoNokia(fileId);
    }
    return jsonResponse({
      engineeringFolders: state.engineeringFolders,
      engineeringFiles: state.engineeringFiles,
      ericssonFolders: state.ericssonFolders,
      ericssonFiles: state.ericssonFiles,
      tssrRows: state.tssrRows,
      ericssonRows: state.ericssonRows,
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
    let targetFolderId = body.folderId || 'folder-ericsson-root';
    if (typeof body.uploadedFolderName === 'string' && body.uploadedFolderName.trim()) {
      const cleanFolderName = body.uploadedFolderName.trim();
      const existingFolder = (state.ericssonFolders || []).find(
        (f: any) =>
          f.parentId === targetFolderId &&
          String(f.name || '').trim().toLowerCase() === cleanFolderName.toLowerCase()
      );
      if (existingFolder) {
        targetFolderId = existingFolder.id;
      } else {
        const uploadedFolder = {
          id: `eric-folder-up-${Date.now()}`,
          parentId: targetFolderId,
          name: cleanFolderName,
          vendor: 'ERICSSON' as const,
          description: body.notes || `Pasta enviada por ${body.uploadedByName || 'Colaborador'}`,
          createdByName: body.uploadedByName || 'Colaborador',
          createdByEmail: body.uploadedByEmail || '',
          createdAt: nowIso,
          isSystem: false,
        };
        state.ericssonFolders = [...(state.ericssonFolders || []), uploadedFolder];
        targetFolderId = uploadedFolder.id;
        await dataService.salvarPastaEricsson(uploadedFolder);
      }
    }

    const incomingList =
      Array.isArray(body.files) && body.files.length > 0
        ? body.files
        : [{ fileName: body.fileName || 'vistoria_ericsson.zip', fileSize: body.fileSize || 0 }];

    const createdFiles = incomingList.map((raw: any, idx: number) => {
      const fn = String(raw.fileName || `vistoria_${idx + 1}.zip`);
      const ext = fn.includes('.') ? `.${fn.split('.').pop()!.toLowerCase()}` : '.zip';
      return {
        id: `eri-file-${Date.now()}-${idx}`,
        folderId: targetFolderId,
        vendor: 'ERICSSON' as const,
        fileName: fn,
        fileType: (ext === '.rar'
          ? 'rar'
          : ext === '.xlsx' || ext === '.xls'
            ? 'excel'
            : 'zip') as 'zip' | 'rar' | 'excel' | 'other',
        extension: ext,
        fileSize: Number(raw.fileSize || 0),
        uploadedByName: body.uploadedByName || 'Colaborador',
        uploadedByEmail: body.uploadedByEmail || '',
        uploadedAt: nowIso,
        rowId: body.rowId || '',
        targetSide: side,
        siteId: body.linkedSiteId ? `${body.linkedSiteId} [${side}]` : '',
        linkedSiteId: body.linkedSiteId || '',
        notes: body.notes || '',
      };
    });

    const newFile = createdFiles[0];
    state.ericssonFiles = [...createdFiles, ...(state.ericssonFiles || [])];

    for (const cf of createdFiles) {
      await dataService.salvarArquivoEricsson(
        cf,
        allKnownUsers,
        state.ericssonRows || [],
        state.duplaEmailsMap || {}
      );
    }

    const matchedEricRow = (state.ericssonRows || []).find((r: any) => r.id === body.rowId);
    const ericPairLabel = matchedEricRow
      ? matchedEricRow.siteIdA && matchedEricRow.siteIdB
        ? `${matchedEricRow.siteIdA} ↔ ${matchedEricRow.siteIdB}`
        : matchedEricRow.siteIdA || matchedEricRow.siteIdB || body.linkedSiteId || 'Ericsson'
      : body.linkedSiteId || 'Ericsson';
    const ericEquipe = String(
      matchedEricRow?.equipe || matchedEricRow?.fields?.['EQUIPE'] || body.assignedTo || ''
    ).trim();
    const ericEmailRaw = String(matchedEricRow?.fields?.['E-MAIL DUPLA'] || '').trim();
    const ericEmails = ericEmailRaw
      ? ericEmailRaw
          .split(/[,;]/)
          .map((e: string) => e.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const ericNotif: any = {
      id: `notif-eric-vist-site-${Date.now()}`,
      type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
      vendor: 'ERICSSON',
      title: `Arquivo Associado ao Site Ericsson (${ericPairLabel})`,
      message: `Há ${createdFiles.length > 1 ? `${createdFiles.length} arquivos associados` : `um arquivo ("${newFile.fileName}") associado`} ao site/enlace ${ericPairLabel} pelo qual você é responsável.`,
      siteId: ericPairLabel,
      fileName: newFile.fileName,
      actorName: body.uploadedByName || 'Colaborador',
      actorEmail: body.uploadedByEmail || '',
      targetRoles: ['Vistoriador'],
      ...(ericEquipe ? { targetEquipes: [ericEquipe] } : {}),
      ...(ericEmails.length > 0 ? { targetEmails: ericEmails } : {}),
      readBy: [],
      createdAt: nowIso,
    };
    state.notifications = [ericNotif, ...(state.notifications || [])];
    await dataService.criarNotificacao(ericNotif);

    if (body.rowId) {
      let updatedEricRow: EricssonRow | null = null;
      state.ericssonRows = (state.ericssonRows || []).map((r: any) => {
        if (r.id !== body.rowId) return r;
        if (side === 'LOS') {
          updatedEricRow = {
            ...r,
            losStatus: 'Entregue',
            losLinkedSiteId: body.linkedSiteId || r.siteIdA,
            losFileId: newFile.id,
            losFileName: newFile.fileName,
            losFolderId: newFile.folderId,
          };
          return updatedEricRow;
        }
        if (side === 'TSSR') {
          return r;
        }
        if (side === 'B') {
          updatedEricRow = {
            ...r,
            siteBVistoriaStatus: 'Entregue',
            siteBVistoriaFileId: newFile.id,
            siteBVistoriaFileName: newFile.fileName,
            siteBVistoriaFolderId: newFile.folderId,
          };
          return updatedEricRow;
        }
        updatedEricRow = {
          ...r,
          siteAVistoriaStatus: 'Entregue',
          siteAVistoriaFileId: newFile.id,
          siteAVistoriaFileName: newFile.fileName,
          siteAVistoriaFolderId: newFile.folderId,
        };
        return updatedEricRow;
      });
      if (updatedEricRow) {
        await dataService.salvarSiteEricsson(
          updatedEricRow,
          allKnownUsers,
          state.duplaEmailsMap || {}
        );
      }
    }

    saveLocalDbState(state);
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
    engineeringFolders: state.engineeringFolders,
    engineeringFiles: state.engineeringFiles,
    ericssonRows: state.ericssonRows || [],
    ericssonFolders: state.ericssonFolders || [],
    ericssonFiles: state.ericssonFiles || [],
    notifications: state.notifications || [],
  });
}

// Sincroniza mutações originadas no backend Express local para o Firestore (quando Firebase está configurado)
async function syncMutationToFirestore(apiPath: string, method: string, reqBody: any, resData: any) {
  if (!isFirebaseEnvConfigured || !auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  const cleanPath = apiPath.split('?')[0];
  const state = await ensureLocalDbState();
  const allUsers: AmetaUser[] = [...(state.users || []), ...(state.ericssonUsers || [])];
  const duplaMap = state.duplaEmailsMap || {};

  try {
    if (cleanPath === '/api/sites/bulk' && method === 'POST') {
      const incoming: TelecomSite[] = Array.isArray(reqBody?.sites)
        ? reqBody.sites
        : Array.isArray(resData?.sites)
          ? resData.sites
          : [];
      if (incoming.length > 0) {
        await dataService.importarSitesNokiaEmLote(incoming, allUsers, duplaMap);
      }
    } else if (cleanPath === '/api/sites' && method === 'POST' && resData?.site) {
      await dataService.salvarSiteNokia(resData.site, allUsers, duplaMap);
    } else if (cleanPath.startsWith('/api/sites/') && method === 'PUT') {
      const siteId = decodeURIComponent(cleanPath.replace('/api/sites/', ''));
      const matched = (resData?.sites || state.sites || []).find(
        (s: any) => s.id === siteId || s.siteId === siteId
      );
      if (matched) {
        await dataService.salvarSiteNokia(matched, allUsers, duplaMap);
      }
    } else if (cleanPath.startsWith('/api/sites/') && method === 'DELETE') {
      const siteId = decodeURIComponent(cleanPath.replace('/api/sites/', ''));
      await dataService.excluirSiteNokia(siteId);
    } else if (cleanPath === '/api/ericsson/import' && method === 'POST') {
      const rows: EricssonRow[] = Array.isArray(resData?.ericssonRows)
        ? resData.ericssonRows
        : Array.isArray(reqBody?.rows)
          ? reqBody.rows
          : [];
      if (rows.length > 0) {
        await dataService.importarSitesEricssonEmLote(rows, allUsers, duplaMap);
      }
    } else if (cleanPath === '/api/ericsson/rows' && method === 'POST' && resData?.row) {
      await dataService.salvarSiteEricsson(resData.row, allUsers, duplaMap);
    } else if (cleanPath.startsWith('/api/ericsson/rows/') && method === 'PUT') {
      const rowId = decodeURIComponent(cleanPath.replace('/api/ericsson/rows/', ''));
      const matched =
        resData?.row ||
        (resData?.ericssonRows || state.ericssonRows || []).find((r: any) => r.id === rowId);
      if (matched) {
        await dataService.salvarSiteEricsson(matched, allUsers, duplaMap);
      }
    } else if (cleanPath.startsWith('/api/ericsson/rows/') && method === 'DELETE') {
      const rowId = decodeURIComponent(cleanPath.replace('/api/ericsson/rows/', ''));
      await dataService.excluirSiteEricsson(rowId);
    } else if (cleanPath === '/api/admin/duplas/link-email' && method === 'POST') {
      if (resData?.duplaEmailsMap) {
        await dataService.salvarMapaDuplas(resData.duplaEmailsMap);
      }
    }
  } catch {
    // ignore background sync errors when user lacks write permissions for that collection
  }
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

  let parsedReqBody: any = {};
  if (init?.body && typeof init.body === 'string') {
    try {
      parsedReqBody = JSON.parse(init.body);
    } catch {
      parsedReqBody = {};
    }
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
            }
            const method = (init?.method || 'GET').toUpperCase();
            if (method !== 'GET') {
              await syncMutationToFirestore(apiPath, method, parsedReqBody, data);
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
  // Safe initialization hook
}
