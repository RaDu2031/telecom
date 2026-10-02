import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

function cleanEnvValue(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim().replace(/^['"]|['"]$/g, '').trim();
  return trimmed.length > 0 && !trimmed.includes('SUA_') ? trimmed : undefined;
}

/**
 * Configuração do Firebase SEMPRE LIGADA:
 * Prioriza variáveis VITE_FIREBASE_* (quando definidas no .env.local / Netlify)
 * e utiliza automaticamente o firebase-applet-config.json provisionado como fallback contínuo.
 */
const envApiKey = cleanEnvValue(import.meta.env.VITE_FIREBASE_API_KEY);
const envProjectId = cleanEnvValue(import.meta.env.VITE_FIREBASE_PROJECT_ID);
const usingEnvConfig = Boolean(envApiKey && envProjectId);

const firebaseConfig = {
  apiKey: envApiKey || firebaseAppletConfig.apiKey,
  authDomain:
    cleanEnvValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) ||
    firebaseAppletConfig.authDomain,
  projectId: envProjectId || firebaseAppletConfig.projectId,
  storageBucket:
    cleanEnvValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) ||
    firebaseAppletConfig.storageBucket,
  messagingSenderId:
    cleanEnvValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) ||
    firebaseAppletConfig.messagingSenderId,
  appId:
    cleanEnvValue(import.meta.env.VITE_FIREBASE_APP_ID) ||
    firebaseAppletConfig.appId,
};

const resolvedDatabaseId = usingEnvConfig
  ? cleanEnvValue(import.meta.env.VITE_FIREBASE_DATABASE_ID)
  : firebaseAppletConfig.firestoreDatabaseId;

// Firebase está sempre ligado sem opção de desligar
export const isFirebaseEnvConfigured = true;

export const ALLOWED_EMAIL_DOMAIN = 'ametaservicos.com.br';

export function isAllowedCorporateEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  const parts = clean.split('@');
  return parts.length === 2 && Boolean(parts[0]) && parts[1] === ALLOWED_EMAIL_DOMAIN;
}

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

try {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  dbInstance = resolvedDatabaseId
    ? getFirestore(appInstance, resolvedDatabaseId)
    : getFirestore(appInstance);
  authInstance = getAuth(appInstance);
} catch (err) {
  console.error('Erro ao inicializar Firebase:', err);
}

export const app = appInstance;
export const db = dbInstance;
export const auth = authInstance;

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
    tenantId?: string | null;
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
  const currentUser = authInstance ? authInstance.currentUser : null;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
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

async function testConnection() {
  if (!dbInstance) return;
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Verifique sua conexão com o Firebase.');
    }
  }
}

testConnection();
