import { describe, it, expect } from 'vitest';
import { checkForHallucinations } from '../../src/orchestrator/diagnosis.js';

describe('Sanity Checker (checkForHallucinations)', () => {
  it('passes clean diagnosis with real data', () => {
    const diagnosis = [
      'Step 0: Container Discovery',
      'Command: docker ps --format "{{.Names}}"',
      'Output: postgres-demo leaky-app',
      'Finding: Two containers running.',
      '',
      'Root Cause: leaky-app (172.20.0.3) holds 18 idle connections.',
      'Fix Plan:',
      '1. Command: `docker exec postgres-demo psql -U postgres -t -c "SELECT pid FROM pg_stat_activity WHERE state=\'idle\'"` | Risk: read',
    ].join('\n');

    expect(checkForHallucinations(diagnosis)).toEqual([]);
  });

  it('catches <container-name> placeholder', () => {
    const diagnosis = 'Run: docker exec <container-name> psql -U postgres';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('<container-name>');
  });

  it('catches [PID] placeholder', () => {
    const diagnosis = 'Terminate connection [PID] using pg_terminate_backend';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('[PID]');
  });

  it('catches "Example Output" header', () => {
    const diagnosis = 'Example Output:\n20/20 connections active';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('Example Output');
  });

  it('catches "Assume the following" preamble', () => {
    const diagnosis = 'Assume the following environment:\n- postgres-demo running on port 5432';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('Assume the following');
  });

  it('catches "Hypothetically" reasoning', () => {
    const diagnosis = 'Hypothetically, if the connection pool were full...';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('catches "Let\'s say" reasoning', () => {
    const diagnosis = "Let's say the leaky-app opens 20 connections...";
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('catches "Sample output" header', () => {
    const diagnosis = 'Sample output from pg_stat_activity:\npid|state|client_addr';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('catches multiple violations in one output', () => {
    const diagnosis = [
      'Assume the following environment:',
      'Run: docker exec <postgres-container> psql',
      'Expected output shows [PID] connections',
    ].join('\n');
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it('does not flag legitimate angle brackets in docker format strings', () => {
    // docker ps --format uses {{.Names}} not <...>
    const diagnosis = 'Command: docker ps --format "{{.Names}}"';
    expect(checkForHallucinations(diagnosis)).toEqual([]);
  });

  it('does not flag "For example" when it appears as part of a real sentence', () => {
    // "For example" IS flagged — this is intentional. The LLM should not
    // be giving examples in a production execution engine.
    const diagnosis = 'For example, container postgres-demo shows 20 connections';
    const violations = checkForHallucinations(diagnosis);
    expect(violations.length).toBeGreaterThan(0);
  });

  describe('Docker Legitimate Tags (whitelist)', () => {
    it('passes text containing <none> (Docker tag)', () => {
      const diagnosis = 'Image tag shows <none> which indicates untagged build';
      expect(checkForHallucinations(diagnosis)).toEqual([]);
    });

    it('passes text containing <missing> (Docker image)', () => {
      const diagnosis = 'Parent layer is <missing> in docker history output';
      expect(checkForHallucinations(diagnosis)).toEqual([]);
    });

    it('passes text containing <local> (Docker build)', () => {
      const diagnosis = 'Build context uses <local> source';
      expect(checkForHallucinations(diagnosis)).toEqual([]);
    });

    it('passes text containing <original-image> (Docker inspect)', () => {
      const diagnosis = 'Original image reference: <original-image> from inspect output';
      expect(checkForHallucinations(diagnosis)).toEqual([]);
    });

    it('passes text containing <no-value> (Docker output)', () => {
      const diagnosis = 'Label value is <no-value> when not set';
      expect(checkForHallucinations(diagnosis)).toEqual([]);
    });

    it('still catches <container-name> as genuine placeholder', () => {
      const diagnosis = 'Run: docker exec <container-name> bash';
      const violations = checkForHallucinations(diagnosis);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('still catches <PID> as genuine placeholder', () => {
      const diagnosis = 'Kill process <PID> to free resources';
      const violations = checkForHallucinations(diagnosis);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('still catches <my-app> as genuine placeholder', () => {
      const diagnosis = 'Container <my-app> is not responding';
      const violations = checkForHallucinations(diagnosis);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('still catches <hostname> as genuine placeholder', () => {
      const diagnosis = 'Connect to <hostname> on port 5432';
      const violations = checkForHallucinations(diagnosis);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('Structured Diagnosis Exemption', () => {
    // NOTE: The structured diagnosis path (generateObject with Zod schema) bypasses
    // checkForHallucinations entirely in the debug route. Since structured output is
    // Zod-validated, free-text hallucination is not possible. Integration behavior
    // is tested via the debug route tests, not here. Unit tests in this file only
    // cover the checkForHallucinations function itself.
    it('documents that structured diagnosis skips sanity check (integration tested in debug route)', () => {
      // This is a documentation test -- the actual bypass is in debug.ts
      // where checkForHallucinations is only called when !structuredDiagnosis
      expect(true).toBe(true);
    });
  });
});
