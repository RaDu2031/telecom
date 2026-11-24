/**
 * In-memory Firestore mock for Vitest QA audit suite.
 * Never contacts real Firebase/Firestore.
 */
import { vi } from 'vitest';

const DELETE_FIELD_SENTINEL = Symbol('DELETE_FIELD');

export interface MockCollectionRef {
  __type: 'collection';
  path: string;
}

export interface MockDocRef {
  __type: 'doc';
  collectionPath: string;
  id: string;
  path: string;
}

export interface MockQueryConstraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  value?: unknown;
  direction?: 'asc' | 'desc';
  limitCount?: number;
}

export interface MockQueryRef {
  __type: 'query';
  collectionPath: string;
  constraints: MockQueryConstraint[];
}

type SnapshotListener = {
  collectionPath: string;
  constraints: MockQueryConstraint[];
  callback: (snap: any) => void;
};

const store = new Map<string, Map<string, Record<string, any>>>();
const listeners = new Set<SnapshotListener>();
let autoIdCounter = 1;
let maxBatchOpsSeen = 0;
let enforceFirestore500BatchLimit = false;

function deepClone<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return new Date(val.getTime()) as unknown as T;
  if (Array.isArray(val)) return val.map((v) => deepClone(v)) as unknown as T;
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, any>)) {
      if (v === DELETE_FIELD_SENTINEL) {
        out[k] = DELETE_FIELD_SENTINEL;
      } else {
        out[k] = deepClone(v);
      }
    }
    return out as T;
  }
  return val;
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = deepClone(target || {});
  for (const [key, value] of Object.entries(source || {})) {
    if (value === DELETE_FIELD_SENTINEL) {
      delete result[key];
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function applyUpdatePatch(existing: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result = deepClone(existing);
  for (const [rawKey, rawVal] of Object.entries(patch || {})) {
    if (rawKey.includes('.')) {
      const parts = rawKey.split('.');
      let cursor = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cursor[p] || typeof cursor[p] !== 'object' || Array.isArray(cursor[p])) {
          cursor[p] = {};
        }
        cursor = cursor[p];
      }
      const last = parts[parts.length - 1];
      if (rawVal === DELETE_FIELD_SENTINEL) {
        delete cursor[last];
      } else {
        cursor[last] = deepClone(rawVal);
      }
    } else {
      if (rawVal === DELETE_FIELD_SENTINEL) {
        delete result[rawKey];
      } else {
        result[rawKey] = deepClone(rawVal);
      }
    }
  }
  return result;
}

function getFieldByPath(obj: Record<string, any>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
  let col = store.get(colPath);
  if (!col) {
    col = new Map<string, Record<string, any>>();
    store.set(colPath, col);
  }
  return col;
}

function makeDocSnap(colPath: string, id: string, data: Record<string, any> | undefined) {
  const ref: MockDocRef = {
    __type: 'doc',
    collectionPath: colPath,
    id,
    path: `${colPath}/${id}`,
  };
  return {
    id,
    ref,
    exists: () => data !== undefined,
    data: () => (data !== undefined ? deepClone(data) : undefined),
  };
}

function queryCollectionDocs(colPath: string, constraints: MockQueryConstraint[] = []) {
  const col = store.get(colPath);
  let entries: Array<{ id: string; data: Record<string, any> }> = col
    ? Array.from(col.entries()).map(([id, data]) => ({ id, data: deepClone(data) }))
    : [];

  for (const c of constraints) {
    if (c.type === 'where' && c.field) {
      entries = entries.filter(({ data }) => {
        const actual = getFieldByPath(data, c.field!);
        switch (c.op) {
          case '==':
            return actual === c.value;
          case '!=':
            return actual !== c.value;
          case 'array-contains':
            return Array.isArray(actual) && actual.includes(c.value);
          case 'in':
            return Array.isArray(c.value) && c.value.includes(actual);
          default:
            return true;
        }
      });
    } else if (c.type === 'orderBy' && c.field) {
      const dir = c.direction === 'desc' ? -1 : 1;
      entries.sort((a, b) => {
        const av = String(getFieldByPath(a.data, c.field!) ?? '');
        const bv = String(getFieldByPath(b.data, c.field!) ?? '');
        return av.localeCompare(bv) * dir;
      });
    } else if (c.type === 'limit' && typeof c.limitCount === 'number') {
      entries = entries.slice(0, c.limitCount);
    }
  }

  const docs = entries.map((e) => makeDocSnap(colPath, e.id, e.data));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: (d: any) => void) => docs.forEach(cb),
  };
}

