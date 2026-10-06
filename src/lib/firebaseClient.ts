import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import defaultConfig from '../../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (defaultConfig as any).apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (defaultConfig as any).authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (defaultConfig as any).projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (defaultConfig as any).storageBucket || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (defaultConfig as any).messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || (defaultConfig as any).appId || '',
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (defaultConfig as any).firestoreDatabaseId || '',
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
