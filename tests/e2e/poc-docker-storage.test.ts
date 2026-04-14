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
vi.mock('../../src/memory/incident-store.js', () => ({
  getIncidentStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue('inc-001'),
  })),
}));
vi.mock('../../src/memory/entity-store.js', () => ({
  getEntityStore: vi.fn(() => ({
    searchByEntities: vi.fn().mockResolvedValue([]),
    searchByType: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue('ent-001'),
  })),
}));
vi.mock('../../src/memory/wake-up.js', () => ({
  buildWakeUpContext: vi.fn().mockResolvedValue({ pinned: '', evictable: '' }),
}));
vi.mock('../../src/memory/wal.js', () => ({
  getMemoryWAL: vi.fn(() => ({
    append: vi.fn().mockReturnValue(true),
    read: vi.fn().mockReturnValue([]),
  })),
}));
vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntitiesForGraph: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/memory/memory-search.js', () => ({
  searchWithDecay: vi.fn().mockResolvedValue([]),
  formatIncidentEmbeddingInput: vi.fn().mockReturnValue('formatted embedding input'),
}));
vi.mock('../../src/cache/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  formatEmbeddingInput: vi.fn().mockReturnValue('formatted'),
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
 * POC: Docker Storage Failure End-to-End Integration Test
 *
 * Tests the full DPEV (Diagnose-Plan-Execute-Verify) loop with:
 * - Real Docker commands against the Docker storage demo environment
 * - Mocked LLM responses with Causal Deduplication reasoning
 * - 4-step fix plan: identify bloat -> truncate log -> restart Redis -> verify recovery
 * - Full audit trail verification
 */
describe('POC: Docker Storage Failure End-to-End', { timeout: 120_000 }, () => {
  let app: Express;
  let tmpDir: string;
  let sessionDir: string;
  let store: WriteThrough;
  let testSessionId: string;

  // Shared state between sequential tests
  let debugSessionId: string;
  let debugFixPlan: FixPlan;

  // Canned fix plan: 4-step Docker storage recovery with Causal Deduplication
  const cannedFixPlan: FixPlan = {
    summary: 'Truncate bloated log file and restart crashed Redis',
    complexity: 'moderate',
    steps: [
      {
        command: 'docker exec storage-logger du -sh /shared/',
        description: 'Identify bloat source files on shared volume',
        risk: 'read',
        rollback: 'N/A',
      },
      {
        command: 'docker exec storage-logger truncate -s 0 /shared/bloat.log',
        description: 'Truncate bloated log file (preserves inode)',
        risk: 'write',
        rollback: 'File will be re-created by logger if still running',
      },
      {
        command: 'docker restart storage-redis',
        description: 'Restart Redis to recover from crash state',
        risk: 'write',
        rollback: 'docker stop storage-redis',
      },
      {
        command: 'docker exec storage-redis redis-cli PING',
        description: 'Verify Redis recovered and responding',
        risk: 'read',
        rollback: 'N/A',
      },
    ],
  };

  beforeAll(() => {
    // 1. Run demo/docker-storage/reset-docker-storage.sh to start broken environment
    execSync('bash demo/docker-storage/reset-docker-storage.sh', {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      stdio: 'pipe',
    });

    // 2. Verify broken state: poll until tmpfs full AND Redis refusing writes
    let broken = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        // Check disk usage >= 95%
        const dfOutput = execSync(
          "docker exec storage-logger df /shared | awk 'NR==2 {gsub(/%/,\"\"); print $5}'",
          { timeout: 5_000, stdio: 'pipe' },
        ).toString().trim();
        const usagePct = parseInt(dfOutput, 10);
        const diskFull = usagePct >= 95;

        // Check Redis refusing writes (MISCONF returns exit 0 but prints error to stdout)
        let redisBroken = false;
        try {
          const redisOutput = execSync('docker exec storage-redis redis-cli SET infratest 1', {
            timeout: 5_000,
            stdio: 'pipe',
          }).toString().toLowerCase();
          redisBroken = redisOutput.includes('misconf') || redisOutput.includes('error');
        } catch {
          // Connection refused or other hard failure also means broken
          redisBroken = true;
        }

        if (diskFull && redisBroken) {
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
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-e2e-docker-storage-'));
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

    // 5. Create mock LLM provider via shared factory (Causal Deduplication reasoning)
    const mockProvider = createMockLLMProvider([
      'Diagnostic Ladder Investigation:',
      '',
      'Step 0 - Container Discovery: Found storage-logger and storage-redis containers sharing /shared tmpfs volume.',
      'Step 1 - Capacity Check: df shows /shared at 100% usage. Volume is completely full.',
      'Step 2 - Ownership Analysis: bloat.log (9MB) owned by storage-logger, dump.rdb (~100B) owned by storage-redis.',
      'Step 3 - Causal Deduplication: bloat.log = LOG BLOAT (safe to truncate, generated by logger process). dump.rdb = STATE DATA (Redis RDB snapshot, must preserve). Root cause: logger filling shared volume with unbounded log output.',
      'Step 4 - Risk-Tiered Remediation: truncate bloat.log (write risk), restart Redis (write risk), dual verify with df + redis-cli PING.',
      '',
      'Root Cause: Storage-logger fills shared tmpfs with bloat.log, leaving no space for Redis BGSAVE. Redis enters MISCONF state.',
      'Fix: Truncate log bloat, restart Redis, verify dual recovery (disk space + Redis health).',
    ].join('\n'));

    // 6. Set up mocks for skill selection and fix plan generation
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));

    const linuxExpertSkill = registry.get('linux-expert');
    if (!linuxExpertSkill) throw new Error('linux-expert skill not found in skills/ directory');

    vi.mocked(selectSkill).mockResolvedValue({
      skill: linuxExpertSkill,
      reasoning: 'Docker storage volume full with Redis crash -- using linux-expert skill',
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
      execSync('docker compose -f demo/docker-storage/docker-compose.yml down --remove-orphans --volumes', {
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

  it('broken environment shows full volume and crashed redis', () => {
    // Verify high disk usage on shared volume
    const dfOutput = execSync('docker exec storage-logger df -h /shared', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(dfOutput).toMatch(/9[0-9]%|100%/);

    // Verify Redis refuses writes (MISCONF returns exit 0 but prints error to stdout)
    const redisOutput = execSync('docker exec storage-redis redis-cli SET test 1', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString().toLowerCase();
    expect(redisOutput).toMatch(/misconf|refused|error/);
  });

  it('diagnoses storage bloat and generates fix plan', async () => {
    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Docker storage is full, Redis is crashing with disk full errors' });

    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis.toLowerCase()).toMatch(/bloat|storage|full/);
    expect(res.body.fixPlan).toBeDefined();
    expect(res.body.fixPlan.steps.length).toBeGreaterThanOrEqual(3);
    expect(res.body.skillMessage).toContain('linux-expert');
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
        target: 'docker-storage',
        adminName: 'e2e-test',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.stepResults).toBeDefined();
    expect(res.body.stepResults.length).toBeGreaterThan(0);

    // Verify recovery: Redis responds to PING
    const pingResult = execSync('docker exec storage-redis redis-cli PING', {
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    expect(pingResult).toContain('PONG');

    // Verify disk freed: usage should be well under 50%
    const dfOutput = execSync(
      "docker exec storage-logger df /shared | awk 'NR==2 {gsub(/%/,\"\"); print $5}'",
      { timeout: 10_000, stdio: 'pipe' },
    ).toString().trim();
    const usagePct = parseInt(dfOutput, 10);
    expect(usagePct).toBeLessThan(50);
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