function notifyCollection(colPath: string) {
  for (const listener of listeners) {
    if (listener.collectionPath === colPath) {
      listener.callback(queryCollectionDocs(listener.collectionPath, listener.constraints));
    }
  }
}

export function resetMockFirestore(options?: { enforce500Limit?: boolean }) {
  store.clear();
  listeners.clear();
  autoIdCounter = 1;
  maxBatchOpsSeen = 0;
  enforceFirestore500BatchLimit = Boolean(options?.enforce500Limit);
}

export function seedDoc(collectionPath: string, id: string, data: Record<string, any>) {
  const col = getCollectionMap(collectionPath);
  col.set(id, deepClone(data));
  notifyCollection(collectionPath);
}

export function getCollectionDocs(collectionPath: string): Array<{ id: string; data: Record<string, any> }> {
  const col = store.get(collectionPath);
  if (!col) return [];
  return Array.from(col.entries()).map(([id, data]) => ({ id, data: deepClone(data) }));
}

export function getDocData(collectionPath: string, id: string): Record<string, any> | undefined {
  const d = store.get(collectionPath)?.get(id);
  return d ? deepClone(d) : undefined;
}

export function getAllNonEmptyCollections(): string[] {
  const cols: string[] = [];
  for (const [k, m] of store.entries()) {
    if (m.size > 0) cols.push(k);
  }
  return cols.sort();
}

export function getMaxBatchOpsSeen(): number {
  return maxBatchOpsSeen;
}

export function installMockLocalStorage() {
  const map = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return mockStorage;
}

