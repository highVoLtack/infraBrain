import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  acquireLock,
  releaseLock,
  checkLock,
  formatLockConflict,
  promptLockOverride,
} from '../../src/locks/manager.js';
import type { LockFile } from '../../src/locks/types.js';

function createMockReadline(answers: string[]) {
  let callIndex = 0;
  return {
    question: vi.fn(async () => {
      return answers[callIndex++] ?? '';
    }),
    close: vi.fn(),
  } as any;
}

const baseMeta = {
  sessionId: 'session-001',
  adminName: 'admin-test',
  pid: 12345,
  planSummary: 'Fix nginx config',
};

describe('Lock Manager', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrabrain-locks-'));
    lockDir = path.join(tmpDir, 'locks');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('creates lock file and returns acquired when no lock exists', () => {
      const result = acquireLock('nginx', lockDir, baseMeta, 3600000);

      expect(result.status).toBe('acquired');

      const lockPath = path.join(lockDir, 'nginx.lock');
      expect(fs.existsSync(lockPath)).toBe(true);

      const lockData: LockFile = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(lockData.target).toBe('nginx');
      expect(lockData.sessionId).toBe('session-001');
      expect(lockData.adminName).toBe('admin-test');
      expect(lockData.pid).toBe(12345);
      expect(lockData.planSummary).toBe('Fix nginx config');
      expect(lockData.createdAt).toBeDefined();
    });

    it('creates locks directory if it does not exist', () => {
      expect(fs.existsSync(lockDir)).toBe(false);

      acquireLock('nginx', lockDir, baseMeta, 3600000);

      expect(fs.existsSync(lockDir)).toBe(true);
    });

    it('returns locked with existing lock data when lock exists and is not stale', () => {
      // Create an existing lock (recent)
      acquireLock('nginx', lockDir, baseMeta, 3600000);

      const result = acquireLock(
        'nginx',
        lockDir,
        { ...baseMeta, sessionId: 'session-002' },
        3600000,
      );

      expect(result.status).toBe('locked');
      if (result.status === 'locked') {
        expect(result.existing.sessionId).toBe('session-001');
        expect(result.existing.target).toBe('nginx');
      }
    });

    it('returns stale when lock exists but is older than staleTimeoutMs', () => {
      // Create an existing lock with old timestamp
      fs.mkdirSync(lockDir, { recursive: true });
      const oldLock: LockFile = {
        target: 'nginx',
        sessionId: 'session-old',
        adminName: 'admin-old',
        createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        pid: 99999,
        planSummary: 'Old fix',
      };
      fs.writeFileSync(
        path.join(lockDir, 'nginx.lock'),
        JSON.stringify(oldLock, null, 2),
      );

      const result = acquireLock('nginx', lockDir, baseMeta, 3600000); // 1 hour timeout

      expect(result.status).toBe('stale');
      if (result.status === 'stale') {
        expect(result.existing.sessionId).toBe('session-old');
      }
    });

    it('uses atomic create (wx flag) to prevent race conditions', () => {
      // Pre-create the lock file to simulate a race
      fs.mkdirSync(lockDir, { recursive: true });
      const raceLock: LockFile = {
        target: 'nginx',
        sessionId: 'session-racer',
        adminName: 'admin-racer',
        createdAt: new Date().toISOString(),
        pid: 11111,
        planSummary: 'Race condition test',
      };
      fs.writeFileSync(
        path.join(lockDir, 'nginx.lock'),
        JSON.stringify(raceLock, null, 2),
      );

      const result = acquireLock('nginx', lockDir, baseMeta, 3600000);

      expect(result.status).toBe('locked');
      if (result.status === 'locked') {
        expect(result.existing.sessionId).toBe('session-racer');
      }
    });
  });

  describe('releaseLock', () => {
    it('removes the lock file for a given target', () => {
      acquireLock('nginx', lockDir, baseMeta, 3600000);
      const lockPath = path.join(lockDir, 'nginx.lock');
      expect(fs.existsSync(lockPath)).toBe(true);

      releaseLock('nginx', lockDir);

      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('is a no-op if lock file does not exist', () => {
      // Should not throw
      expect(() => releaseLock('nginx', lockDir)).not.toThrow();
    });
  });

  describe('checkLock', () => {
    it('returns LockFile when lock exists', () => {
      acquireLock('nginx', lockDir, baseMeta, 3600000);

      const result = checkLock('nginx', lockDir);

      expect(result).not.toBeNull();
      expect(result!.target).toBe('nginx');
      expect(result!.sessionId).toBe('session-001');
    });

    it('returns null when no lock exists', () => {
      const result = checkLock('nginx', lockDir);

      expect(result).toBeNull();
    });
  });

  describe('formatLockConflict', () => {
    it('returns readable string with target, session, and admin', () => {
      const lock: LockFile = {
        target: 'nginx',
        sessionId: 'session-001',
        adminName: 'admin-test',
        createdAt: new Date(Date.now() - 900000).toISOString(), // 15 min ago
        pid: 12345,
        planSummary: 'Fix nginx config',
      };

      const message = formatLockConflict(lock);

      expect(message).toContain('nginx');
      expect(message).toContain('session-001');
      expect(message).toContain('admin-test');
    });
  });

  describe('promptLockOverride', () => {
    it('returns true when admin types exact target name', async () => {
      const lock: LockFile = {
        target: 'nginx',
        sessionId: 'session-001',
        adminName: 'admin-test',
        createdAt: new Date().toISOString(),
        pid: 12345,
        planSummary: 'Fix nginx',
      };
      const rl = createMockReadline(['nginx']);

      const result = await promptLockOverride(lock, rl);

      expect(result).toBe(true);
      expect(rl.question).toHaveBeenCalledOnce();
    });

    it('returns false when admin types wrong text', async () => {
      const lock: LockFile = {
        target: 'nginx',
        sessionId: 'session-001',
        adminName: 'admin-test',
        createdAt: new Date().toISOString(),
        pid: 12345,
        planSummary: 'Fix nginx',
      };
      const rl = createMockReadline(['wrong']);

      const result = await promptLockOverride(lock, rl);

      expect(result).toBe(false);
    });

    it('returns false when admin enters empty string', async () => {
      const lock: LockFile = {
        target: 'nginx',
        sessionId: 'session-001',
        adminName: 'admin-test',
        createdAt: new Date().toISOString(),
        pid: 12345,
        planSummary: 'Fix nginx',
      };
      const rl = createMockReadline(['']);

      const result = await promptLockOverride(lock, rl);

      expect(result).toBe(false);
    });
  });
});
