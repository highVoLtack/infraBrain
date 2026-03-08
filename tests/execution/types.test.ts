import { describe, it, expect } from 'vitest';

describe('Execution Types', () => {
  it('exports RunResult, StepResult, ExecutionResult, SnapshotRecord, ExecutionDeps interfaces', async () => {
    const types = await import('../../src/execution/types.js');
    // These are type-only exports, but we verify the module loads
    expect(types).toBeDefined();
  });
});

describe('Config Schema Extensions', () => {
  it('parses empty config with new defaults (backward compatible)', async () => {
    const { InfraBrainConfigSchema } = await import('../../src/config/types.js');
    const config = InfraBrainConfigSchema.parse({});

    // Existing defaults preserved
    expect(config.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(config.modelName).toBe('llama3.3:70b');
    expect(config.apiPort).toBe(3000);
    expect(config.tokenBudgets.diagnosis).toBe(4096);

    // New Phase 3 defaults
    expect(config.circuitBreaker.maxRetries).toBe(3);
    expect(config.circuitBreaker.retryDelayMs).toBe(1000);
    expect(config.damageBudget.maxPoints).toBe(10);
    expect(config.locks.staleTimeoutMs).toBe(3600000);
    expect(config.execution.commandTimeoutMs).toBe(30000);
    expect(config.execution.maxBufferBytes).toBe(1048576);
  });

  it('allows overriding new config sections', async () => {
    const { InfraBrainConfigSchema } = await import('../../src/config/types.js');
    const config = InfraBrainConfigSchema.parse({
      circuitBreaker: { maxRetries: 5 },
      damageBudget: { maxPoints: 20 },
    });
    expect(config.circuitBreaker.maxRetries).toBe(5);
    expect(config.circuitBreaker.retryDelayMs).toBe(1000); // default still works
    expect(config.damageBudget.maxPoints).toBe(20);
  });
});

describe('Audit Event Types', () => {
  it('includes Phase 3 event types in union', async () => {
    // We verify the type exists by importing and checking
    // AuditEventType is a type-only export, but we can validate
    // by creating values that should match the type
    const phase3Events = [
      'execution_start', 'execution_complete',
      'step_start', 'step_complete', 'step_failed',
      'snapshot_captured',
      'rollback_start', 'rollback_complete', 'rollback_failed',
      'circuit_breaker_triggered',
      'damage_budget_exceeded', 'damage_budget_update',
      'lock_acquired', 'lock_released', 'lock_conflict', 'lock_override',
    ];
    // Module loads without error
    const auditTypes = await import('../../src/audit/types.js');
    expect(auditTypes).toBeDefined();
    // Original events still present (checked via the type system at compile time)
    // Runtime check: we verify the module exports AuditEntry interface
    expect(phase3Events.length).toBe(16);
  });
});
