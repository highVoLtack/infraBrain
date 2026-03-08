export interface LockFile {
  target: string;
  sessionId: string;
  adminName: string;
  createdAt: string;
  pid: number;
  planSummary: string;
}

export type LockResult =
  | { status: 'acquired' }
  | { status: 'locked'; existing: LockFile }
  | { status: 'stale'; existing: LockFile };

export type LockStatus = LockFile | null;
