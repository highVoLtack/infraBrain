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
 * POC: Nginx 502 End-to-End Integration Test
 *
 * Tests the full DPEV (Diagnose-Plan-Execute-Verify) loop with:
 * - Real Docker commands against the demo environment
 * - Mocked LLM responses (deterministic)
 * - Full audit trail verification
 */
describe('POC: Nginx 502 End-to-End', { timeout: 120_000 }, () => {
  let app: Express;
  let tmpDir: string;
  let sessionDir: string;
  let store: WriteThrough;
  let testSessionId: string;

  // Shared state between sequential tests
  let debugSessionId: string;
  let debugFixPlan: FixPlan;

  // Canned fix plan matching FixPlanSchema (summary, steps, complexity)
  const cannedFixPlan: FixPlan = {
    summary: 'Connect backend container to frontend network',
    complexity: 'simple',
    steps: [
      {
        command: 'docker network connect --alias backend demo_frontend demo-backend',
        description: 'Connect backend to frontend network with DNS alias',
        risk: 'write',
        rollback: 'docker network disconnect demo_frontend demo-backend',
      },
      {
        command: 'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get',
        description: 'Verify HTTP 200 after fix',
        risk: 'read',
        rollback: 'N/A',
      },
    ],
  };

  beforeAll(() => {
    // 1. Run demo/nginx/reset.sh to start broken environment
    execSync('bash demo/nginx/reset.sh', {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      stdio: 'pipe',
    });

    // Wait for Nginx to be reachable, then verify broken state
    let httpCode = '000';
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        httpCode = execSync(
          'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get',
          { timeout: 5_000 },
        ).toString().trim();
        if (httpCode !== '000') break;
      } catch {
        // curl returns non-zero on connection refused
      }
      execSync('sleep 2');
    }
    expect(httpCode).toBe('502');

    // 2. Create temp directory for session storage
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-e2e-'));
    testSessionId = uuidv7();
    sessionDir = join(tmpDir, 'sessions', testSessionId);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(join(tmpDir, 'locks'), { recursive: true });

    // 3. Initialize SQLite + WriteThrough store
    const db = initDatabase(join(tmpDir, 'infrabrain.db'));
    // Insert a session row so audit_log FK doesn't fail
    db.prepare('INSERT INTO sessions (id, state, updated_at) VALUES (?, ?, ?)').run(
      testSessionId,
      JSON.stringify({ sessionId: testSessionId, status: 'active' }),
      new Date().toISOString(),
    );
    store = new WriteThrough(db);

    // 4. Create mock LLM provider via shared factory
    const mockProvider = createMockLLMProvider([
      'Diagnostic Ladder Investigation:',
      '',
      'Step 1 - HTTP Check: curl confirms 502 Bad Gateway.',
      'Step 2 - Error Logs: Nginx logs show "connect() failed (111: Connection refused) while connecting to upstream".',
      'Step 3 - Network Inspection: demo-backend container is only on demo_backend network, NOT on demo_frontend network where demo-nginx lives.',
      'Step 4 - Cross-Layer Correlation: Nginx cannot reach backend because they are on different Docker networks.',
      '',
      'Root Cause: Docker network isolation -- backend container not connected to frontend network.',
      'Fix: Connect the backend container to the frontend network.',
      '',
      'Command: docker network connect --alias backend demo_frontend demo-backend',
    ].join('\n'));

    // 5. Set up mocks for skill selection and fix plan generation
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));

    const networkExpertSkill = registry.get('network-expert');
    if (!networkExpertSkill) throw new Error('network-expert skill not found in skills/ directory');

    vi.mocked(selectSkill).mockResolvedValue({
      skill: networkExpertSkill,
      reasoning: 'Nginx 502 issue detected -- using network-expert skill',
    });

    vi.mocked(generateFixPlan).mockResolvedValue(cannedFixPlan);

    // 6. Create audit logger
    const auditLogger = new AuditLogger(store, testSessionId, sessionDir);

    // 7. Build config with defaults
    const config = InfraBrainConfigSchema.parse({});

    // 8. Build server deps and create Express app
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
      execSync('docker compose -f demo/nginx/docker-compose.yml down --remove-orphans', {
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

  it('broken environment returns 502', () => {
    const httpCode = execSync(
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get',
      { timeout: 10_000 },
    ).toString().trim();
    expect(httpCode).toBe('502');
  });

  it('diagnoses broken Nginx and generates fix plan', async () => {
    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Why is Nginx returning 502?' });

    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis).toContain('network');
    expect(res.body.fixPlan).toBeDefined();
    expect(res.body.fixPlan.steps.length).toBeGreaterThanOrEqual(1);
    expect(res.body.skillMessage).toContain('network-expert');
    expect(res.body.sessionId).toBeDefined();

    // Store for sequential test consumption
    debugSessionId = res.body.sessionId;
    debugFixPlan = res.body.fixPlan;
  });

  it('executes fix plan and verifies health', async () => {
    // Use the sessionId+fixPlan from the debug step
    expect(debugSessionId).toBeDefined();
    expect(debugFixPlan).toBeDefined();

    const res = await request(app)
      .post('/execute')
      .send({
        sessionId: debugSessionId,
        fixPlan: debugFixPlan,
        target: 'nginx',
        adminName: 'e2e-test',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.stepResults).toBeDefined();
    expect(res.body.stepResults.length).toBeGreaterThan(0);

    // Verify the fix actually worked: curl should now return 200
    const httpCode = execSync(
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get',
      { timeout: 10_000 },
    ).toString().trim();
    expect(httpCode).toBe('200');
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
