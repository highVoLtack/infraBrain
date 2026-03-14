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
 * POC: Linux Filesystem Permission Trap End-to-End Integration Test
 *
 * Tests the full DPEV (Diagnose-Plan-Execute-Verify) loop with:
 * - Real Docker commands against the permission-trap demo environment
 * - Mocked LLM responses with Diagnostic Ladder reasoning
 * - 4-step fix plan: inspect permissions -> chown -> restart -> verify recovery
 * - Full audit trail verification
 *
 * No DB-specific logic -- pure OS-level troubleshooting.
 */
describe('POC: Linux Filesystem Permission Trap End-to-End', { timeout: 120_000 }, () => {
  let app: Express;
  let tmpDir: string;
  let sessionDir: string;
  let store: WriteThrough;
  let testSessionId: string;

  // Shared state between sequential tests
  let debugSessionId: string;
  let debugFixPlan: FixPlan;

  // Canned fix plan: permission ownership fix with chown + restart
  const cannedFixPlan: FixPlan = {
    summary: 'Fix directory ownership to match app user and restart',
    complexity: 'simple',
    steps: [
      {
        command: 'docker exec permission-app ls -ld /app/data',
        description: 'Verify directory ownership and permissions',
        risk: 'read',
        rollback: 'N/A',
      },
      {
        command: 'docker exec -u 0 permission-app chown 1000:1000 /app/data',
        description: 'Change directory ownership to app user (UID 1000)',
        risk: 'write',
        rollback: 'docker exec -u 0 permission-app chown root:root /app/data',
      },
      {
        command: 'docker restart permission-app',
        description: 'Restart app to retry PID file write',
        risk: 'write',
        rollback: 'docker stop permission-app',
      },
      {
        command: 'docker logs permission-app --tail 5',
        description: 'Verify app started successfully after fix',
        risk: 'read',
        rollback: 'N/A',
      },
    ],
  };

  beforeAll(() => {
    // 1. Run reset script to start broken environment
    execSync('bash demo/permission-trap/reset-permission-trap.sh', {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      stdio: 'pipe',
    });

    // 2. Verify broken state: poll until container running AND logs show Permission denied
    let broken = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const status = execSync(
          "docker inspect --format '{{.State.Status}}' permission-app",
          { timeout: 5_000, stdio: 'pipe' },
        ).toString().trim();
        const containerRunning = status === 'running';

        const logs = execSync('docker logs permission-app 2>&1', {
          timeout: 5_000,
          stdio: 'pipe',
        }).toString();
        const hasPermissionDenied = logs.includes('Permission denied');

        if (containerRunning && hasPermissionDenied) {
          broken = true;
          break;
        }
      } catch {
        // Container not ready yet, retry
      }
      execSync('sleep 2');
    }
    expect(broken).toBe(true);

    // 3. Create temp directory for session storage
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-e2e-permission-trap-'));
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

    // 5. Create mock LLM provider with permission-focused diagnostic reasoning
    const mockProvider = createMockLLMProvider([
      'Diagnostic Ladder Investigation:',
      '',
      'Step 0 - Container Discovery: Found permission-app container in running state. Logs show Permission Denied error.',
      'Step 1 - Log Analysis: FATAL: Permission denied writing to /app/data/status.pid. App cannot write PID file.',
      'Step 2 - Permission Inspection: ls -ld /app/data shows drwx------ root root. Directory is mode 700, owned by root:root.',
      'Step 3 - User Identity Check: id shows uid=1000. App runs as UID 1000 but directory owned by root with 700 permissions.',
      'Step 4 - Correlation: Owner mismatch -- directory owned by root:root (mode 700 = rwx------), process runs as UID 1000. Non-root user cannot read, write, or enter the directory.',
      '',
      'Root Cause: /app/data directory owned by root:root with mode 700. App runs as UID 1000 and cannot access the directory.',
      'Fix: chown 1000:1000 /app/data to transfer ownership to app user, then restart container.',
    ].join('\n'));

    // 6. Set up mocks for skill selection and fix plan generation
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));

    const linuxFilesystemSkill = registry.get('linux-filesystem-troubleshoot');
    if (!linuxFilesystemSkill) throw new Error('linux-filesystem-troubleshoot skill not found in skills/ directory');

    vi.mocked(selectSkill).mockResolvedValue({
      skill: linuxFilesystemSkill,
      reasoning: 'Permission denied error in container -- using linux-filesystem-troubleshoot skill',
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
  }, 120_000);

  afterAll(() => {
    // Tear down Docker environment
    try {
      execSync('docker compose -f demo/permission-trap/docker-compose.yml down --remove-orphans', {
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

  it('broken environment shows permission denied and running container', () => {
    // Verify container is running (stays alive via sleep loop)
    const status = execSync(
      "docker inspect --format '{{.State.Status}}' permission-app",
      { timeout: 10_000, stdio: 'pipe' },
    ).toString().trim();
    expect(status).toBe('running');

    // Verify logs contain Permission denied
    const logs = execSync('docker logs permission-app 2>&1', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(logs).toContain('Permission denied');

    // Verify directory ownership is root
    const lsOutput = execSync('docker exec permission-app ls -ld /app/data', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(lsOutput).toContain('root');

    // Verify user identity is UID 1000
    const idOutput = execSync('docker exec permission-app id', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(idOutput).toContain('uid=1000');
  });

  it('diagnoses permission mismatch and generates fix plan', async () => {
    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Container permission-app has Permission Denied errors writing to /app/data' });

    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis.toLowerCase()).toMatch(/permission|ownership|mismatch/);
    expect(res.body.fixPlan).toBeDefined();
    expect(res.body.fixPlan.steps.length).toBeGreaterThanOrEqual(3);
    expect(res.body.skillMessage).toContain('linux-filesystem-troubleshoot');
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
        target: 'linux-filesystem-troubleshoot',
        adminName: 'e2e-test',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.stepResults).toBeDefined();
    expect(res.body.stepResults.length).toBeGreaterThan(0);

    // Wait for container restart to complete -- app writes PID and may exit successfully
    // Poll logs for recovery signal (max 15 attempts, 2s apart)
    let recovered = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const logs = execSync('docker logs permission-app --tail 20 2>&1', {
        timeout: 10_000,
        stdio: 'pipe',
      }).toString();
      if (logs.includes('written successfully')) {
        recovered = true;
        break;
      }
      execSync('sleep 2');
    }
    expect(recovered).toBe(true);

    // Verify recovery: logs show PID written successfully
    const logs = execSync('docker logs permission-app --tail 20 2>&1', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(logs).toContain('PID');
    expect(logs).toContain('written successfully');
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
