import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogger } from '../../src/audit/logger.js';
import type { WriteThrough } from '../../src/state/store.js';
import type { AuditEntry } from '../../src/audit/types.js';

describe('AuditLogger', () => {
  let mockStore: { appendAudit: ReturnType<typeof vi.fn> };
  let logger: AuditLogger;
  let capturedEntries: AuditEntry[];
  const sessionId = 'test-session-id';
  const sessionDir = '/tmp/test-session';

  beforeEach(() => {
    capturedEntries = [];
    mockStore = {
      appendAudit: vi.fn((dir: string, entry: AuditEntry) => {
        capturedEntries.push(entry);
      }),
    };
    logger = new AuditLogger(mockStore as unknown as WriteThrough, sessionId, sessionDir);
  });

  describe('logDecision', () => {
    it('creates entry with event_type "decision", reasoning, and options considered', () => {
      logger.logDecision('chose option A because faster', ['option A', 'option B'], 'option A');

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('decision');
      expect(entry.reasoning).toBe('chose option A because faster');
      expect(entry.optionsConsidered).toEqual(['option A', 'option B']);
      expect(entry.decision).toBe('option A');
    });
  });

  describe('logCommandValidation', () => {
    it('creates entry with command, risk_level, decision (allowed/blocked)', () => {
      logger.logCommandValidation('docker ps', 'read', true, 'auto-approved read command');

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('command_validation');
      expect(entry.command).toBe('docker ps');
      expect(entry.riskLevel).toBe('read');
      expect(entry.decision).toBe('allowed');
    });

    it('sets decision to "blocked" when not allowed', () => {
      logger.logCommandValidation('rm -rf /', 'blocked', false, 'hardcoded safety rule');

      const entry = capturedEntries[0];
      expect(entry.decision).toBe('blocked');
      expect(entry.reasoning).toBe('hardcoded safety rule');
    });
  });

  describe('logApproval', () => {
    it('creates entry with command, decision (approved), approval_type', () => {
      logger.logApproval('docker restart nginx', true, 'y_n');

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('approval');
      expect(entry.command).toBe('docker restart nginx');
      expect(entry.decision).toBe('approved');
      expect(entry.approvalType).toBe('y_n');
    });

    it('sets decision to "rejected" when not approved', () => {
      logger.logApproval('docker rm -f container', false, 'typed_confirmation');

      const entry = capturedEntries[0];
      expect(entry.decision).toBe('rejected');
      expect(entry.approvalType).toBe('typed_confirmation');
    });
  });

  describe('logStateDiff', () => {
    it('captures before and after JSON snapshots', () => {
      const before = { status: 'pending', step: 1 };
      const after = { status: 'in_progress', step: 2 };

      logger.logStateDiff(before, after);

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('state_change');
      expect(entry.diffBefore).toBe(JSON.stringify(before));
      expect(entry.diffAfter).toBe(JSON.stringify(after));
    });

    it('marks diff as "no_change" when before and after are identical', () => {
      const state = { status: 'active', step: 1 };

      logger.logStateDiff(state, state);

      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('state_change');
      expect(entry.metadata).toBeDefined();
      expect(entry.metadata!.changed).toBe(false);
    });

    it('marks changed as true when before and after differ', () => {
      const before = { status: 'pending' };
      const after = { status: 'completed' };

      logger.logStateDiff(before, after);

      const entry = capturedEntries[0];
      expect(entry.metadata).toBeDefined();
      expect(entry.metadata!.changed).toBe(true);
    });
  });

  describe('logError', () => {
    it('creates entry with event_type "error"', () => {
      logger.logError('connection failed', { host: 'localhost', port: 5432 });

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.eventType).toBe('error');
      expect(entry.reasoning).toBe('connection failed');
      expect(entry.metadata).toEqual({ host: 'localhost', port: 5432 });
    });
  });

  describe('common properties', () => {
    it('each log method includes timestamp', () => {
      logger.logDecision('test', ['a'], 'a');

      const entry = capturedEntries[0];
      expect(entry.timestamp).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('each log method includes sessionId', () => {
      logger.logDecision('test', ['a'], 'a');

      const entry = capturedEntries[0];
      expect(entry.sessionId).toBe(sessionId);
    });

    it('each log method writes via store.appendAudit', () => {
      logger.logDecision('test', ['a'], 'a');
      logger.logCommandValidation('ls', 'read', true);
      logger.logApproval('docker ps', true, 'auto');

      expect(mockStore.appendAudit).toHaveBeenCalledTimes(3);
      // Verify sessionDir is passed correctly
      expect(mockStore.appendAudit.mock.calls[0][0]).toBe(sessionDir);
    });

    it('audit entries are valid JSON when serialized', () => {
      logger.logDecision('test reasoning', ['a', 'b'], 'a');

      const entry = capturedEntries[0];
      const serialized = JSON.stringify(entry);
      const parsed = JSON.parse(serialized);
      expect(parsed.eventType).toBe('decision');
      expect(parsed.reasoning).toBe('test reasoning');
    });
  });
});
