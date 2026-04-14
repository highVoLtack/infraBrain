import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';

// Mock orchestrator modules BEFORE importing anything that uses them
vi.mock('../../src/orchestrator/router.js', () => ({
  selectSkill: vi.fn(),
}));

vi.mock('../../src/orchestrator/planner.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/orchestrator/planner.js')>();
  return {
    generateFixPlan: vi.fn(),
    generatePlanMarkdown: original.generatePlanMarkdown,
    formatPlanTable: original.formatPlanTable,
  };
});

vi.mock('../../src/orchestrator/context.js', () => ({
  buildMessages: vi.fn(() => ({ system: 'You are a diagnostic specialist.', messages: [] })),
}));
vi.mock('../../src/cache/cache-lookup.js', () => ({
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
// Mock memory modules to prevent real LanceDB init attempts
vi.mock('../../src/memory/incident-store.js', () => ({
  getIncidentStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/entity-store.js', () => ({
  getEntityStore: vi.fn(() => ({
    searchByEntities: vi.fn().mockResolvedValue([]),
    searchByType: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/wake-up.js', () => ({
  buildWakeUpContext: vi.fn().mockResolvedValue({ pinned: '', evictable: '' }),
}));

import type { Express } from 'express';
import { createServer } from '../../src/api/server.js';
import { initDatabase } from '../../src/state/db.js';
import { WriteThrough } from '../../src/state/store.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { classifyCommand } from '../../src/safety/classifier.js';
import { validateCommand } from '../../src/safety/validator.js';
import { InfraBrainConfigSchema } from '../../src/config/types.js';
import { selectSkill } from '../../src/orchestrator/router.js';
import { generateFixPlan } from '../../src/orchestrator/planner.js';
import type { FixPlan } from '../../src/orchestrator/types.js';
import { assertDPEVSequence, createMockLLMProvider } from './helpers/index.js';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

/**
 * POC: Postgres Connection Leak End-to-End Integration Test
 *
 * Tests the full DPEV (Diagnose-Plan-Execute-Verify) loop with:
 * - Real Docker commands against the Postgres demo environment
 * - Mocked LLM responses (deterministic)
 * - Full audit trail verification
 * - Multi-step fix plan proving rolling context (Phase 8)
 */
describe('POC: Postgres Connection Leak End-to-End', { timeout: 120_000 }, () => {
  let app: Express;
  let tmpDir: string;
  let sessionDir: string;
  let store: WriteThrough;
  let testSessionId: string;

  // Shared state between sequential tests
  let debugSessionId: string;
  let debugFixPlan: FixPlan;

  // Canned fix plan: 3-step Postgres connection termination
  const cannedFixPlan: FixPlan = {
    summary: 'Terminate leaked idle connections from leaky-app',
    complexity: 'moderate',
    steps: [
      {
        command: `docker exec postgres-demo psql -U postgres -t -c "SELECT pid FROM pg_stat_activity WHERE state='idle' AND usename='leaky'"`,
        description: 'Identify leaked PIDs from leaky user',
        risk: 'read',
        rollback: 'N/A',
      },
      {
        command: `docker exec postgres-demo psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND usename='leaky'"`,
        description: 'Terminate all idle connections from leaky user',
        risk: 'write',
        rollback: 'N/A -- connections will be re-established by leaky-app if still running',
      },
      {
        command: `docker exec postgres-demo psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity"`,
        description: 'Verify connection count recovered',
        risk: 'read',
        rollback: 'N/A',
      },
    ],
  };

  beforeAll(() => {
    // 1. Run demo/postgres/reset-postgres.sh to start broken environment
    execSync('bash demo/postgres/reset-postgres.sh', {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      stdio: 'pipe',
    });

    // 2. Verify broken state: poll until "too many connections" confirmed
    let broken = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        execSync('docker exec postgres-demo psql -U leaky -d postgres -c "SELECT 1"', {
          timeout: 5_000,
          stdio: 'pipe',
        });
      } catch (err: any) {
        const stderr = err.stderr?.toString() ?? '';
        if (stderr.toLowerCase().includes('too many')) {
          broken = true;
          break;
        }
      }
      execSync('sleep 2');
    }
    expect(broken).toBe(true);

    // 3. Create temp directory for session storage
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-e2e-postgres-'));
    testSessionId = uuidv7();
    sessionDir = join(tmpDir, 'sessions', testSessionId);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(join(tmpDir, 'locks'), { recursive: true });

    // 4. Initialize SQLite + WriteThrough store
    const db = initDatabase(join(tmpDir, 'infrabrain.db'));
    // Insert a session row so audit_log FK doesn't fail
    db.prepare('INSERT INTO sessions (id, state, updated_at) VALUES (?, ?, ?)').run(
      testSessionId,
      JSON.stringify({ sessionId: testSessionId, status: 'active' }),
      new Date().toISOString(),
    );
    store = new WriteThrough(db);

    // 5. Create mock LLM provider via shared factory
    const mockProvider = createMockLLMProvider([
      'Diagnostic Ladder Investigation:',
      '',
      'Step 0 - Container Discovery: Found postgres-demo and leaky-app containers.',
      'Step 1 - Connection Saturation: 20/20 connections active. System is saturated.',
      "Step 2 - Idle Analysis: 18 idle connections from user 'leaky' (leaky-app container).",
      'Step 3 - Cross-Domain Correlation: leaky-app (172.20.0.3) holds 18 idle connections to postgres-demo. This is a connection leak.',
      'Step 4 - Fix Proposal: Terminate idle connections from leaky user.',
      '',
      "Root Cause: Connection leak from leaky-app -- 18 connections opened and never closed.",
      'Fix: Terminate idle connections via pg_terminate_backend.',
    ].join('\n'));

    // 6. Set up mocks for skill selection and fix plan generation
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));

    const postgresExpertSkill = registry.get('postgres-expert');
    if (!postgresExpertSkill) throw new Error('postgres-expert skill not found in skills/ directory');

    vi.mocked(selectSkill).mockResolvedValue({
      skill: postgresExpertSkill,
      reasoning: 'Postgres connection limit issue detected -- using postgres-expert skill',
    });

    vi.mocked(generateFixPlan).mockResolvedValue(cannedFixPlan);

    // 7. Create audit logger
    const auditLogger = new AuditLogger(store, testSessionId, sessionDir);

    // 8. Build config with defaults
    const config = InfraBrainConfigSchema.parse({});

    // 9. Build server deps and create Express app
    app = createServer({
      provider: mockProvider,
      auditLogger,
      validator: (cmd: string) => validateCommand(cmd),
      ollamaBaseUrl: 'http://localhost:11434',
      registry,
      config,
      sessionId: testSessionId,
      sessionDir,
      store,
      lockDir: join(tmpDir, 'locks'),
    }).app;
  });

  afterAll(() => {
    // Tear down Docker environment
    try {
      execSync('docker compose -f demo/postgres/docker-compose.yml down --remove-orphans', {
        cwd: PROJECT_ROOT,
        timeout: 30_000,
        stdio: 'pipe',
      });
    } catch {
      // Best-effort cleanup
    }

    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('broken environment rejects new connections', () => {
    try {
      execSync('docker exec postgres-demo psql -U leaky -d postgres -c "SELECT 1"', {
        timeout: 10_000,
        stdio: 'pipe',
      });
      // If command succeeds, the environment is NOT broken -- fail the test
      expect.unreachable('Expected psql to fail with too many connections');
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      expect(stderr.toLowerCase()).toContain('too many');
    }
  });

  it('diagnoses connection leak and generates fix plan', async () => {
    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Postgres is rejecting connections with too many connections error' });

    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis.toLowerCase()).toMatch(/leak|idle/);
    expect(res.body.fixPlan).toBeDefined();
    expect(res.body.fixPlan.steps.length).toBeGreaterThanOrEqual(2);
    expect(res.body.skillMessage).toContain('postgres-expert');
    expect(res.body.sessionId).toBeDefined();

    // Store for sequential test consumption
    debugSessionId = res.body.sessionId;
    debugFixPlan = res.body.fixPlan;
  });

  it('executes fix plan and verifies recovery', async () => {
    // Use the sessionId+fixPlan from the debug step
    expect(debugSessionId).toBeDefined();
    expect(debugFixPlan).toBeDefined();

    const res = await request(app)
      .post('/execute')
      .send({
        sessionId: debugSessionId,
        fixPlan: debugFixPlan,
        target: 'postgres',
        adminName: 'e2e-test',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.stepResults).toBeDefined();
    expect(res.body.stepResults.length).toBeGreaterThan(0);

    // Verify recovery: leaky user can now connect (connections were terminated)
    const result = execSync(
      'docker exec postgres-demo psql -U leaky -d postgres -c "SELECT 1"',
      { timeout: 10_000, stdio: 'pipe' },
    ).toString();
    expect(result).toContain('1');
  });

  it('audit trail contains full DPEV evidence with correct ordering', () => {
    // Query audit log directly from store for this session
    const entries = store.queryAuditLog({
      sessionId: testSessionId,
      limit: 100,
    });

    expect(entries.length).toBeGreaterThan(0);

    // Validate DPEV sequence: S -> D -> E -> V ordering and completeness
    assertDPEVSequence(entries);

    // Verify at least one entry contains reasoning/diagnostic information
    const hasReasoning = entries.some((e) => e.reasoning && e.reasoning.length > 0);
    expect(hasReasoning).toBe(true);
  });
});
