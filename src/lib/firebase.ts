import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import defaultConfig from '../../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (defaultConfig as any).apiKey || 'AIzaSyC5a0ijspUcwhaLypvkLY3xu7Vm9i0soWA',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (defaultConfig as any).authDomain || 'ameta-sistema-teste.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (defaultConfig as any).projectId || 'ameta-sistema-teste',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (defaultConfig as any).storageBucket || '<storageBucket>',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (defaultConfig as any).messagingSenderId || '400347798343',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || (defaultConfig as any).appId || '<appId>',
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (defaultConfig as any).firestoreDatabaseId || '(default)',
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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[Firestore Error] ${operationType} on ${path}:`, msg);
  throw new Error(msg);
}
