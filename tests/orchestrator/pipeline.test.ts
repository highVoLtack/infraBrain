import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider } from '../../src/llm/types.js';
import type { AuditLogger } from '../../src/audit/logger.js';
import type { ValidationResult } from '../../src/safety/types.js';
import { RiskLevel } from '../../src/safety/types.js';
import type { SkillFile } from '../../src/skills/types.js';
import { SkillRegistry } from '../../src/skills/registry.js';

// Mock all pipeline dependencies
vi.mock('../../src/orchestrator/router.js', () => ({
  selectSkill: vi.fn(),
}));
vi.mock('../../src/orchestrator/planner.js', () => ({
  generateFixPlan: vi.fn(),
  generatePlanMarkdown: vi.fn(),
  formatPlanTable: vi.fn(),
}));
vi.mock('../../src/orchestrator/context.js', () => ({
  buildMessages: vi.fn(() => ({ system: 'mock system prompt', messages: [] })),
}));
vi.mock('../../src/orchestrator/discovery.js', () => ({
  runParallelDiscovery: vi.fn(),
}));
vi.mock('../../src/orchestrator/diagnosis.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    runDiagnosis: vi.fn(),
  };
});
// Mock cache modules to prevent real LanceDB/embedding calls in pipeline tests
vi.mock('../../src/cache/cache-lookup.js', () => ({
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
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

import { runDPEV } from '../../src/orchestrator/pipeline.js';
import type { DPEVInput } from '../../src/orchestrator/pipeline.js';
import { selectSkill } from '../../src/orchestrator/router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../src/orchestrator/planner.js';
import { runParallelDiscovery } from '../../src/orchestrator/discovery.js';
import { runDiagnosis } from '../../src/orchestrator/diagnosis.js';
import type { InferenceScheduler } from '../../src/orchestrator/inference-scheduler.js';
import type { InferenceTask, InferenceResult, InferenceMode } from '../../src/orchestrator/inference-types.js';

describe('runDPEV pipeline', () => {
  let mockProvider: LLMProvider;
  let mockAuditLogger: AuditLogger;
  let mockValidator: (command: string) => ValidationResult;
  let registry: SkillRegistry;
  let nginxSkill: SkillFile;
  let planningSkill: SkillFile;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      model: {} as any,
      registry: {
        get: vi.fn(() => ({} as any)),
        getDefault: vi.fn(() => ({} as any)),
        entries: vi.fn(() => []),
      },
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand() { return 'Command: docker ps'; },
    };

    mockAuditLogger = {
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logSkillSelection: vi.fn(),
      logError: vi.fn(),
      logExecution: vi.fn(),
      logApproval: vi.fn(),
      logStateDiff: vi.fn(),
    } as unknown as AuditLogger;

    mockValidator = (command: string) => ({
      allowed: true,
      riskLevel: RiskLevel.READ,
      command,
    });

    nginxSkill = {
      frontmatter: {
        name: 'nginx-troubleshoot',
        description: 'Nginx diagnosis',
        triggers: ['nginx'],
        tools: ['docker'],
        priority: 10,
        discovery: [{ command: 'docker ps --format "{{.Names}}"', label: 'Running containers' }],
      },
      sections: { systemPrompt: 'You are a diagnostic specialist.' },
      rawContent: '',
      filePath: 'skills/nginx-troubleshoot.md',
    };

    planningSkill = {
      frontmatter: {
        name: 'planning',
        description: 'Fix planning',
        triggers: ['plan'],
        tools: [],
        priority: 10,
      },
      sections: { systemPrompt: 'You are a planning specialist.' },
      rawContent: '',
      filePath: 'skills/planning.md',
    };

    registry = new SkillRegistry();
    (registry as any).skills = new Map([
      ['nginx-troubleshoot', nginxSkill],
      ['planning', planningSkill],
    ]);
  });

  it('calls pipeline stages in correct DPEV order', async () => {
    const callOrder: string[] = [];

    vi.mocked(selectSkill).mockImplementation(async () => {
      callOrder.push('select');
      return { skill: nginxSkill, reasoning: 'matched' };
    });

    vi.mocked(runParallelDiscovery).mockImplementation(async () => {
      callOrder.push('discovery');
      return { context: 'discovered context', raw: { 'Running containers': 'nginx-demo' } };
    });

    vi.mocked(runDiagnosis).mockImplementation(async () => {
      callOrder.push('diagnosis');
      return { diagnosis: 'Command: docker restart nginx-demo' };
    });

    vi.mocked(generateFixPlan).mockImplementation(async () => {
      callOrder.push('planning');
      return {
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      };
    });
    vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
    vi.mocked(formatPlanTable).mockReturnValue('| Step |');

    const result = await runDPEV({
      prompt: 'Nginx is down',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(callOrder).toEqual(['select', 'discovery', 'diagnosis', 'planning']);
    expect(result.skillName).toBe('nginx-troubleshoot');
    expect(result.diagnosis).toBe('Command: docker restart nginx-demo');
    expect(result.fixPlan).toBeDefined();
  });

  it('propagates hallucinationError from runDiagnosis', async () => {
    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({ context: 'ctx', raw: {} });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'bad output',
      hallucinationError: {
        violations: ['Found hallucination pattern: "<my-app>"'],
        hint: 'placeholder detected',
      },
    });

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.hallucinationError).toBeDefined();
    expect(result.hallucinationError!.violations).toHaveLength(1);
    expect(result.commands).toEqual([]);
  });

  it('returns DPEVResult with all expected fields', async () => {
    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({
      context: 'discovered context',
      raw: { 'Running containers': 'nginx-demo' },
    });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'Command: docker logs nginx-demo',
    });
    vi.mocked(generateFixPlan).mockResolvedValue({
      summary: 'Check logs',
      steps: [{ command: 'docker logs nginx-demo', description: 'Check', rollback: 'n/a', risk: 'read' as const }],
      complexity: 'simple' as const,
    });
    vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
    vi.mocked(formatPlanTable).mockReturnValue('| Step |');

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.sessionId).toBe('test-session');
    expect(result.skillMessage).toContain('nginx-troubleshoot');
    expect(result.diagnosis).toBeDefined();
    expect(result.commands).toBeDefined();
    expect(result.discovery).toBeDefined();
    expect(result.fixPlan).toBeDefined();
    expect(result.planMarkdown).toBeDefined();
    expect(result.planTable).toBeDefined();
    expect(result.skillName).toBe('nginx-troubleshoot');
    expect(result.containers).toBeDefined();
  });

  it('handles missing planning skill gracefully', async () => {
    const noPlanRegistry = new SkillRegistry();
    (noPlanRegistry as any).skills = new Map([
      ['nginx-troubleshoot', nginxSkill],
    ]);

    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({ context: '', raw: {} });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'Command: docker ps',
    });

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry: noPlanRegistry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.fixPlan).toBeUndefined();
    expect(vi.mocked(generateFixPlan)).not.toHaveBeenCalled();
  });

  describe('parallel inference', () => {
    function createMockScheduler(mode: InferenceMode): InferenceScheduler {
      return {
        probeBackends: vi.fn().mockResolvedValue([
          { baseUrl: 'http://localhost:11434/v1', available: true, models: ['infrabrain'], responseTimeMs: 10 },
          { baseUrl: 'http://localhost:8000/v1', available: true, models: ['qwen3:9b'], responseTimeMs: 15 },
        ]),
        isAvailable: vi.fn().mockReturnValue(true),
        getMode: vi.fn().mockReturnValue(mode),
        runParallel: vi.fn().mockImplementation(async <T>(tasks: InferenceTask<T>[]): Promise<InferenceResult<T>[]> => {
          // Execute all tasks concurrently (simulating real scheduler behavior)
          const results = await Promise.all(tasks.map(async (task) => {
            const startMs = Date.now();
            try {
              const value = await task.execute();
              const endMs = Date.now();
              return {
                label: task.label,
                status: 'fulfilled' as const,
                value,
                startMs,
                endMs,
                durationMs: endMs - startMs,
              };
            } catch (err) {
              const endMs = Date.now();
              return {
                label: task.label,
                status: 'rejected' as const,
                reason: (err as Error).message,
                startMs,
                endMs,
                durationMs: endMs - startMs,
              };
            }
          }));
          return results;
        }),
      };
    }

    function makeBaseInput(overrides: Partial<DPEVInput> = {}): DPEVInput {
      return {
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'test-parallel',
        ...overrides,
      };
    }

    function setupStandardMocks() {
      vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
      vi.mocked(runParallelDiscovery).mockResolvedValue({
        context: 'discovered context',
        raw: { 'Running containers': 'nginx-demo' },
      });
      vi.mocked(runDiagnosis).mockResolvedValue({
        diagnosis: 'Command: docker restart nginx-demo',
      });
      vi.mocked(generateFixPlan).mockResolvedValue({
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      });
      vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
      vi.mocked(formatPlanTable).mockReturnValue('| Step |');
    }

    it('parallel mode: dispatches noise filter and diagnosis concurrently via scheduler.runParallel', async () => {
      setupStandardMocks();
      const scheduler = createMockScheduler('parallel');

      const result = await runDPEV(makeBaseInput({ inferenceScheduler: scheduler }));

      expect(scheduler.probeBackends).toHaveBeenCalled();
      expect(scheduler.getMode).toHaveBeenCalled();
      expect(scheduler.runParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: '9B-preprocess' }),
          expect.objectContaining({ label: '122B-diagnosis' }),
        ]),
      );
      // Diagnosis should still produce a valid result
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis.length).toBeGreaterThan(0);
    });

    it('sequential mode (scheduler present): does NOT call runParallel, runs in order', async () => {
      setupStandardMocks();
      const scheduler = createMockScheduler('sequential');

      const result = await runDPEV(makeBaseInput({ inferenceScheduler: scheduler }));

      expect(scheduler.probeBackends).toHaveBeenCalled();
      expect(scheduler.getMode).toHaveBeenCalled();
      // Sequential mode should NOT use runParallel
      expect(scheduler.runParallel).not.toHaveBeenCalled();
      // runDiagnosis should be called directly (sequential path)
      expect(vi.mocked(runDiagnosis)).toHaveBeenCalled();
      expect(result.diagnosis).toBeDefined();
    });

    it('no scheduler provided: runs current sequential flow unchanged', async () => {
      setupStandardMocks();

      // No inferenceScheduler in input
      const result = await runDPEV(makeBaseInput());

      // Standard sequential path: runDiagnosis called directly
      expect(vi.mocked(runDiagnosis)).toHaveBeenCalled();
      expect(result.diagnosis).toBeDefined();
    });

    it('parallel mode: 9B failure degrades gracefully (diagnosis still succeeds)', async () => {
      vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
      vi.mocked(runParallelDiscovery).mockResolvedValue({
        context: 'discovered context',
        raw: { 'Running containers': 'nginx-demo' },
      });
      vi.mocked(generateFixPlan).mockResolvedValue({
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      });
      vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
      vi.mocked(formatPlanTable).mockReturnValue('| Step |');

      // Create a scheduler where runParallel returns 9B as rejected but 122B as fulfilled
      const scheduler = createMockScheduler('parallel');
      (scheduler.runParallel as ReturnType<typeof vi.fn>).mockImplementation(async <T>(tasks: InferenceTask<T>[]): Promise<InferenceResult<T>[]> => {
        const results: InferenceResult<T>[] = [];
        for (const task of tasks) {
          const startMs = Date.now();
          if (task.label === '9B-preprocess') {
            results.push({
              label: task.label,
              status: 'rejected',
              reason: 'Worker model unavailable',
              startMs,
              endMs: startMs + 10,
              durationMs: 10,
            });
          } else {
            // Execute the diagnosis task normally
            try {
              const value = await task.execute();
              const endMs = Date.now();
              results.push({
                label: task.label,
                status: 'fulfilled',
                value,
                startMs,
                endMs,
                durationMs: endMs - startMs,
              });
            } catch (err) {
              const endMs = Date.now();
              results.push({
                label: task.label,
                status: 'rejected',
                reason: (err as Error).message,
                startMs,
                endMs,
                durationMs: endMs - startMs,
              });
            }
          }
        }
        return results;
      });

      // runDiagnosis mock needed for the 122B task execute() inside the parallel task
      vi.mocked(runDiagnosis).mockResolvedValue({
        diagnosis: 'Command: docker restart nginx-demo',
      });

      const result = await runDPEV(makeBaseInput({ inferenceScheduler: scheduler }));

      // Despite 9B failure, diagnosis should succeed
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis).toContain('docker restart');
      // runParallel WAS called (parallel path was taken)
      expect(scheduler.runParallel).toHaveBeenCalled();
    });

    it('parallel mode: 122B diagnosis failure throws error', async () => {
      vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
      vi.mocked(runParallelDiscovery).mockResolvedValue({
        context: 'discovered context',
        raw: { 'Running containers': 'nginx-demo' },
      });

      // Create a scheduler where runParallel returns 122B as rejected
      const scheduler = createMockScheduler('parallel');
      (scheduler.runParallel as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          label: '9B-preprocess',
          status: 'fulfilled',
          value: { noiseResult: { filtered: {}, removedCount: 0, workerModelUsed: false }, contextBlock: '', compResult: null },
          startMs: 1000,
          endMs: 1050,
          durationMs: 50,
        },
        {
          label: '122B-diagnosis',
          status: 'rejected',
          reason: 'Model timeout',
          startMs: 1000,
          endMs: 1200,
          durationMs: 200,
        },
      ]);

      await expect(runDPEV(makeBaseInput({ inferenceScheduler: scheduler }))).rejects.toThrow('Diagnosis failed');
    });

    it('parallel mode: DEV_MODE timing logs emitted', async () => {
      setupStandardMocks();
      const scheduler = createMockScheduler('parallel');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runDPEV(makeBaseInput({ inferenceScheduler: scheduler }));

      // Check that parallel-specific timing logs were emitted
      const logCalls = consoleSpy.mock.calls.map(c => c[0]);
      expect(logCalls.some(msg => typeof msg === 'string' && msg.includes('[PARALLEL]'))).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('DPEV phase audit logging', () => {
    function setupStandardMocksForAudit() {
      vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
      vi.mocked(runParallelDiscovery).mockResolvedValue({
        context: 'discovered context',
        raw: { 'Running containers': 'nginx-demo' },
      });
      vi.mocked(runDiagnosis).mockResolvedValue({
        diagnosis: 'Command: docker restart nginx-demo',
      });
      vi.mocked(generateFixPlan).mockResolvedValue({
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      });
      vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
      vi.mocked(formatPlanTable).mockReturnValue('| Step |');
    }

    it('logs dpev_phase_start and dpev_phase_complete audit events for diagnosis phase', async () => {
      setupStandardMocksForAudit();

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'audit-test',
      });

      const logCalls = vi.mocked(mockAuditLogger.logExecution).mock.calls;
      const dpevStartCalls = logCalls.filter(([eventType]) => eventType === 'dpev_phase_start');
      const dpevCompleteCalls = logCalls.filter(([eventType]) => eventType === 'dpev_phase_complete');

      // Diagnosis phase should have start and complete
      const diagStart = dpevStartCalls.find(([, details]) => (details as any).phase === 'diagnosis');
      const diagComplete = dpevCompleteCalls.find(([, details]) => (details as any).phase === 'diagnosis');

      expect(diagStart).toBeDefined();
      expect(diagComplete).toBeDefined();
      expect((diagComplete![1] as any).duration_ms).toBeTypeOf('number');
    });

    it('logs dpev_phase_complete for discovery phase with model and timing', async () => {
      setupStandardMocksForAudit();

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'audit-test-2',
      });

      const logCalls = vi.mocked(mockAuditLogger.logExecution).mock.calls;
      const discoveryComplete = logCalls.find(
        ([eventType, details]) => eventType === 'dpev_phase_complete' && (details as any).phase === 'discovery'
      );

      expect(discoveryComplete).toBeDefined();
      expect((discoveryComplete![1] as any).model).toBeDefined();
      expect((discoveryComplete![1] as any).duration_ms).toBeTypeOf('number');
    });

    it('logs dpev_phase_start and dpev_phase_complete for plan phase', async () => {
      setupStandardMocksForAudit();

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'audit-test-3',
      });

      const logCalls = vi.mocked(mockAuditLogger.logExecution).mock.calls;
      const planStart = logCalls.find(
        ([eventType, details]) => eventType === 'dpev_phase_start' && (details as any).phase === 'plan'
      );
      const planComplete = logCalls.find(
        ([eventType, details]) => eventType === 'dpev_phase_complete' && (details as any).phase === 'plan'
      );

      expect(planStart).toBeDefined();
      expect((planStart![1] as any).model).toBeDefined();
      expect(planComplete).toBeDefined();
      expect((planComplete![1] as any).duration_ms).toBeTypeOf('number');
    });

    it('audit events fire ALONGSIDE onEvent SSE emissions (both should fire)', async () => {
      setupStandardMocksForAudit();
      const sseEvents: Array<{ event: string; data: unknown }> = [];
      const onEvent = (event: string, data: unknown) => {
        sseEvents.push({ event, data });
      };

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'audit-sse-test',
        onEvent,
      });

      // SSE events should still fire
      const ssePhaseEvents = sseEvents.filter(e => e.event === 'dpev:phase');
      expect(ssePhaseEvents.length).toBeGreaterThan(0);

      // Audit events should also fire
      const logCalls = vi.mocked(mockAuditLogger.logExecution).mock.calls;
      const dpevAuditCalls = logCalls.filter(([eventType]) =>
        eventType === 'dpev_phase_start' || eventType === 'dpev_phase_complete'
      );
      expect(dpevAuditCalls.length).toBeGreaterThan(0);
    });

    it('pipeline continues without error when auditLogger.logExecution throws', async () => {
      setupStandardMocksForAudit();

      // Make logExecution throw for dpev events only
      vi.mocked(mockAuditLogger.logExecution).mockImplementation((eventType: any) => {
        if (typeof eventType === 'string' && eventType.startsWith('dpev_phase')) {
          throw new Error('Audit logging failed');
        }
        // Non-dpev events succeed (no-op, mock already returns undefined)
      });

      // Pipeline should complete without throwing
      const result = await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'audit-error-test',
      });

      expect(result.diagnosis).toBeDefined();
      expect(result.skillName).toBe('nginx-troubleshoot');
    });
  });

  describe('discovery active SSE event (TERM-E01)', () => {
    function setupStandardMocksForDiscovery() {
      vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
      vi.mocked(runParallelDiscovery).mockResolvedValue({
        context: 'discovered context',
        raw: { 'Running containers': 'nginx-demo' },
      });
      vi.mocked(runDiagnosis).mockResolvedValue({
        diagnosis: 'Command: docker restart nginx-demo',
      });
      vi.mocked(generateFixPlan).mockResolvedValue({
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      });
      vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
      vi.mocked(formatPlanTable).mockReturnValue('| Step |');
    }

    it('emits dpev:phase {discovery, active} BEFORE discovery commands run', async () => {
      setupStandardMocksForDiscovery();

      const sseEvents: Array<{ event: string; data: unknown }> = [];
      let discoveryActiveEventSeenBeforeDiscovery = false;

      vi.mocked(runParallelDiscovery).mockImplementation(async () => {
        // When discovery is being called, the active event should already be in sseEvents
        const activeEventIndex = sseEvents.findIndex(
          (e) => e.event === 'dpev:phase' &&
                 (e.data as any).phase === 'discovery' &&
                 (e.data as any).status === 'active'
        );
        discoveryActiveEventSeenBeforeDiscovery = activeEventIndex !== -1;
        return { context: 'discovered context', raw: { 'Running containers': 'nginx-demo' } };
      });

      const onEvent = (event: string, data: unknown) => {
        sseEvents.push({ event, data });
      };

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'discovery-active-test',
        onEvent,
      });

      expect(discoveryActiveEventSeenBeforeDiscovery).toBe(true);
    });

    it('emits dpev:phase {routing, active} BEFORE selectSkill runs (closes triage silence gap)', async () => {
      setupStandardMocksForDiscovery();

      const sseEvents: Array<{ event: string; data: unknown }> = [];
      let routingActiveSeenBeforeTriage = false;

      vi.mocked(selectSkill).mockImplementation(async () => {
        const idx = sseEvents.findIndex(
          (e) => e.event === 'dpev:phase' &&
                 (e.data as any).phase === 'routing' &&
                 (e.data as any).status === 'active'
        );
        routingActiveSeenBeforeTriage = idx !== -1;
        return { skill: nginxSkill, reasoning: 'matched' };
      });

      const onEvent = (event: string, data: unknown) => {
        sseEvents.push({ event, data });
      };

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'routing-active-test',
        onEvent,
      });

      expect(routingActiveSeenBeforeTriage).toBe(true);

      const routingEvents = sseEvents.filter(
        (e) => e.event === 'dpev:phase' && (e.data as any).phase === 'routing'
      );
      const activeEvent = routingEvents.find((e) => (e.data as any).status === 'active');
      const completeEvent = routingEvents.find((e) => (e.data as any).status === 'complete');
      expect(activeEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
    });

    it('emits discovery active event with triage model ID', async () => {
      setupStandardMocksForDiscovery();

      // Override provider registry to return a specific triage model id
      mockProvider.registry!.get = vi.fn((role: any) => {
        if (role === 'triage') return { modelId: 'qwen3-triage-model' } as any;
        return { modelId: 'default-model' } as any;
      });
      mockProvider.registry!.getDefault = vi.fn(() => ({ modelId: 'default-model' } as any));

      const sseEvents: Array<{ event: string; data: unknown }> = [];
      const onEvent = (event: string, data: unknown) => {
        sseEvents.push({ event, data });
      };

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'discovery-model-test',
        onEvent,
      });

      const discoveryActiveEvents = sseEvents.filter(
        (e) => e.event === 'dpev:phase' &&
               (e.data as any).phase === 'discovery' &&
               (e.data as any).status === 'active'
      );

      expect(discoveryActiveEvents.length).toBe(1);
      expect((discoveryActiveEvents[0].data as any).model).toBe('qwen3-triage-model');
    });

    it('emits discovery complete event after discovery (existing behavior preserved)', async () => {
      setupStandardMocksForDiscovery();

      const sseEvents: Array<{ event: string; data: unknown }> = [];
      const onEvent = (event: string, data: unknown) => {
        sseEvents.push({ event, data });
      };

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'discovery-complete-test',
        onEvent,
      });

      const discoveryEvents = sseEvents.filter(
        (e) => e.event === 'dpev:phase' && (e.data as any).phase === 'discovery'
      );

      // Should have BOTH active (new) and complete (existing)
      const activeEvent = discoveryEvents.find((e) => (e.data as any).status === 'active');
      const completeEvent = discoveryEvents.find((e) => (e.data as any).status === 'complete');

      expect(activeEvent).toBeDefined();
      expect(completeEvent).toBeDefined();

      // Active must come before complete
      const activeIndex = discoveryEvents.indexOf(activeEvent!);
      const completeIndex = discoveryEvents.indexOf(completeEvent!);
      expect(activeIndex).toBeLessThan(completeIndex);
    });

    it('logs dpev_phase_start audit event for discovery phase', async () => {
      setupStandardMocksForDiscovery();

      await runDPEV({
        prompt: 'Nginx is down',
        provider: mockProvider,
        registry,
        auditLogger: mockAuditLogger,
        validator: mockValidator,
        sessionId: 'discovery-audit-test',
      });

      const logCalls = vi.mocked(mockAuditLogger.logExecution).mock.calls;
      const discoveryStart = logCalls.find(
        ([eventType, details]) =>
          eventType === 'dpev_phase_start' && (details as any).phase === 'discovery'
      );

      expect(discoveryStart).toBeDefined();
      expect((discoveryStart![1] as any).model).toBeDefined();
    });
  });
});
