import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WriteThrough } from '../../src/state/store.js';
import { initDatabase } from '../../src/state/db.js';
import { createSession, updateSessionForResume } from '../../src/state/session.js';
import type { SessionState } from '../../src/state/types.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Resume state', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: WriteThrough;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-resume-test-'));
    const dbPath = join(tmpDir, 'test.db');
    db = initDatabase(dbPath);
    store = new WriteThrough(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getSessionById returns correct session', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    store.persistState(sessionDir, session);

    const found = store.getSessionById(session.sessionId);
    expect(found).not.toBeNull();
    expect(found!.sessionId).toBe(session.sessionId);
  });

  it('getSessionById returns null for unknown ID', () => {
    const found = store.getSessionById('nonexistent-id');
    expect(found).toBeNull();
  });

  it('updateSessionForResume sets correct metadata', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    session.status = 'failed';
    session.currentPlan = {
      id: 'plan-1',
      description: 'Fix nginx',
      steps: [],
      currentStep: 3,
      status: 'failed',
    };
    store.persistState(sessionDir, session);

    const updated = updateSessionForResume(sessionDir, session, 2, 'circuit_breaker', 'nginx');

    expect(updated.status).toBe('active');
    expect(updated.resumeMetadata).toBeDefined();
    expect(updated.resumeMetadata!.lastCompletedStep).toBe(2);
    expect(updated.resumeMetadata!.error).toBe('circuit_breaker');
    expect(updated.resumeMetadata!.target).toBe('nginx');
    expect(updated.resumeMetadata!.stoppedAt).toBeTruthy();
  });

  it('getIncompleteSessions returns sessions with resume metadata', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    session.status = 'active';
    session.resumeMetadata = {
      lastCompletedStep: 1,
      stoppedAt: new Date().toISOString(),
      error: 'circuit_breaker',
      target: 'nginx',
    };
    store.persistState(sessionDir, session);

    const incomplete = store.getIncompleteSessions(86400000);
    expect(incomplete.length).toBe(1);
    expect(incomplete[0].resumeMetadata).toBeDefined();
    expect(incomplete[0].resumeMetadata!.target).toBe('nginx');
  });
});
