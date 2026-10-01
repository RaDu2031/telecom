/**
 * Phase 0 & Phase 5 Security Rules Verification Suite
 * Verifies that all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_SECURITY_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write to /workspace_snapshots/chunk_1',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof of Bootstrapped Owner',
    collectionPath: '/admins/u1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Create (isVerified: true)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Update (mutating vendor)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity Spoofing (authorUid != request.auth.uid)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning (invalid characters in chunkId)',
    collectionPath: '/workspace_snapshots/invalid$id!',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Value Poisoning (dataJson > 900KB)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Enum Violation on vendor field',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Enum Violation on payloadType field',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Timestamp Forgery on Create (createdAt != request.time)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Immortal Field Mutation on Update (createdAt modified)',
    collectionPath: '/workspace_snapshots/chunk_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'PII / Unauthorized Admin Document Read by Non-Owner',
    collectionPath: '/admins/u1',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
