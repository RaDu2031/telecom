// Firebase and Netlify have been completely removed as requested.
// The system runs 100% on the Node.js/Express server (server.ts) with local JSON storage (data/ameta-db.json) and SSE.

export const isFirebaseEnvConfigured = false;
export const auth: any = null;
export const db: any = null;
export const app: any = null;

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
  console.error(`[Local Server API] ${operationType} on ${path}:`, msg);
  throw new Error(msg);
}