export function createFirestoreMockModule() {
  const collection = (_db: any, ...pathSegments: string[]): MockCollectionRef => ({
    __type: 'collection',
    path: pathSegments.join('/'),
  });

  const doc = (parentOrDb: any, ...pathSegments: string[]): MockDocRef => {
    if (parentOrDb && parentOrDb.__type === 'collection') {
      const id = pathSegments[0] || `auto_${autoIdCounter++}`;
      return {
        __type: 'doc',
        collectionPath: parentOrDb.path,
        id,
        path: `${parentOrDb.path}/${id}`,
      };
    }
    if (pathSegments.length === 1 && pathSegments[0].includes('/')) {
      const parts = pathSegments[0].split('/');
      const id = parts.pop()!;
      const colPath = parts.join('/');
      return { __type: 'doc', collectionPath: colPath, id, path: `${colPath}/${id}` };
    }
    const segs = [...pathSegments];
    const id = segs.pop() || `auto_${autoIdCounter++}`;
    const colPath = segs.join('/');
    return { __type: 'doc', collectionPath: colPath, id, path: `${colPath}/${id}` };
  };

  const where = (field: string, op: string, value: unknown): MockQueryConstraint => ({
    type: 'where',
    field,
    op,
    value,
  });

  const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): MockQueryConstraint => ({
    type: 'orderBy',
    field,
    direction,
  });

  const limit = (limitCount: number): MockQueryConstraint => ({
    type: 'limit',
    limitCount,
  });

  const query = (
    target: MockCollectionRef | MockQueryRef,
    ...constraints: MockQueryConstraint[]
  ): MockQueryRef => ({
    __type: 'query',
    collectionPath: target.__type === 'query' ? target.collectionPath : target.path,
    constraints:
      target.__type === 'query'
        ? [...target.constraints, ...constraints]
        : constraints,
  });

  const getDoc = async (ref: MockDocRef) => {
    const data = store.get(ref.collectionPath)?.get(ref.id);
    return makeDocSnap(ref.collectionPath, ref.id, data);
  };

  const getDocs = async (target: MockCollectionRef | MockQueryRef) => {
    if (target.__type === 'query') {
      return queryCollectionDocs(target.collectionPath, target.constraints);
    }
    return queryCollectionDocs(target.path, []);
  };

  const setDoc = async (ref: MockDocRef, data: Record<string, any>, options?: { merge?: boolean }) => {
    const col = getCollectionMap(ref.collectionPath);
    if (options?.merge) {
      const prev = col.get(ref.id) || {};
      col.set(ref.id, deepMerge(prev, data));
    } else {
      col.set(ref.id, deepMerge({}, data));
    }
    notifyCollection(ref.collectionPath);
  };

  const updateDoc = async (ref: MockDocRef, data: Record<string, any>) => {
    const col = getCollectionMap(ref.collectionPath);
    const prev = col.get(ref.id);
    if (!prev) {
      const err: any = new Error(`No document to update: ${ref.path}`);
      err.code = 'not-found';
      throw err;
    }
    col.set(ref.id, applyUpdatePatch(prev, data));
    notifyCollection(ref.collectionPath);
  };

  const deleteDoc = async (ref: MockDocRef) => {
    const col = store.get(ref.collectionPath);
    if (col) {
      col.delete(ref.id);
      notifyCollection(ref.collectionPath);
    }
  };

  const writeBatch = (_db: any) => {
    const ops: Array<() => void> = [];
    const touchedCollections = new Set<string>();
    return {
      set(ref: MockDocRef, data: Record<string, any>, options?: { merge?: boolean }) {
        touchedCollections.add(ref.collectionPath);
        ops.push(() => {
          const col = getCollectionMap(ref.collectionPath);
          if (options?.merge) {
            col.set(ref.id, deepMerge(col.get(ref.id) || {}, data));
          } else {
            col.set(ref.id, deepMerge({}, data));
          }
        });
      },
      update(ref: MockDocRef, data: Record<string, any>) {
        touchedCollections.add(ref.collectionPath);
        ops.push(() => {
          const col = getCollectionMap(ref.collectionPath);
          const prev = col.get(ref.id);
          if (!prev) {
            const err: any = new Error(`No document to update in batch: ${ref.path}`);
            err.code = 'not-found';
            throw err;
          }
          col.set(ref.id, applyUpdatePatch(prev, data));
        });
      },
      delete(ref: MockDocRef) {
        touchedCollections.add(ref.collectionPath);
        ops.push(() => {
          store.get(ref.collectionPath)?.delete(ref.id);
        });
      },
      async commit() {
        if (ops.length > maxBatchOpsSeen) maxBatchOpsSeen = ops.length;
        if (enforceFirestore500BatchLimit && ops.length > 500) {
          const err: any = new Error(`Batch exceeds Firestore 500-operation limit (${ops.length} ops)`);
          err.code = 'invalid-argument';
          throw err;
        }
        for (const fn of ops) fn();
        for (const colPath of touchedCollections) notifyCollection(colPath);
      },
    };
  };

  const onSnapshot = (
    target: MockCollectionRef | MockQueryRef | MockDocRef,
    onNext: (snap: any) => void,
    _onError?: (err: any) => void
  ) => {
    if (target.__type === 'doc') {
      const data = store.get(target.collectionPath)?.get(target.id);
      onNext(makeDocSnap(target.collectionPath, target.id, data));
      const listener: SnapshotListener = {
        collectionPath: target.collectionPath,
        constraints: [],
        callback: () => {
          const d = store.get(target.collectionPath)?.get(target.id);
          onNext(makeDocSnap(target.collectionPath, target.id, d));
        },
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    const colPath = target.__type === 'query' ? target.collectionPath : target.path;
    const constraints = target.__type === 'query' ? target.constraints : [];
    const listener: SnapshotListener = {
      collectionPath: colPath,
      constraints,
      callback: onNext,
    };
    listeners.add(listener);
    onNext(queryCollectionDocs(colPath, constraints));
    return () => {
      listeners.delete(listener);
    };
  };

  const runTransaction = async (_db: any, updateFn: (tx: any) => Promise<any>) => {
    const tx = {
      get: (ref: MockDocRef) => getDoc(ref),
      set: (ref: MockDocRef, data: any, options?: any) => setDoc(ref, data, options),
      update: (ref: MockDocRef, data: any) => updateDoc(ref, data),
      delete: (ref: MockDocRef) => deleteDoc(ref),
    };
    return updateFn(tx);
  };

  const serverTimestamp = () => new Date().toISOString();
  const deleteField = () => DELETE_FIELD_SENTINEL;
  const arrayUnion = (...items: any[]) => items;
  const arrayRemove = (...items: any[]) => items;
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };

  return {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    runTransaction,
    serverTimestamp,
    deleteField,
    arrayUnion,
    arrayRemove,
    Timestamp,
    getFirestore: vi.fn(() => ({})),
  };
}

export function createFirebaseAuthMockModule() {
  return {
    createUserWithEmailAndPassword: vi.fn(async (_auth: any, email: string) => ({
      user: { uid: `uid_${email.replace(/[^a-z0-9]/gi, '_')}`, email },
    })),
    signInWithEmailAndPassword: vi.fn(async (_auth: any, email: string) => ({
      user: { uid: `uid_${email.replace(/[^a-z0-9]/gi, '_')}`, email },
    })),
    signOut: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    deleteUser: vi.fn(async () => {}),
    onAuthStateChanged: vi.fn(() => () => {}),
    getAuth: vi.fn(() => ({ currentUser: null })),
  };
}
