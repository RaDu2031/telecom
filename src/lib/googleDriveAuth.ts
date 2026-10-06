import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const provider = new GoogleAuthProvider();
GOOGLE_DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleDriveSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Não foi possível obter o token de acesso do Google Drive');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Erro de autenticação Google Drive:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const googleDriveSignOut = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  iconLink?: string;
  webViewLink?: string;
}

/**
 * List files from Google Drive (prioritizing spreadsheets, sheets, and telecom documents)
 */
export async function listDriveSpreadsheets(
  token: string,
  search?: string
): Promise<DriveFileItem[]> {
  let q = "trashed = false and (mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'text/csv' or mimeType = 'application/pdf')";
  if (search && search.trim()) {
    const escaped = search.trim().replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '30');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Falha ao listar arquivos do Google Drive');
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Download a file from Google Drive as an ArrayBuffer
 */
export async function downloadDriveSpreadsheet(
  token: string,
  fileId: string,
  mimeType: string
): Promise<{ buffer: ArrayBuffer; fileName?: string }> {
  // If it's a native Google Spreadsheet, export it as XLSX
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
    const res = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao exportar planilha do Google Sheets');
    const buffer = await res.arrayBuffer();
    return { buffer };
  }

  // Standard binary file download
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Falha ao baixar arquivo do Google Drive');
  const buffer = await res.arrayBuffer();
  return { buffer };
}

/**
 * Upload or Export a file into Google Drive with user consent
 */
export async function uploadFileToGoogleDrive(
  token: string,
  fileName: string,
  mimeType: string,
  content: Blob | ArrayBuffer
): Promise<DriveFileItem> {
  const metadata = {
    name: fileName,
    mimeType,
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', content instanceof Blob ? content : new Blob([content], { type: mimeType }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erro ao enviar arquivo para o Google Drive');
  }

  return await res.json();
}
