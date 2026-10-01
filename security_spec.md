# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched in `/databases/{database}/documents` are denied for both `read` and `write`.
2. **Verified Authentication**: Every read and write operation requires `request.auth != null` and `request.auth.token.email_verified == true`.
3. **Path Variable Hardening (`isValidId`)**: Document IDs (`adminUid`, `chunkId`) must be strings of length `1..128` matching `^[a-zA-Z0-9_\-]+$`.
4. **Admin Isolation (`/admins/{adminUid}`)**:
   - Only the owner (`request.auth.uid == adminUid`) or the bootstrapped owner admin (`rafael.araujo0797@gmail.com` with verified email) can read or create their admin record.
   - Strict keys on create: `['uid', 'email', 'createdAt']`.
   - `uid` must equal `request.auth.uid` and `adminUid`.
   - `createdAt` must equal `request.time`.
5. **Workspace Snapshots (`/workspace_snapshots/{chunkId}`)**:
   - Read (`get`) allowed for verified authenticated users who are either the `authorUid` or an admin (`isAdmin()`).
   - List (`list`) strictly enforces `resource.data.authorUid == request.auth.uid || isAdmin()`.
   - Create/Update strictly validates `isValidWorkspaceSnapshot(incoming())` with bounded string sizes (`dataJson.size() <= 900000`), enum checks on `vendor` and `payloadType`, `authorUid == request.auth.uid`, immutable `createdAt`, and `updatedAt == request.time`.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null` attempting to write `/workspace_snapshots/chunk_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', token: { email: 'rafael.araujo0797@gmail.com', email_verified: false } }` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on Create**: Payload includes extra key `isSuperAdmin: true` -> `PERMISSION_DENIED` via `hasOnly()`.
4. **Shadow Field Injection on Update**: Update modifies unauthorized key `createdAt` -> `PERMISSION_DENIED` via `affectedKeys().hasOnly()`.
5. **Identity Spoofing (`authorUid`)**: Authenticated user `u1` sets `authorUid: 'u2'` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: Document ID contains invalid characters or exceeds 128 chars -> `PERMISSION_DENIED` via `isValidId()`.
7. **Value Poisoning (`dataJson` overflow)**: `dataJson` exceeds 900,000 characters -> `PERMISSION_DENIED`.
8. **Enum Violation (`vendor`)**: `vendor: 'HUAWEI'` (not in `['NOKIA', 'ERICSSON', 'SHARED']`) -> `PERMISSION_DENIED`.
9. **Enum Violation (`payloadType`)**: `payloadType: 'HACK'` -> `PERMISSION_DENIED`.
10. **Timestamp Forgery on Create**: Client passes forged `createdAt` != `request.time` -> `PERMISSION_DENIED`.
11. **Immortal Field Mutation on Update**: Client mutates `createdAt` during update -> `PERMISSION_DENIED`.
12. **PII / Unauthorized Admin Read**: User `u2` attempts to `get` `/admins/u1` -> `PERMISSION_DENIED`.
