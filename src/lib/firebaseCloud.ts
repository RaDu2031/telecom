// Firebase and Netlify have been completely dismantled as requested.
// The system runs 100% on the Node.js/Express server (server.ts) with standard REST APIs and SSE.

export const cloudFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  return window.fetch(input, init);
};

export function installNetlifyCloudApiBridge() {
  // No-op: API requests route directly to the standard Express server.
}

export function updateCachedClientState(_patch: Record<string, any>) {
  // Local cache helper if needed
}

export function getCachedClientState(): Record<string, any> | null {
  return null;
}

export async function connectAndSyncFirebaseCloud(
  currentStateSnapshot?: Record<string, any>
): Promise<{
  connected: boolean;
  firebaseEmail: string;
  state: Record<string, any>;
}> {
  return {
    connected: false,
    firebaseEmail: '',
    state: currentStateSnapshot || {},
  };
}

export function subscribeToFirebaseAuthStatus(
  onStatusChange: (status: { connected: boolean; email: string | null }) => void
): () => void {
  onStatusChange({ connected: false, email: null });
  return () => {};
}

export function subscribeToCloudWorkspaceUpdates(_onRemoteUpdate: () => void): () => void {
  return () => {};
}

export async function pushWorkspaceToFirestore(_state: Record<string, any>): Promise<void> {
  // No-op: persisted automatically in data/ameta-db.json via server.ts
}

export async function pullWorkspaceFromFirestore(_targetState: Record<string, any>): Promise<boolean> {
  return false;
}
