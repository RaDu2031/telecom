import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import defaultConfig from '../../firebase-applet-config.json';

const metaEnv = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};

export const firebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || (defaultConfig as any).apiKey || 'AIzaSyC5a0ijspUcwhaLypvkLY3xu7Vm9i0soWA',
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || (defaultConfig as any).authDomain || 'ameta-sistema-teste.firebaseapp.com',
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || (defaultConfig as any).projectId || 'ameta-sistema-teste',
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || (defaultConfig as any).storageBucket || 'ameta-sistema-teste.firebasestorage.app',
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || (defaultConfig as any).messagingSenderId || '400347798343',
  appId: metaEnv.VITE_FIREBASE_APP_ID || (defaultConfig as any).appId || '1:400347798343:web:50caefe1b5d6119dd50a62',
  firestoreDatabaseId: metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (defaultConfig as any).firestoreDatabaseId || '(default)',
};

export const isFirebaseEnvConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const ALLOWED_EMAIL_DOMAIN = 'ametaservicos.com.br';

export function isAllowedCorporateEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  const parts = clean.split('@');
  return parts.length === 2 && Boolean(parts[0]) && parts[1] === ALLOWED_EMAIL_DOMAIN;
}

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
    },
    operationType,
    path,
  };
  console.error('[Firestore Error]', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

export async function createAuthAccountSecondary(email: string, password: string): Promise<{ uid: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!password || password.length < 8) {
    throw new Error('A senha inicial deve ter no mínimo 8 caracteres.');
  }

  const secondaryAppName = 'SecondaryAuthApp';
  const existingApps = getApps().filter((a) => a.name === secondaryAppName);
  for (const appItem of existingApps) {
    try {
      await deleteApp(appItem);
    } catch (e) {
      // ignore error when deleting app
    }
  }

  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
    const uid = userCredential.user.uid;
    await signOut(secondaryAuth);
    return { uid };
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch (e) {
      // ignore
    }
  }
}
